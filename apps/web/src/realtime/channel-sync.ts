import type { Message, ServerMessage } from "../../../shared/protocol"

export interface ChannelSyncDriver {
  replaceChannelSnapshot: (channelId: string, messages: Message[]) => void
  applyServerUpsert: (message: Message) => void
  applyServerDelete: (messageId: string) => void
  markChannelReady: (channelId: string) => void
}

export interface ChannelSyncConfig {
  channelId: string
  wsUrl: string
  authorId: string
  connectLive?: boolean
  loadSnapshot?: () => Promise<Message[]>
  mergeSnapshot?: (messages: Message[]) => Message[]
  hasPendingMutationForMessage?: (messageId: string) => boolean
  isDemoOffline?: () => boolean
  subscribeDemoOffline?: (listener: () => void) => () => void
  driver: ChannelSyncDriver
}

const TYPING_REFRESH_MS = 2_000
const TYPING_STALE_MS = 3_500

export class ChannelSync {
  private ws: WebSocket | null = null
  private disposed = false
  private liveEnabled: boolean
  private refreshInFlight: Promise<void> | null = null
  private startupRefreshTimer: number | null = null
  private cleanupDemoOffline: (() => void) | null = null

  public connected = false
  private connectionListeners = new Set<(connected: boolean) => void>()
  private typingListeners = new Set<() => void>()
  private typingUsers = new Set<string>()
  private typingSnapshot: string[] = []
  private typingExpirations = new Map<string, number>()
  private localTyping = false
  private lastTypingStartAt = 0
  private readonly handleWindowFocus = () => {
    void this.refreshAuthoritativeSnapshot()
    this.connect()
  }
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      void this.refreshAuthoritativeSnapshot()
      this.connect()
    }
  }
  private readonly handlePageShow = () => {
    void this.refreshAuthoritativeSnapshot()
    this.connect()
  }

  constructor(private config: ChannelSyncConfig) {
    this.liveEnabled = config.connectLive ?? false
    this.cleanupDemoOffline =
      this.config.subscribeDemoOffline?.(() => {
        if (this.config.isDemoOffline?.()) {
          this.disconnect()
          return
        }

        if (this.liveEnabled) {
          this.connect()
          void this.refreshAuthoritativeSnapshot()
        }
      }) ?? null

    if (this.liveEnabled) {
      this.registerWindowListeners()
      this.connect()
      this.scheduleStartupRefresh()
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.unregisterWindowListeners()
    this.cleanupDemoOffline?.()
    this.cleanupDemoOffline = null
    this.clearTypingState()
    this.disconnect()
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

  activateLive() {
    if (this.disposed) return
    if (this.liveEnabled) return
    this.liveEnabled = true
    this.registerWindowListeners()
    this.connect()
    void this.refreshAuthoritativeSnapshot()
    this.scheduleStartupRefresh()
  }

  prefetchSnapshot() {
    if (this.disposed) return Promise.resolve()
    return this.refreshAuthoritativeSnapshot()
  }

  deactivateLive() {
    if (!this.liveEnabled) return
    this.liveEnabled = false
    this.localTyping = false
    this.unregisterWindowListeners()
    this.clearTypingState()
    this.disconnect()
  }

  setTyping(active: boolean) {
    if (!this.liveEnabled) return
    if (this.config.isDemoOffline?.()) return

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

  private applySnapshot(messages: Message[]) {
    const nextMessages = this.config.mergeSnapshot
      ? this.config.mergeSnapshot(messages)
      : messages
    this.config.driver.replaceChannelSnapshot(this.config.channelId, nextMessages)
    this.config.driver.markChannelReady(this.config.channelId)
  }

  private async refreshAuthoritativeSnapshot() {
    if (!this.config.loadSnapshot) return
    if (this.refreshInFlight) return this.refreshInFlight

    this.refreshInFlight = (async () => {
      try {
        const messages = await this.config.loadSnapshot!()
        this.applySnapshot(messages)
      } catch {
        // Ignore transient failures. Reconnect and later refreshes will retry.
      } finally {
        this.refreshInFlight = null
      }
    })()

    return this.refreshInFlight
  }

  private scheduleStartupRefresh() {
    if (!this.liveEnabled) return
    if (this.startupRefreshTimer != null) {
      window.clearTimeout(this.startupRefreshTimer)
    }

    this.startupRefreshTimer = window.setTimeout(() => {
      this.startupRefreshTimer = null
      void this.refreshAuthoritativeSnapshot()
    }, 300)
  }

  private connect() {
    if (this.disposed) return
    if (!this.liveEnabled) return
    if (this.config.isDemoOffline?.()) return
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
      void this.refreshAuthoritativeSnapshot()
    }

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      this.handleServerMessage(message)
    }

    this.ws.onclose = () => {
      this.ws = null
      this.setConnected(false)
      if (!this.disposed && this.liveEnabled) {
        window.setTimeout(() => this.connect(), 1_000)
      }
    }

    this.ws.onerror = () => {
      this.setConnected(false)
    }
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

  private sendClientMessage(message: object) {
    if (!this.liveEnabled) return
    if (this.config.isDemoOffline?.()) return
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(message))
  }

  private updateTypingSnapshot() {
    this.typingSnapshot = Array.from(this.typingUsers).sort()
    for (const fn of this.typingListeners) fn()
  }

  private clearTypingState() {
    for (const timer of this.typingExpirations.values()) {
      window.clearTimeout(timer)
    }
    this.typingExpirations.clear()
    this.typingUsers.clear()
    this.typingSnapshot = []
    for (const fn of this.typingListeners) fn()
  }

  private markUserTyping(authorId: string) {
    if (authorId === this.config.authorId) return

    const existingTimer = this.typingExpirations.get(authorId)
    if (existingTimer) {
      window.clearTimeout(existingTimer)
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
      window.clearTimeout(existingTimer)
      this.typingExpirations.delete(authorId)
    }
    if (this.typingUsers.delete(authorId)) {
      this.updateTypingSnapshot()
    }
  }

  private registerWindowListeners() {
    if (!this.liveEnabled) return
    window.addEventListener("focus", this.handleWindowFocus)
    window.addEventListener("pageshow", this.handlePageShow)
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
  }

  private unregisterWindowListeners() {
    window.removeEventListener("focus", this.handleWindowFocus)
    window.removeEventListener("pageshow", this.handlePageShow)
    document.removeEventListener("visibilitychange", this.handleVisibilityChange)
    if (this.startupRefreshTimer != null) {
      window.clearTimeout(this.startupRefreshTimer)
      this.startupRefreshTimer = null
    }
  }

  private handleServerMessage(message: ServerMessage) {
    switch (message.type) {
      case "snapshot": {
        this.applySnapshot(message.messages)
        break
      }

      case "snapshot-end": {
        this.config.driver.markChannelReady(this.config.channelId)
        break
      }

      case "message.created": {
        if (this.config.hasPendingMutationForMessage?.(message.message.id)) {
          break
        }

        this.config.driver.applyServerUpsert(message.message)
        break
      }

      case "message.updated": {
        if (this.config.hasPendingMutationForMessage?.(message.message.id)) {
          break
        }

        this.config.driver.applyServerUpsert(message.message)
        break
      }

      case "message.deleted": {
        if (this.config.hasPendingMutationForMessage?.(message.id)) {
          break
        }

        this.config.driver.applyServerDelete(message.id)
        break
      }

      case "ack":
        break

      case "must-refetch": {
        void this.refreshAuthoritativeSnapshot()
        break
      }

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
