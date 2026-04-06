import { ChannelDO } from "./channel-do"
import { ChannelRegistryDO } from "./channel-registry-do"

// Re-export the Durable Object class so wrangler can find it.
export { ChannelDO }
export { ChannelRegistryDO }

interface Env {
  CHANNEL_DO: DurableObjectNamespace
  CHANNEL_REGISTRY_DO: DurableObjectNamespace
}

function withCors(request: Request, response: Response) {
  const origin = request.headers.get("Origin") ?? "*"
  const headers = new Headers(response.headers)

  headers.set("Access-Control-Allow-Origin", origin)
  headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
  headers.set("Access-Control-Allow-Headers", "Content-Type")
  headers.set("Access-Control-Allow-Credentials", "false")
  headers.set("Vary", "Origin")

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === "OPTIONS") {
      return withCors(request, new Response(null, { status: 204 }))
    }

    if (url.pathname === "/ws/channels") {
      const id = env.CHANNEL_REGISTRY_DO.idFromName("channels")
      const stub = env.CHANNEL_REGISTRY_DO.get(id)
      return stub.fetch(request)
    }

    // Route: /ws/:channelId → upgrade to WebSocket and proxy to ChannelDO.
    // Each channel maps to exactly one Durable Object instance (by name).
    const match = url.pathname.match(/^\/ws\/([^/]+)$/)
    if (match) {
      const channelId = match[1]
      const id = env.CHANNEL_DO.idFromName(channelId)
      const stub = env.CHANNEL_DO.get(id)
      return stub.fetch(request)
    }

    const apiMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages(?:\/([^/]+))?$/)
    if (apiMatch) {
      const channelId = apiMatch[1]
      const id = env.CHANNEL_DO.idFromName(channelId)
      const stub = env.CHANNEL_DO.get(id)
      return withCors(request, await stub.fetch(request))
    }

    if (url.pathname === "/api/channels") {
      const id = env.CHANNEL_REGISTRY_DO.idFromName("channels")
      const stub = env.CHANNEL_REGISTRY_DO.get(id)
      return withCors(request, await stub.fetch(request))
    }

    // Health check endpoint.
    if (url.pathname === "/health") {
      return withCors(request, new Response("ok", { status: 200 }))
    }

    return withCors(request, new Response("Not found", { status: 404 }))
  },
}
