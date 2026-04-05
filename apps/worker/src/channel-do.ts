import { DurableObject } from "cloudflare:workers"
import type {
  Message,
  ClientMessage,
  ServerMessage,
  MessageCreateMessage,
  MessageUpdateMessage,
  MessageDeleteMessage,
  TypingStartMessage,
  TypingStopMessage,
} from "../../shared/protocol"

// ============================================================================
// ChannelDO — authoritative sync engine for a single channel.
//
// Responsibilities:
// - Stores canonical message state in SQLite.
// - Assigns a monotonically increasing `seq` to every mutation.
// - Maintains an event log so reconnecting clients can replay missed events.
// - Broadcasts canonical events to all connected WebSockets.
// - Sends ack to the originating client.
//
// Key invariants:
// - seq is strictly monotonic per channel (one DO per channel).
// - Every mutation is persisted AND logged before ack/broadcast.
// - Snapshot returns all messages + current seq.
// - Replay returns all events with seq > lastSeq.
// - If the log doesn't cover lastSeq, sends must-refetch.
// ============================================================================

interface Env {
  CHANNEL_DO: DurableObjectNamespace
}

type CanonicalMutationEvent =
  | Extract<ServerMessage, { type: "message.created" }>
  | Extract<ServerMessage, { type: "message.updated" }>
  | Extract<ServerMessage, { type: "message.deleted" }>

/** Maximum number of event log entries to keep. Older entries are pruned. */
const MAX_EVENT_LOG_SIZE = 10_000

export class ChannelDO extends DurableObject<Env> {
  private initialized = false

  private json(data: unknown, init?: ResponseInit) {
    return Response.json(data, init)
  }

  // --------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------

