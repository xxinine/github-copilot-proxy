#!/usr/bin/env node
// End-to-end latency test through the gateway for gpt-5.4 and claude-opus-4.8.
// Measures, per model:
//   - non-streaming total latency (request -> full JSON response)
//   - streaming TTFB (request -> first generated token) and total stream time
//
// Each model is sent to the endpoint it actually works on:
//   - gpt-5.x reasoning models -> /v1/responses
//     (/v1/chat/completions rejects them because upstream injects max_tokens)
//   - everything else (e.g. claude-opus-4.8) -> /v1/chat/completions
//
// API key resolution order:
//   1. CPX_KEY env var
//   2. CPX_DEMO_KEY env var (the key you pre-save in .env for the demo)
//   3. /tmp/cpxkey.txt
// Pre-saving CPX_DEMO_KEY avoids relying on an auto-generated key that may have
// expired by demo time.
//
// Usage:
//   node tests/latency-test.mjs
//   CPX_KEY=cpx-... ROUNDS=5 MODELS=gpt-5.4,claude-opus-4.8 node tests/latency-test.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env so CPX_DEMO_KEY (and friends) are available without
// needing `node --env-file=.env`. Existing process env vars take precedence.
function loadDotEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith('#')) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const GATEWAY = process.env.GATEWAY || 'http://localhost:4000';
const KEY =
  process.env.CPX_KEY ||
  process.env.CPX_DEMO_KEY ||
  (fs.existsSync('/tmp/cpxkey.txt') ? fs.readFileSync('/tmp/cpxkey.txt', 'utf8').trim() : '');
const ROUNDS = Number(process.env.ROUNDS || 3);
const MODELS = (process.env.MODELS || 'gpt-5.4,claude-opus-4.8').split(',').map((s) => s.trim());
const PROMPT = process.env.PROMPT || 'Reply with exactly the word: pong';

if (!KEY) {
  console.error('No API key. Set CPX_KEY, set CPX_DEMO_KEY in .env, or provide /tmp/cpxkey.txt');
  process.exit(1);
}

const HEADERS = { 'content-type': 'application/json', authorization: `Bearer ${KEY}` };
const ms = (n) => `${n.toFixed(0)}ms`;

// gpt-5.x reasoning models must go through the Responses API.
const usesResponsesApi = (model) => /^gpt-5/i.test(model);

function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const pct = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { min: s[0], avg: sum / s.length, p50: pct(50), max: s[s.length - 1] };
}

async function nonStreaming(model) {
  const t0 = performance.now();
  let res;
  if (usesResponsesApi(model)) {
    res = await fetch(`${GATEWAY}/v1/responses`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ model, input: PROMPT, stream: false }),
    });
  } else {
    res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: PROMPT }],
        stream: false,
        max_tokens: 16,
      }),
    });
  }
  const body = await res.json();
  const total = performance.now() - t0;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  const u = body.usage || {};
  // Responses API and Chat Completions name token fields differently.
  return {
    total,
    inputTokens: u.input_tokens ?? u.prompt_tokens,
    outputTokens: u.output_tokens ?? u.completion_tokens,
  };
}

async function streaming(model) {
  const responses = usesResponsesApi(model);
  const t0 = performance.now();
  const res = await fetch(`${GATEWAY}${responses ? '/v1/responses' : '/v1/chat/completions'}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(
      responses
        ? { model, input: PROMPT, stream: true }
        : {
            model,
            messages: [{ role: 'user', content: PROMPT }],
            stream: true,
            max_tokens: 64,
          }
    ),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  // First SSE event carrying generated text marks TTFB.
  const firstTokenRe = responses
    ? /response\.output_text\.delta|"delta"|"output_text"/
    : /"(content|delta|text)"/;
  let ttfb = null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    if (ttfb === null && firstTokenRe.test(buf)) {
      ttfb = performance.now() - t0;
    }
  }
  const total = performance.now() - t0;
  if (ttfb === null) ttfb = total;
  return { ttfb, total };
}

async function run() {
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`Key:     ${KEY.slice(0, 12)}...`);
  console.log(`Rounds:  ${ROUNDS} per mode  |  Prompt: "${PROMPT}"`);
  console.log('='.repeat(72));

  for (const model of MODELS) {
    const endpoint = usesResponsesApi(model) ? '/v1/responses' : '/v1/chat/completions';
    console.log(`\n### ${model}  (endpoint: ${endpoint})`);

    process.stdout.write('  warming up... ');
    try {
      await nonStreaming(model);
      console.log('done');
    } catch (e) {
      console.log(`failed: ${e.message}`);
    }

    const nonStream = [];
    const streamTtfb = [];
    const streamTotal = [];
    let tokenInfo = '';

    for (let i = 0; i < ROUNDS; i++) {
      try {
        const r = await nonStreaming(model);
        nonStream.push(r.total);
        if (!tokenInfo && r.inputTokens != null) {
          tokenInfo = ` (input=${r.inputTokens}, output=${r.outputTokens} tokens)`;
        }
        process.stdout.write(`  non-stream #${i + 1}: ${ms(r.total)}\n`);
      } catch (e) {
        process.stdout.write(`  non-stream #${i + 1}: ERROR ${e.message}\n`);
      }
    }

    for (let i = 0; i < ROUNDS; i++) {
      try {
        const r = await streaming(model);
        streamTtfb.push(r.ttfb);
        streamTotal.push(r.total);
        process.stdout.write(`  stream     #${i + 1}: TTFB ${ms(r.ttfb)}, total ${ms(r.total)}\n`);
      } catch (e) {
        process.stdout.write(`  stream     #${i + 1}: ERROR ${e.message}\n`);
      }
    }

    const ns = stats(nonStream);
    const st = stats(streamTtfb);
    const stt = stats(streamTotal);
    console.log('  ' + '-'.repeat(60));
    if (ns)
      console.log(
        `  non-stream total : min ${ms(ns.min)} | avg ${ms(ns.avg)} | p50 ${ms(ns.p50)} | max ${ms(ns.max)}${tokenInfo}`
      );
    if (st)
      console.log(
        `  stream TTFB      : min ${ms(st.min)} | avg ${ms(st.avg)} | p50 ${ms(st.p50)} | max ${ms(st.max)}`
      );
    if (stt)
      console.log(
        `  stream total     : min ${ms(stt.min)} | avg ${ms(stt.avg)} | p50 ${ms(stt.p50)} | max ${ms(stt.max)}`
      );
  }

  console.log('\n' + '='.repeat(72));
  console.log('Note: latency includes upstream GitHub Copilot model time, not just proxy overhead.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
