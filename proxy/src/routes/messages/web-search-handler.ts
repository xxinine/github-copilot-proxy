import type { Context } from "hono"

import consola from "consola"
import { streamSSE } from "hono/streaming"

import { fitContext, fitUnknownModelContext } from "~/lib/context-manager"
import { state } from "~/lib/state"
import {
  executeWebSearch,
  formatResultsForModel,
  type WebSearchResult,
} from "~/lib/web-search"
import {
  createChatCompletions,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
  type Message,
  type ToolCall,
} from "~/services/copilot/create-chat-completions"

import type {
  AnthropicMessagesPayload,
  AnthropicResponseContentBlock,
  AnthropicServerToolUseBlock,
  AnthropicTool,
  AnthropicWebSearchToolResultBlock,
} from "./anthropic-types"
import {
  translateToAnthropic,
  translateToOpenAI,
} from "./non-stream-translation"

const WEB_SEARCH_TOOL_NAME = "web_search"
const DEFAULT_MAX_USES = 5
/** Absolute safety cap on Copilot round-trips, independent of `max_uses`. */
const HARD_ITERATION_CAP = 10

interface WebSearchFlowOptions {
  clientModel: string
  requestId: string
}

type WebSearchContentBlock =
  | AnthropicResponseContentBlock
  | AnthropicServerToolUseBlock
  | AnthropicWebSearchToolResultBlock

interface AssembledMessage {
  id: string
  type: "message"
  role: "assistant"
  model: string
  content: Array<WebSearchContentBlock>
  stop_reason: string | null
  stop_sequence: null
  usage: {
    input_tokens: number
    output_tokens: number
    server_tool_use: { web_search_requests: number }
  }
}

/**
 * Locate an Anthropic-hosted `web_search` server tool in the payload, if any.
 * Server tools are identified by a `type` like `web_search_20250305`.
 */
export function findWebSearchServerTool(
  payload: AnthropicMessagesPayload,
): AnthropicTool | undefined {
  return payload.tools?.find(
    (tool) => typeof tool.type === "string" && tool.type.startsWith("web_search"),
  )
}

/**
 * Emulate Anthropic's native server-side web search on top of GitHub Copilot.
 *
 * Copilot has no native web search, so we run an internal agentic loop: expose
 * `web_search` as an ordinary function tool, execute the model's search calls
 * against the configured provider, feed results back, and repeat until the
 * model produces a final answer — all within one client request. The result is
 * repackaged with `server_tool_use` / `web_search_tool_result` blocks so the
 * client sees it as native web search.
 */
export async function handleWebSearchCompletion(
  c: Context,
  payload: AnthropicMessagesPayload,
  options: WebSearchFlowOptions,
  webSearchTool: AnthropicTool,
) {
  const rewritten = rewriteToolsForCopilot(payload, webSearchTool)
  const openAIPayload = translateToOpenAI(rewritten)
  const model = state.models?.data.find((m) => m.id === openAIPayload.model)
  const fitted =
    model ? fitContext(openAIPayload, model) : (
      fitUnknownModelContext(openAIPayload)
    )

  const maxUses = webSearchTool.max_uses ?? DEFAULT_MAX_USES
  const assembled = await runWebSearchLoop(
    fitted,
    maxUses,
    options,
  )

  if (payload.stream) {
    return streamAssembledMessage(c, assembled)
  }
  return c.json(assembled)
}

/**
 * Replace the `web_search` server tool with an ordinary function tool Copilot
 * can call. Other client tools are preserved unchanged.
 */
function rewriteToolsForCopilot(
  payload: AnthropicMessagesPayload,
  webSearchTool: AnthropicTool,
): AnthropicMessagesPayload {
  const tools = payload.tools?.map((tool) =>
    tool === webSearchTool ?
      ({
        name: WEB_SEARCH_TOOL_NAME,
        description:
          "Search the public web for up-to-date information. Provide a concise "
          + "search query. Use this whenever the answer may depend on recent or "
          + "external facts, then cite the results in your answer.",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query.",
            },
          },
          required: ["query"],
        },
      } satisfies AnthropicTool)
    : tool,
  )
  return { ...payload, tools }
}

