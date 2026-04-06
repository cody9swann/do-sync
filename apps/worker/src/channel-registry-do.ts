import { DurableObject } from "cloudflare:workers"
import {
  type Channel,
  type ChannelRegistrySubscribeMessage,
  type ServerMessage,
  slugifyChannelName,
} from "../../shared/protocol"

const WORKSPACE_ID = "demo-workspace"
const DEFAULT_CHANNELS = ["general", "random", "watercooler", "new-biz"]

export class ChannelRegistryDO extends DurableObject {
  private initialized = false

  private json(data: unknown, init?: ResponseInit) {
    return Response.json(data, init)
  }

  private ensureInitialized() {
    if (this.initialized) return

    const sql = this.ctx.storage.sql
    sql.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name         TEXT NOT NULL,
        created_at   TEXT NOT NULL
      )
    `)

    const now = new Date().toISOString()
    for (const name of DEFAULT_CHANNELS) {
      sql.exec(
        `INSERT OR IGNORE INTO channels (id, workspace_id, name, created_at)
         VALUES (?, ?, ?, ?)`,
        slugifyChannelName(name),
        WORKSPACE_ID,
        name,
        now
      )
    }

    this.initialized = true
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureInitialized()

    const url = new URL(request.url)

    if (url.pathname === "/ws/channels") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected websocket", { status: 426 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname !== "/api/channels") {
      return new Response("Not found", { status: 404 })
    }

    if (request.method === "GET") {
      return this.json({ channels: this.listChannels() })
    }

    if (request.method === "POST") {
      const payload = (await request.json().catch(() => null)) as { id?: string; name?: string } | null
      const rawName = payload?.name?.trim() ?? ""
      if (!rawName) {
        return this.json({ error: "Channel name required" }, { status: 400 })
      }

      const channelId = payload?.id?.trim() || slugifyChannelName(rawName)
      if (!channelId) {
        return this.json({ error: "Channel name invalid" }, { status: 400 })
      }

      const sql = this.ctx.storage.sql
      const existingRows = Array.from(
        sql.exec(
          `SELECT id, workspace_id, name, created_at
           FROM channels
           WHERE id = ?
           LIMIT 1`,
          channelId
        )
      ) as Array<{ id: string; workspace_id: string; name: string; created_at: string }>
      const existing = existingRows[0]

      if (existing) {
        return this.json({
          channel: mapChannelRow(existing),
        })
      }

      const channel = {
        id: channelId,
        workspaceId: WORKSPACE_ID,
        name: rawName,
        createdAt: new Date().toISOString(),
      } satisfies Channel

      sql.exec(
        `INSERT INTO channels (id, workspace_id, name, created_at)
         VALUES (?, ?, ?, ?)`,
        channel.id,
        channel.workspaceId,
        channel.name,
        channel.createdAt
      )

      this.broadcast({
        type: "channel.created",
        channel,
      })

      return this.json({ channel }, { status: 201 })
    }

    return new Response("Method not allowed", { status: 405 })
  }

  private listChannels(): Channel[] {
    return Array.from(
      this.ctx.storage.sql.exec(
        `SELECT id, workspace_id, name, created_at
         FROM channels
         ORDER BY created_at ASC, id ASC`
      )
    ).map((row) =>
      mapChannelRow(row as { id: string; workspace_id: string; name: string; created_at: string })
    )
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message)
    const msg = JSON.parse(text) as ChannelRegistrySubscribeMessage

    if (msg.type === "channels.subscribe") {
      this.send(ws, {
        type: "channels.snapshot",
        channels: this.listChannels(),
      })
    }
  }

  async webSocketError(ws: WebSocket) {
    ws.close()
  }

  private send(ws: WebSocket, message: ServerMessage) {
    ws.send(JSON.stringify(message))
  }

  private broadcast(message: ServerMessage) {
    const payload = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload)
      } catch {
        ws.close()
      }
    }
  }
}

function mapChannelRow(row: {
  id: string
  workspace_id: string
  name: string
  created_at: string
}): Channel {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    createdAt: row.created_at,
  }
}
