import type {
  Message,
  ServerMessage,
} from "../../../shared/protocol"

export interface ChannelSyncConfig {
  channelId: string
  wsUrl: string
  authorId: string
  initialMessages?: Message[]
}

const TYPING_REFRESH_MS = 2000
const TYPING_STALE_MS = 3500

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SyncApi = {
  begin: (opts?: { immediate?: boolean }) => void
  write: (...args: Array<any>) => void
  commit: () => void
  markReady: () => void
  truncate: () => void
}

export class ChannelSync {
  private config: ChannelSyncConfig
  private ws: WebSocket | null = null
  private syncApi: SyncApi | null = null
  private collection:
    | {
        has: (key: string) => boolean
      }
    | null = null
  private disposed = false
  private isReady = false
  private seededInitialMessages = false

  public connected = false
  private connectionListeners = new Set<(connected: boolean) => void>()
  private typingListeners = new Set<() => void>()
  private typingUsers = new Set<string>()
  private typingSnapshot: string[] = []
  private typingExpirations = new Map<string, number>()
  private localTyping = false
  private lastTypingStartAt = 0

  constructor(config: ChannelSyncConfig) {
    this.config = config
  }

  onConnectionChange(fn: (connected: boolean) => void): () => void {
    this.connectionListeners.add(fn)
    return () => this.connectionListeners.delete(fn)
  }

  subscribeTyping(fn: () => void): () => void {
    this.typingListeners.add(fn)
    return () => this.typingListeners.delete(fn)
  }

  getTypingUsers(): string[] {
    return this.typingSnapshot
  }

  getCollectionConfig() {
    return {
      id: `messages-${this.config.channelId}`,
      getKey: (msg: Message) => msg.id,
      sync: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sync: (params: any) => {
          const { collection, begin, write, commit, markReady, truncate } = params
          this.collection = collection
          this.syncApi = { begin, write, commit, markReady, truncate } as SyncApi
          this.seedInitialMessages()
          this.connect()

          return () => {
            this.disposed = true
            this.disconnect()
          }
        },
        rowUpdateMode: "full" as const,
      },
    }
  }

  private connect() {
    if (this.disposed) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.ws = new WebSocket(this.config.wsUrl)

    this.ws.onopen = () => {
      this.setConnected(true)
      this.ws?.send(
        JSON.stringify({
          type: "subscribe",
          channelId: this.config.channelId,
        })
      )
    }

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      this.handleServerMessage(message)
    }

    this.ws.onclose = () => {
      this.ws = null
      this.setConnected(false)
      if (!this.disposed) {
        window.setTimeout(() => this.connect(), 1000)
      }
    }

    this.ws.onerror = () => {
      this.setConnected(false)
    }
  }

  private seedInitialMessages() {
    if (!this.syncApi || this.seededInitialMessages) return

    const initialMessages = this.config.initialMessages ?? []
    const { begin, write, commit, markReady } = this.syncApi

    begin()
    for (const message of initialMessages) {
      write({ type: "insert", value: message })
    }
    commit()

    if (!this.isReady) {
      markReady()
      this.isReady = true
    }

    this.seededInitialMessages = true
  }

  private disconnect() {
    if (this.ws) {
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.close()
      this.ws = null
    }
    this.setConnected(false)
  }

  private setConnected(value: boolean) {
    if (this.connected === value) return
    this.connected = value
    for (const fn of this.connectionListeners) fn(value)
  }

  setTyping(active: boolean) {
    if (active) {
      const now = Date.now()
      if (!this.localTyping || now - this.lastTypingStartAt >= TYPING_REFRESH_MS) {
        this.localTyping = true
        this.lastTypingStartAt = now
        this.sendClientMessage({
          type: "typing.start",
          channelId: this.config.channelId,
          authorId: this.config.authorId,
        })
      }
      return
    }

    if (!this.localTyping) return
    this.localTyping = false
    this.sendClientMessage({
      type: "typing.stop",
      channelId: this.config.channelId,
      authorId: this.config.authorId,
    })
  }

  private sendClientMessage(message: object) {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(message))
  }

  private updateTypingSnapshot() {
    this.typingSnapshot = Array.from(this.typingUsers).sort()
    for (const fn of this.typingListeners) fn()
  }

  private markUserTyping(authorId: string) {
    if (authorId === this.config.authorId) return

    const existingTimer = this.typingExpirations.get(authorId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    this.typingUsers.add(authorId)
    this.typingExpirations.set(
      authorId,
      window.setTimeout(() => {
        this.typingExpirations.delete(authorId)
        this.typingUsers.delete(authorId)
        this.updateTypingSnapshot()
      }, TYPING_STALE_MS)
    )
    this.updateTypingSnapshot()
  }

  private clearUserTyping(authorId: string) {
    const existingTimer = this.typingExpirations.get(authorId)
    if (existingTimer) {
      clearTimeout(existingTimer)
      this.typingExpirations.delete(authorId)
    }
    if (this.typingUsers.delete(authorId)) {
      this.updateTypingSnapshot()
    }
  }

  private handleServerMessage(message: ServerMessage) {
    if (!this.syncApi) return
    const { begin, write, commit, markReady, truncate } = this.syncApi

    switch (message.type) {
      case "snapshot": {
        truncate()
        begin()
        for (const row of message.messages) {
          write({ type: "insert", value: row })
        }
        commit()
        break
      }

      case "snapshot-end": {
        if (!this.isReady) {
          markReady()
        }
        this.isReady = true
        break
      }

      case "message.created": {
        begin()
        write({
          type: this.collection?.has(message.message.id) ? "update" : "insert",
          value: message.message,
        })
        commit()
        break
      }

      case "message.updated": {
        begin()
        write({
          type: this.collection?.has(message.message.id) ? "update" : "insert",
          value: message.message,
        })
        commit()
        break
      }

      case "message.deleted": {
        begin()
        write({ type: "delete", key: message.id })
        commit()
        break
      }

      case "ack":
      case "must-refetch":
        break

      case "typing.started": {
        this.markUserTyping(message.authorId)
        break
      }

      case "typing.stopped": {
        this.clearUserTyping(message.authorId)
        break
      }
    }
  }
}
