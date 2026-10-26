import type { IncomingMessage, ServerResponse } from "node:http"
import { handleApi } from "../server/handlers"
import { toWebRequest } from "../server/node-adapter"

export const maxDuration = 60

export const config = {
  api: { bodyParser: false },
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const request = await toWebRequest(req)
    const response = await handleApi(request)
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error("API handler failed", error instanceof Error ? error.message : "unknown")
    res.statusCode = 500
    res.setHeader("content-type", "application/json; charset=utf-8")
    res.end(JSON.stringify({ detail: "Something went wrong. Please try again." }))
  }
}
