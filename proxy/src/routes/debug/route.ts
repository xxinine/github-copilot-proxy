import { Hono } from "hono"

import { getRequestTraces } from "~/lib/request-trace"

export const debugRoutes = new Hono()

debugRoutes.get("/requests", (c) =>
  c.json({
    object: "list",
    data: getRequestTraces(),
  }),
)
