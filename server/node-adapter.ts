import type { IncomingMessage } from "node:http"

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || "localhost"
  const forwarded = req.headers["x-forwarded-proto"]
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || "https"
  const raw = await readRaw(req)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue
    if (key === "content-length" || key === "transfer-encoding" || key === "host") continue
    headers.set(key, Array.isArray(value) ? value.join(",") : value)
  }
  const method = req.method || "GET"
  const hasBody = method !== "GET" && method !== "HEAD"
  return new Request(`${proto}://${host}${req.url || "/"}`, {
    method,
    headers,
    body: hasBody ? raw : undefined,
  })
}