async function runWebSearchLoop(
  base: ChatCompletionsPayload,
  maxUses: number,
  options: WebSearchFlowOptions,
): Promise<AssembledMessage> {
  const messages: Array<Message> = [...base.messages]
  const preBlocks: Array<WebSearchContentBlock> = []
  let searchCount = 0
  let inputTokens = 0
  let outputTokens = 0
  let toolChoice = base.tool_choice

  for (let iter = 0; iter <= HARD_ITERATION_CAP; iter++) {
    // Call Copilot in STREAMING mode and aggregate the chunks ourselves.
    // Copilot's non-streaming aggregation for some Claude models drops the
    // `tool_calls` array (it returns finish_reason "tool_calls" but an empty
    // message), so streaming is the only reliable way to capture tool calls.
    const streamed = await createChatCompletions({
      ...base,
      messages,
      tool_choice: toolChoice,
      stream: true,
    })
    if (isNonStreaming(streamed)) {
      throw new Error("Expected streaming response from Copilot")
    }
    const response = await aggregateStream(streamed)

    inputTokens = response.usage?.prompt_tokens ?? inputTokens
    outputTokens += response.usage?.completion_tokens ?? 0

    const choice = response.choices[0]
    const toolCalls = choice?.message.tool_calls ?? []
    const webCalls = toolCalls.filter(
      (tc) => tc.function.name === WEB_SEARCH_TOOL_NAME,
    )
    const hasClientToolCalls = toolCalls.some(
      (tc) => tc.function.name !== WEB_SEARCH_TOOL_NAME,
    )

    // Stop looping when the model asked for a client-side tool, or produced no
    // web search calls (i.e. a final answer). We deliberately do NOT gate on
    // `finish_reason === "tool_calls"`: Copilot sometimes emits a follow-up
    // `web_search` call with `finish_reason: "stop"` (a "let me verify" turn),
    // which we still want to execute rather than leak as an unfulfilled tool_use.
    if (webCalls.length === 0 || hasClientToolCalls) {
      return assemble(response, preBlocks, searchCount, inputTokens, outputTokens, options.clientModel)
    }

    // Preserve any preamble text the model emitted alongside the tool call.
    if (
      typeof choice.message.content === "string"
      && choice.message.content.trim()
    ) {
      preBlocks.push({ type: "text", text: choice.message.content })
    }

    // The assistant tool-call turn must be echoed back before its tool results.
    messages.push({
      role: "assistant",
      content: choice.message.content,
      tool_calls: choice.message.tool_calls,
    })

    if (searchCount >= maxUses) {
      // Search budget exhausted: answer each pending call with a stop note and
      // forbid further tool use so the next turn produces a final answer.
      for (const tc of webCalls) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content:
            "Web search limit reached. Answer using the information already "
            + "gathered; do not request more searches.",
        })
      }
      toolChoice = "none"
      continue
    }

    for (const tc of webCalls) {
      const query = parseQuery(tc.function.arguments)
      let results: Array<WebSearchResult> = []
      let errorText: string | undefined
      try {
        results = await executeWebSearch(query)
      } catch (error) {
        errorText = error instanceof Error ? error.message : "search failed"
        consola.warn(`[${options.requestId}] web search failed:`, errorText)
      }
      searchCount++

      preBlocks.push(serverToolUseBlock(tc.id, query))
      preBlocks.push(webSearchResultBlock(tc.id, results))

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content:
          errorText ? `Search error: ${errorText}` : (
            formatResultsForModel(results)
          ),
      })
    }
  }

  throw new Error("Web search loop exceeded iteration cap")
}

function assemble(
  finalResponse: ChatCompletionResponse,
  preBlocks: Array<WebSearchContentBlock>,
  searchCount: number,
  inputTokens: number,
  outputTokens: number,
  clientModel: string,
): AssembledMessage {
  const finalAnthropic = translateToAnthropic(finalResponse, clientModel)
  return {
    id: finalAnthropic.id,
    type: "message",
    role: "assistant",
    model: finalAnthropic.model,
    content: [...preBlocks, ...finalAnthropic.content],
    stop_reason: finalAnthropic.stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      server_tool_use: { web_search_requests: searchCount },
    },
  }
}

function serverToolUseBlock(
  id: string,
  query: string,
): AnthropicServerToolUseBlock {
  return { type: "server_tool_use", id, name: "web_search", input: { query } }
}

