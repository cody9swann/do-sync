import type { Channel, ServerMessage } from "../../../shared/protocol"

type SyncApi = {
  begin: (opts?: { immediate?: boolean }) => void
  write: (operation: { type: "insert" | "update" | "delete"; value?: Channel; key?: string }) => void
  commit: () => void
  markReady: () => void
  truncate: () => void
}

export interface ChannelRegistrySyncConfig {
  wsUrl: string
  mergeSnapshot?: (channels: Channel[]) => Channel[]
  hasPendingMutationForChannel?: (channelId: string) => boolean
  isDemoOffline?: () => boolean
  subscribeDemoOffline?: (listener: () => void) => () => void
}

export class ChannelRegistrySync {
  private ws: WebSocket | null = null
  private syncApi: SyncApi | null = null
  private collection: { has: (key: string) => boolean } | null = null
  private disposed = false
  private ready = false
  private hasSnapshot = false
  private cleanupDemoOffline: (() => void) | null = null

  constructor(private config: ChannelRegistrySyncConfig) {}

  getCollectionConfig() {
    return {
      id: "channels",
      getKey: (channel: Channel) => channel.id,
      sync: {
        sync: (params: any) => {
          const { collection, begin, write, commit, markReady, truncate } = params
          this.collection = collection
          this.syncApi = { begin, write, commit, markReady, truncate }
          if (!this.ready) {
            markReady()
            this.ready = true
          }
          this.cleanupDemoOffline = this.config.subscribeDemoOffline?.(() => {
            if (this.config.isDemoOffline?.()) {
              this.disconnect()
              return
            }
            this.connect()
          }) ?? null
          this.connect()

          return () => {
            this.dispose()
          }
        },
        rowUpdateMode: "full" as const,
      },
    }
  }

  seedFromPersistence(channels: Channel[]) {
    if (this.hasSnapshot || !this.syncApi) return
    this.applySnapshot(channels)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.cleanupDemoOffline?.()
    this.cleanupDemoOffline = null
    this.disconnect()
  }

  private connect() {
    if (this.disposed) return
    if (this.config.isDemoOffline?.()) return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.ws = new WebSocket(this.config.wsUrl)

    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({ type: "channels.subscribe" }))
    }

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as ServerMessage
      this.handleServerMessage(message)
    }

    this.ws.onclose = () => {
      this.ws = null
      if (!this.disposed) {
        window.setTimeout(() => this.connect(), 1000)
      }
    }

    this.ws.onerror = () => {
      this.disconnect()
    }
  }

  private disconnect() {
    if (!this.ws) return
    this.ws.onclose = null
    this.ws.onerror = null
    this.ws.onmessage = null
    this.ws.close()
    this.ws = null
  }

  private applySnapshot(channels: Channel[]) {
    if (!this.syncApi) return
    this.hasSnapshot = true
    const nextChannels = this.config.mergeSnapshot
      ? this.config.mergeSnapshot(channels)
      : channels
    const { begin, truncate, write, commit, markReady } = this.syncApi

    begin()
    truncate()
    for (const channel of nextChannels) {
      write({ type: "insert", value: channel })
    }
    commit()

    if (!this.ready) {
      markReady()
      this.ready = true
    }
  }

  private applyUpsert(channel: Channel) {
    if (!this.syncApi) return
    if (this.config.hasPendingMutationForChannel?.(channel.id)) return
    const { begin, write, commit } = this.syncApi

    begin({ immediate: true })
    write({
      type: this.collection?.has(channel.id) ? "update" : "insert",
      value: channel,
    })
    commit()
  }

  private handleServerMessage(message: ServerMessage) {
    switch (message.type) {
      case "channels.snapshot":
        this.applySnapshot(message.channels)
        break
      case "channel.created":
        this.applyUpsert(message.channel)
        break
    }
  }
}
