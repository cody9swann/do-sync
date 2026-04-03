// ============================================================================
// Shared protocol types for the realtime sync engine.
//
// The ChannelDO (Durable Object) is the authoritative sync engine for one
// channel. Clients connect via WebSocket and exchange these messages.
// ============================================================================

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** Canonical message entity stored in the Durable Object SQLite database. */
export interface Message {
  id: string
  workspaceId: string
  channelId: string
  authorId: string
  body: string
  createdAt: string
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | SubscribeMessage
  | MessageCreateMessage
  | MessageUpdateMessage
  | MessageDeleteMessage
  | TypingStartMessage
  | TypingStopMessage

/** Subscribe to a channel. If lastSeq is provided, the server replays missed
 *  events. Otherwise it sends a full snapshot. */
export interface SubscribeMessage {
  type: "subscribe"
  channelId: string
  lastSeq?: number
}

/** Create a new message. The client provides a tempId for optimistic insert
 *  reconciliation — the server will assign a canonical id. */
export interface MessageCreateMessage {
  type: "message.create"
  mutationId: string
  tempId: string
  workspaceId: string
  channelId: string
  authorId: string
  body: string
}

export interface MessageUpdateMessage {
  type: "message.update"
  mutationId: string
  id: string
  body: string
}

export interface MessageDeleteMessage {
  type: "message.delete"
  mutationId: string
  id: string
}

export interface TypingStartMessage {
  type: "typing.start"
  channelId: string
  authorId: string
}

export interface TypingStopMessage {
  type: "typing.stop"
  channelId: string
  authorId: string
}

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | SnapshotMessage
  | SnapshotEndMessage
  | AckMessage
  | MessageCreatedMessage
  | MessageUpdatedMessage
  | MessageDeletedMessage
  | MustRefetchMessage
  | TypingStartedMessage
  | TypingStoppedMessage

/** Full state dump sent on first connect (or after must-refetch). */
export interface SnapshotMessage {
  type: "snapshot"
  seq: number
  messages: Message[]
}

/** Signals the end of a snapshot or replay batch. The client is now caught up
 *  to this seq and should markReady(). */
export interface SnapshotEndMessage {
  type: "snapshot-end"
  seq: number
}

/** Quick acknowledgment to the originating client that its mutation was
 *  accepted and assigned the given seq. */
export interface AckMessage {
  type: "ack"
  mutationId: string
  seq: number
}

/** Canonical create event broadcast to all connected clients. The originating
 *  client can match mutationId + tempId to reconcile its optimistic insert. */
export interface MessageCreatedMessage {
  type: "message.created"
  mutationId?: string
  tempId?: string
  seq: number
  message: Message
}

export interface MessageUpdatedMessage {
  type: "message.updated"
  mutationId?: string
  seq: number
  message: Message
}

export interface MessageDeletedMessage {
  type: "message.deleted"
  mutationId?: string
  seq: number
  id: string
}

/** Server cannot replay from the requested lastSeq (event log pruned).
 *  Client must reset and re-subscribe for a fresh snapshot. */
export interface MustRefetchMessage {
  type: "must-refetch"
}

export interface TypingStartedMessage {
  type: "typing.started"
  channelId: string
  authorId: string
}

export interface TypingStoppedMessage {
  type: "typing.stopped"
  channelId: string
  authorId: string
}