  private ensureInitialized() {
    if (this.initialized) return

    const sql = this.ctx.storage.sql

    sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        channel_id   TEXT NOT NULL,
        author_id    TEXT NOT NULL,
        body         TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        updated_at   TEXT,
        created_seq  INTEGER NOT NULL
      )
    `)
    const messageColumns = [
      ...sql.exec(`PRAGMA table_info(messages)`),
    ] as Array<{ name: string }>
    const hasCreatedSeq = messageColumns.some((column) => column.name === "created_seq")
    if (!hasCreatedSeq) {
      sql.exec(`ALTER TABLE messages ADD COLUMN created_seq INTEGER`)
      sql.exec(`
        UPDATE messages
        SET created_seq = CAST(strftime('%s', created_at) AS INTEGER)
        WHERE created_seq IS NULL
      `)
    }

    // Stores current_seq — the last assigned sequence number.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `)
    sql.exec(`INSERT OR IGNORE INTO meta (key, value) VALUES ('current_seq', '0')`)

    // Event log: every canonical mutation is appended here so reconnecting
    // clients can replay missed events instead of downloading a full snapshot.
    sql.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        seq         INTEGER PRIMARY KEY,
        type        TEXT NOT NULL,
        entity_id   TEXT NOT NULL,
        mutation_id TEXT,
        temp_id     TEXT,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      )
    `)
    sql.exec(`
      CREATE TABLE IF NOT EXISTS mutation_receipts (
        mutation_id TEXT PRIMARY KEY,
        seq         INTEGER NOT NULL,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL
      )
    `)
    sql.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS event_log_mutation_id_idx
      ON event_log (mutation_id)
      WHERE mutation_id IS NOT NULL
    `)

    this.initialized = true
  }

  // --------------------------------------------------------------------
  // Seq management
  // --------------------------------------------------------------------

  /** Atomically increment and return the next seq. */
  private nextSeq(): number {
    const row = this.ctx.storage.sql
      .exec(
        `UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)
         WHERE key = 'current_seq'
         RETURNING CAST(value AS INTEGER) AS seq`
      )
      .one() as { seq: number }
    return row.seq
  }

  private currentSeq(): number {
    const row = this.ctx.storage.sql
      .exec(`SELECT CAST(value AS INTEGER) AS seq FROM meta WHERE key = 'current_seq'`)
      .one() as { seq: number }
    return row.seq
  }

  // --------------------------------------------------------------------
  // Messaging helpers
  // --------------------------------------------------------------------

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Client disconnected — safe to ignore.
    }
  }

  /** Broadcast a message to all connected WebSockets. */
  private broadcast(msg: ServerMessage) {
    const encoded = JSON.stringify(msg)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(encoded)
      } catch {
        // Skip disconnected clients.
      }
    }
  }

  /** Prune old event log entries to keep the table bounded. */
  private pruneEventLog() {
    const countRow = this.ctx.storage.sql
      .exec(`SELECT COUNT(*) AS cnt FROM event_log`)
      .one() as { cnt: number }
    if (countRow.cnt > MAX_EVENT_LOG_SIZE) {
      const excess = countRow.cnt - MAX_EVENT_LOG_SIZE
      this.ctx.storage.sql.exec(
        `DELETE FROM event_log WHERE seq IN (
           SELECT seq FROM event_log ORDER BY seq ASC LIMIT ?
         )`,
        excess
      )
    }
  }

  private findEventByMutationId(mutationId: string): CanonicalMutationEvent | null {
    // mutation_receipts is intentionally not pruned. This lets reconnecting
    // clients safely resend the same mutationId even after event_log replay
    // entries have aged out and a full snapshot is required.
    const rows = [
      ...this.ctx.storage.sql.exec(
        `SELECT payload
         FROM mutation_receipts
         WHERE mutation_id = ?
         LIMIT 1`,
        mutationId
      ),
    ] as Array<{ payload: string }>

    if (rows.length === 0) {
      return null
    }

    return JSON.parse(rows[0].payload) as CanonicalMutationEvent
  }

  private sendExistingMutationResult(ws: WebSocket, mutationId: string) {
    const event = this.findEventByMutationId(mutationId)
    if (!event) {
      return false
    }

    // Duplicate mutations can be retried safely after reconnect because
    // mutationId is stable and event_log is authoritative.
    this.send(ws, { type: "ack", mutationId, seq: event.seq })
    this.send(ws, event)
    return true
  }

  // --------------------------------------------------------------------
  // Row mapping helper
  // --------------------------------------------------------------------

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      channelId: row.channel_id as string,
      authorId: row.author_id as string,
      body: row.body as string,
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string) ?? null,
    }
  }

  private listMessages(): Message[] {
    const rows = [
      ...this.ctx.storage.sql.exec(
        `SELECT * FROM messages ORDER BY created_seq ASC, created_at ASC, id ASC`
      ),
    ] as Array<Record<string, unknown>>

    return rows.map((row) => this.rowToMessage(row))
  }

  private createCanonicalMessage(input: {
    id?: string
    workspaceId: string
    channelId: string
    authorId: string
    body: string
    mutationId?: string
    tempId?: string
  }): {
    seq: number
    message: Message
    event: Extract<ServerMessage, { type: "message.created" }>
  } {
    const seq = this.nextSeq()
    const id = input.id ?? crypto.randomUUID()
    const now = new Date().toISOString()

    const message: Message = {
      id,
      workspaceId: input.workspaceId,
      channelId: input.channelId,
      authorId: input.authorId,
      body: input.body,
      createdAt: now,
      updatedAt: null,
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO messages (
         id,
         workspace_id,
         channel_id,
         author_id,
         body,
         created_at,
         updated_at,
         created_seq
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.workspaceId,
      input.channelId,
      input.authorId,
      input.body,
      now,
      null,
      seq
    )

    const event: Extract<ServerMessage, { type: "message.created" }> = {
      type: "message.created",
      mutationId: input.mutationId,
      tempId: input.tempId,
      seq,
      message,
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO event_log (seq, type, entity_id, mutation_id, temp_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seq,
      "message.created",
      id,
      input.mutationId ?? null,
      input.tempId ?? null,
      JSON.stringify(event),
      now
    )

    if (input.mutationId) {
      this.ctx.storage.sql.exec(
        `INSERT INTO mutation_receipts (mutation_id, seq, payload, created_at)
         VALUES (?, ?, ?, ?)`,
        input.mutationId,
        seq,
        JSON.stringify(event),
        now
      )
    }

    this.pruneEventLog()
    return { seq, message, event }
  }

  private updateCanonicalMessage(input: {
    id: string
    body: string
    mutationId?: string
  }): {
    seq: number
    message: Message
    event: Extract<ServerMessage, { type: "message.updated" }>
  } | null {
    const existing = [
      ...this.ctx.storage.sql.exec(`SELECT id FROM messages WHERE id = ?`, input.id),
    ]
    if (existing.length === 0) {
      return null
    }

    const seq = this.nextSeq()
    const now = new Date().toISOString()

    this.ctx.storage.sql.exec(
      `UPDATE messages SET body = ?, updated_at = ? WHERE id = ?`,
      input.body,
      now,
      input.id
    )

    const row = this.ctx.storage.sql
      .exec(`SELECT * FROM messages WHERE id = ?`, input.id)
      .one() as Record<string, unknown>
    const message = this.rowToMessage(row)

    const event: Extract<ServerMessage, { type: "message.updated" }> = {
      type: "message.updated",
      mutationId: input.mutationId,
      seq,
      message,
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO event_log (seq, type, entity_id, mutation_id, temp_id, payload, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      seq,
      "message.updated",
      input.id,
      input.mutationId ?? null,
      JSON.stringify(event),
      now
    )

    if (input.mutationId) {
      this.ctx.storage.sql.exec(
        `INSERT INTO mutation_receipts (mutation_id, seq, payload, created_at)
         VALUES (?, ?, ?, ?)`,
        input.mutationId,
        seq,
        JSON.stringify(event),
        now
      )
    }

    this.pruneEventLog()
    return { seq, message, event }
  }

  private deleteCanonicalMessage(input: {
    id: string
    mutationId?: string
  }): {
    seq: number
    event: Extract<ServerMessage, { type: "message.deleted" }>
  } | null {
    const existing = [
      ...this.ctx.storage.sql.exec(`SELECT id FROM messages WHERE id = ?`, input.id),
    ]
    if (existing.length === 0) {
      return null
    }

    const seq = this.nextSeq()
    const now = new Date().toISOString()

    this.ctx.storage.sql.exec(`DELETE FROM messages WHERE id = ?`, input.id)

    const event: Extract<ServerMessage, { type: "message.deleted" }> = {
      type: "message.deleted",
      mutationId: input.mutationId,
      seq,
      id: input.id,
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO event_log (seq, type, entity_id, mutation_id, temp_id, payload, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      seq,
      "message.deleted",
      input.id,
      input.mutationId ?? null,
      JSON.stringify(event),
      now
    )

    if (input.mutationId) {
      this.ctx.storage.sql.exec(
        `INSERT INTO mutation_receipts (mutation_id, seq, payload, created_at)
         VALUES (?, ?, ?, ?)`,
        input.mutationId,
        seq,
        JSON.stringify(event),
        now
      )
    }

    this.pruneEventLog()
    return { seq, event }
  }

  // ====================================================================
  // WebSocket lifecycle (Hibernatable WebSocket API)
  // ====================================================================

  async fetch(request: Request): Promise<Response> {
    this.ensureInitialized()

    const url = new URL(request.url)

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.ctx.acceptWebSocket(server)

      return new Response(null, { status: 101, webSocket: client })
    }

    const listMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages$/)
    if (listMatch && request.method === "GET") {
      return this.json({ messages: this.listMessages() })
    }

    if (listMatch && request.method === "POST") {
      const body = (await request.json()) as {
        mutationId?: string
        id?: string
        workspaceId: string
        channelId: string
        authorId: string
        body: string
      }

      if (body.mutationId) {
        const existing = this.findEventByMutationId(body.mutationId)
        if (existing?.type === "message.created") {
          return this.json({ message: existing.message })
        }
      }

      const created = this.createCanonicalMessage(body)
      this.broadcast(created.event)
      return this.json({ message: created.message }, { status: 201 })
    }

    const itemMatch = url.pathname.match(/^\/api\/channels\/([^/]+)\/messages\/([^/]+)$/)
    if (itemMatch && request.method === "PATCH") {
      const body = (await request.json()) as { body: string; mutationId?: string }

      if (body.mutationId) {
        const existing = this.findEventByMutationId(body.mutationId)
        if (existing?.type === "message.updated") {
          return this.json({ message: existing.message })
        }
      }

      const updated = this.updateCanonicalMessage({
        id: itemMatch[2],
        body: body.body,
        mutationId: body.mutationId,
      })

      if (!updated) {
        return this.json({ error: "Message not found" }, { status: 404 })
      }

      this.broadcast(updated.event)
      return this.json({ message: updated.message })
    }

    if (itemMatch && request.method === "DELETE") {
      let mutationId: string | undefined
      try {
        const body = (await request.json()) as { mutationId?: string }
        mutationId = body.mutationId
      } catch {
        mutationId = undefined
      }

      if (mutationId) {
        const existing = this.findEventByMutationId(mutationId)
        if (existing?.type === "message.deleted") {
          return this.json({ ok: true })
        }
      }

      const deleted = this.deleteCanonicalMessage({
        id: itemMatch[2],
        mutationId,
      })

      if (!deleted) {
        return this.json({ error: "Message not found" }, { status: 404 })
      }

      this.broadcast(deleted.event)
      return this.json({ ok: true })
    }

    return new Response("Not found", { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    this.ensureInitialized()

    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw)
    const msg = JSON.parse(text) as ClientMessage

    switch (msg.type) {
      case "subscribe":
        return this.handleSubscribe(ws, msg)
      case "message.create":
        return this.handleMessageCreate(ws, msg)
      case "message.update":
        return this.handleMessageUpdate(ws, msg)
      case "message.delete":
        return this.handleMessageDelete(ws, msg)
      case "typing.start":
        return this.handleTypingStart(msg)
      case "typing.stop":
        return this.handleTypingStop(msg)
    }
  }

  async webSocketClose(_ws: WebSocket) {
    // getWebSockets() automatically excludes closed sockets — nothing to clean up.
  }

  async webSocketError(ws: WebSocket) {
    ws.close()
  }

  // ====================================================================
  // Protocol handlers
  // ====================================================================

  // ------------------------------------------------------------------
  // subscribe
  //
  // If the client sends lastSeq, we try to replay missed events from the
  // event log. This avoids a full snapshot on every reconnect.
  //
  // If the event log doesn't go back far enough (pruned), we send
  // must-refetch so the client knows to request a fresh snapshot.
  //
  // If no lastSeq is provided (or lastSeq === 0), we send a full snapshot.
  // ------------------------------------------------------------------

  private handleSubscribe(ws: WebSocket, msg: { channelId: string; lastSeq?: number }) {
    const seq = this.currentSeq()

    if (msg.lastSeq != null && msg.lastSeq > 0) {
      // Client already has state up to lastSeq — try replay.
      if (msg.lastSeq >= seq) {
        // Client is already caught up.
        this.send(ws, { type: "snapshot-end", seq })
        return
      }

      const minRow = this.ctx.storage.sql
        .exec(`SELECT MIN(seq) AS min_seq FROM event_log`)
        .one() as { min_seq: number | null }

      const minAvailable = minRow.min_seq ?? seq + 1

      if (msg.lastSeq >= minAvailable - 1) {
        // Replay all events after lastSeq.
        const events = [
          ...this.ctx.storage.sql.exec(
            `SELECT payload FROM event_log WHERE seq > ? ORDER BY seq ASC`,
            msg.lastSeq
          ),
        ] as Array<{ payload: string }>

        for (const event of events) {
          this.send(ws, JSON.parse(event.payload) as ServerMessage)
        }
        this.send(ws, { type: "snapshot-end", seq })
        return
      }

      // Event log doesn't cover lastSeq — client must refetch.
      this.send(ws, { type: "must-refetch" })
      return
    }

    // No lastSeq — send full snapshot.
    const rows = [...this.ctx.storage.sql.exec(
      `SELECT * FROM messages ORDER BY created_seq ASC, created_at ASC, id ASC`
    )] as Array<Record<string, unknown>>

    const messages: Message[] = rows.map((r) => this.rowToMessage(r))

    this.send(ws, { type: "snapshot", seq, messages })
    this.send(ws, { type: "snapshot-end", seq })
  }

  // ------------------------------------------------------------------
  // message.create
  //
  // 1. Server assigns a canonical id (UUID) and the next seq.
  // 2. Persists the message in SQLite.
  // 3. Appends the event to the event log (for replay).
  // 4. Sends ack to the originating client.
  // 5. Broadcasts the canonical event to ALL clients (including sender).
  //
  // The originating client matches mutationId to reconcile its optimistic
  // insert (keyed by tempId) with the canonical row (keyed by server id).
  // ------------------------------------------------------------------

  private handleMessageCreate(ws: WebSocket, msg: MessageCreateMessage) {
    if (this.sendExistingMutationResult(ws, msg.mutationId)) {
      return
    }

    const created = this.createCanonicalMessage({
      workspaceId: msg.workspaceId,
      channelId: msg.channelId,
      authorId: msg.authorId,
      body: msg.body,
      mutationId: msg.mutationId,
      tempId: msg.tempId,
    })

    // Ack the originator, then broadcast to everyone.
    this.send(ws, { type: "ack", mutationId: msg.mutationId, seq: created.seq })
    this.broadcast(created.event)
  }

  // ------------------------------------------------------------------
  // message.update
  // ------------------------------------------------------------------

  private handleMessageUpdate(ws: WebSocket, msg: MessageUpdateMessage) {
    if (this.sendExistingMutationResult(ws, msg.mutationId)) {
      return
    }

    const updated = this.updateCanonicalMessage({
      id: msg.id,
      body: msg.body,
      mutationId: msg.mutationId,
    })
    if (!updated) return

    this.send(ws, { type: "ack", mutationId: msg.mutationId, seq: updated.seq })
    this.broadcast(updated.event)
  }

  // ------------------------------------------------------------------
  // message.delete
  // ------------------------------------------------------------------

  private handleMessageDelete(ws: WebSocket, msg: MessageDeleteMessage) {
    if (this.sendExistingMutationResult(ws, msg.mutationId)) {
      return
    }

    const deleted = this.deleteCanonicalMessage({
      id: msg.id,
      mutationId: msg.mutationId,
    })
    if (!deleted) return

    this.send(ws, { type: "ack", mutationId: msg.mutationId, seq: deleted.seq })
    this.broadcast(deleted.event)
  }

  private handleTypingStart(msg: TypingStartMessage) {
    this.broadcast({
      type: "typing.started",
      channelId: msg.channelId,
      authorId: msg.authorId,
    })
  }

  private handleTypingStop(msg: TypingStopMessage) {
    this.broadcast({
      type: "typing.stopped",
      channelId: msg.channelId,
      authorId: msg.authorId,
    })
  }
}