function webSearchResultBlock(
  toolUseId: string,
  results: Array<WebSearchResult>,
): AnthropicWebSearchToolResultBlock {
  return {
    type: "web_search_tool_result",
    tool_use_id: toolUseId,
    content: results.map((r) => ({
      type: "web_search_result",
      url: r.url,
      title: r.title,
      // Anthropic returns opaque `encrypted_content`; we stash the plaintext
      // snippet here so clients that surface it show something useful.
      encrypted_content: r.content,
      ...(r.pageAge ? { page_age: r.pageAge } : {}),
    })),
  }
}

function parseQuery(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson) as { query?: unknown }
    if (typeof parsed.query === "string") return parsed.query
  } catch {
    // fall through
  }
  return argumentsJson
}

function isNonStreaming(
  response: Awaited<ReturnType<typeof createChatCompletions>>,
): response is ChatCompletionResponse {
  return "choices" in response
}

/**
 * Consume a Copilot chat-completion SSE stream and aggregate it into a single
 * non-streaming response shape. Necessary because Copilot's own non-streaming
 * response drops `tool_calls` for some Claude models, whereas the streamed
 * deltas carry them reliably.
 */
async function aggregateStream(
  stream: AsyncIterable<{ data?: string }>,
): Promise<ChatCompletionResponse> {
  let id = ""
  let model = ""
  let created = 0
  let content = ""
  let finishReason: ChatCompletionResponse["choices"][number]["finish_reason"] =
    "stop"
  let usage: ChatCompletionResponse["usage"]
  const toolCallsByIndex = new Map<
    number,
    { id: string; name: string; arguments: string }
  >()

  for await (const event of stream) {
    if (!event.data || event.data === "[DONE]") continue
    let chunk: ChatCompletionChunk
    try {
      chunk = JSON.parse(event.data) as ChatCompletionChunk
    } catch {
      continue
    }
    if (chunk.id) id = chunk.id
    if (chunk.model) model = chunk.model
    if (chunk.created) created = chunk.created
    if (chunk.usage) usage = chunk.usage

    const choice = chunk.choices?.[0]
    if (!choice) continue
    if (choice.delta.content) content += choice.delta.content
    if (choice.finish_reason) finishReason = choice.finish_reason
    for (const tc of choice.delta.tool_calls ?? []) {
      const cur = toolCallsByIndex.get(tc.index) ?? {
        id: "",
        name: "",
        arguments: "",
      }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.name = tc.function.name
      if (tc.function?.arguments) cur.arguments += tc.function.arguments
      toolCallsByIndex.set(tc.index, cur)
    }
  }

  const toolCalls: Array<ToolCall> = [...toolCallsByIndex.values()].map(
    (c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: c.arguments },
    }),
  )

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    usage,
  }
}

/**
 * Emit an already-assembled message as an Anthropic SSE stream. Text blocks are
 * streamed as text deltas; server-tool blocks are sent whole. Best-effort — the
 * search itself already completed before the stream opens.
 */
function streamAssembledMessage(c: Context, message: AssembledMessage) {
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "message_start",
      data: JSON.stringify({
        type: "message_start",
        message: {
          id: message.id,
          type: "message",
          role: "assistant",
          model: message.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: message.usage.input_tokens,
            output_tokens: 0,
            server_tool_use: message.usage.server_tool_use,
          },
        },
      }),
    })

    let index = 0
    for (const block of message.content) {
      if (block.type === "text") {
        await stream.writeSSE({
          event: "content_block_start",
          data: JSON.stringify({
            type: "content_block_start",
            index,
            content_block: { type: "text", text: "" },
          }),
        })
        await stream.writeSSE({
          event: "content_block_delta",
          data: JSON.stringify({
            type: "content_block_delta",
            index,
            delta: { type: "text_delta", text: block.text },
          }),
        })
      } else {
        await stream.writeSSE({
          event: "content_block_start",
          data: JSON.stringify({
            type: "content_block_start",
            index,
            content_block: block,
          }),
        })
      }
      await stream.writeSSE({
        event: "content_block_stop",
        data: JSON.stringify({ type: "content_block_stop", index }),
      })
      index++
    }

    await stream.writeSSE({
      event: "message_delta",
      data: JSON.stringify({
        type: "message_delta",
        delta: {
          stop_reason: message.stop_reason,
          stop_sequence: null,
        },
        usage: { output_tokens: message.usage.output_tokens },
      }),
    })
    await stream.writeSSE({
      event: "message_stop",
      data: JSON.stringify({ type: "message_stop" }),
    })
  })
}
