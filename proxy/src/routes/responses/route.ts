import consola from "consola"
import { Hono } from "hono"

import { forwardError, HTTPError } from "~/lib/error"

import { handleResponses } from "./handler"

export const responsesRoutes = new Hono()

responsesRoutes.post("/", async (c) => {
  try {
    return await handleResponses(c)
  } catch (error) {
    if (error instanceof HTTPError) {
      const errorText = await error.response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(errorText)
      } catch {
        parsed = errorText
      }
      consola.error("Responses HTTP error body:", parsed)

      return new Response(errorText, {
        status: error.response.status,
        statusText: error.response.statusText,
        headers: {
          "content-type":
            error.response.headers.get("content-type") ?? "application/json",
        },
      })
    }

    return await forwardError(c, error)
  }
})
