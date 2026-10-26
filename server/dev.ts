import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import { handleApi } from "./handlers"
import { toWebRequest } from "./node-adapter"

/** Serves the same functions as Vercel while `npm run dev` is running. */
export function voiceApiPlugin(): Plugin {
  return {
    name: "voice-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ""
        if (!url.startsWith("/api/")) {
          next()
          return
        }
        try {
          const request = await toWebRequest(req as IncomingMessage)
          const response = await handleApi(request)
          const nodeRes = res as ServerResponse
          nodeRes.statusCode = response.status
          response.headers.forEach((value, key) => nodeRes.setHeader(key, value))
          nodeRes.end(Buffer.from(await response.arrayBuffer()))
        } catch (error) {
          console.error("Dev API failed", error instanceof Error ? error.message : "unknown")
          const nodeRes = res as ServerResponse
          nodeRes.statusCode = 500
          nodeRes.setHeader("content-type", "application/json")
          nodeRes.end(JSON.stringify({ detail: "Something went wrong. Please try again." }))
        }
      })
    },
  }
}
