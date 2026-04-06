import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db"
import type { Collection } from "@tanstack/react-db"
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import type { BrowserWASQLiteDatabase } from "@tanstack/browser-db-sqlite-persistence"
import { type Channel, type Message, slugifyChannelName } from "../../../shared/protocol"
import { ChannelSync, type ChannelSyncDriver } from "../realtime/channel-sync"
import { ChannelRegistrySync } from "../realtime/channel-registry-sync"

const DEFAULT_CHANNEL_ID = "general"
const WORKSPACE_ID = "demo-workspace"
const AUTHOR_ID_STORAGE_KEY = "do-sync.author-id"
const DEMO_OFFLINE_STORAGE_KEY = "do-sync.demo-offline"
const SQLITE_DATABASE_NAME = "do-sync-browser.sqlite"
const CHANNELS_SCHEMA_VERSION = 1
const MESSAGES_SCHEMA_VERSION = 2
const OUTBOX_SCHEMA_VERSION = 2
const CHANNEL_OUTBOX_SCHEMA_VERSION = 1
const OUTBOX_RETRY_BASE_MS = 1_500
const IS_BROWSER = typeof window !== "undefined"

let browserPersistencePromise: Promise<ReturnType<typeof createBrowserWASQLitePersistence<Message, string>> | null> | null =
  null
let browserDatabaseHandle: BrowserWASQLiteDatabase | null = null
let demoOffline = readLocalStorageValue(DEMO_OFFLINE_STORAGE_KEY) === "true"
const demoOfflineListeners = new Set<() => void>()

type BrowserPersistence = ReturnType<typeof createBrowserWASQLitePersistence<Message, string>>
type OutboxMutationType = "create" | "update" | "delete"
type SyncWriteOperation =
  | { type: "insert" | "update"; value: Message }
  | { type: "delete"; key: string }

interface MessageOutboxEntry {
  id: string
  mutationId: string
  channelId: string
  type: OutboxMutationType
  messageId: string
  message: Message | null
  createdAt: string
  attemptCount: number
  retryAt: string | null
  lastError: string | null
}

interface ChannelOutboxEntry {
  id: string
  channelId: string
  channel: Channel
  createdAt: string
  attemptCount: number
  retryAt: string | null
  lastError: string | null
}

function notifyDemoOfflineListeners() {
  for (const listener of demoOfflineListeners) {
    listener()
  }
}

function readLocalStorageValue(key: string) {
  if (!IS_BROWSER) return null

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalStorageValue(key: string, value: string) {
  if (!IS_BROWSER) return

  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage write failures and keep runtime state in memory.
  }
}

function isDemoOffline() {
  return demoOffline
}

function setDemoOffline(nextValue: boolean) {
  if (demoOffline === nextValue) return
  demoOffline = nextValue
  writeLocalStorageValue(DEMO_OFFLINE_STORAGE_KEY, String(nextValue))
  notifyDemoOfflineListeners()
}

function subscribeDemoOffline(listener: () => void) {
  demoOfflineListeners.add(listener)
  return () => demoOfflineListeners.delete(listener)
}

function createOfflineError() {
  return new Error("Demo offline mode enabled")
}

function normalizeAuthorId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  return trimmed.startsWith("user-") ? trimmed : `user-${trimmed}`
}

function resolveAuthorId() {
  if (!IS_BROWSER) {
    return "user-server"
  }

  const queryValue = new URLSearchParams(window.location.search).get("user")
  const fromQuery = queryValue ? normalizeAuthorId(queryValue) : ""
  if (fromQuery) {
    writeLocalStorageValue(AUTHOR_ID_STORAGE_KEY, fromQuery)
    return fromQuery
  }

  const storedValue = readLocalStorageValue(AUTHOR_ID_STORAGE_KEY)
  const fromStorage = storedValue ? normalizeAuthorId(storedValue) : ""
  if (fromStorage) {
    return fromStorage
  }

  const generated = `user-${Math.random().toString(36).slice(2, 8)}`
  writeLocalStorageValue(AUTHOR_ID_STORAGE_KEY, generated)
  return generated
}

const AUTHOR_ID = resolveAuthorId()

function resolveWorkerOrigin() {
  const configuredOrigin = import.meta.env.VITE_WORKER_ORIGIN
  const baseHref = IS_BROWSER ? window.location.href : "http://localhost:3000/"
  return configuredOrigin
    ? new URL(configuredOrigin, baseHref)
    : !IS_BROWSER
      ? new URL("http://localhost:8787")
    : new URL(
        `${window.location.protocol === "https:" ? "https:" : "http:"}//${window.location.hostname}:8787`
      )
}

function buildMessagesUrl(channelId: string) {
  const url = resolveWorkerOrigin()
  url.pathname = `/api/channels/${channelId}/messages`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function buildChannelsUrl() {
  const url = resolveWorkerOrigin()
  url.pathname = "/api/channels"
  url.search = ""
  url.hash = ""
  return url.toString()
}

function buildChannelsWebSocketUrl() {
  const url = resolveWorkerOrigin()
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws/channels"
  url.search = ""
  url.hash = ""
  return url.toString()
}

function buildMessageUrl(channelId: string, messageId: string) {
  const url = resolveWorkerOrigin()
  url.pathname = `/api/channels/${channelId}/messages/${messageId}`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function buildWebSocketUrl(channelId: string) {
  const url = resolveWorkerOrigin()
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = `/ws/${channelId}`
  url.search = ""
  url.hash = ""
  return url.toString()
}

async function loadMessages(channelId: string): Promise<Message[]> {
  if (isDemoOffline()) {
    throw createOfflineError()
  }

  const response = await fetch(buildMessagesUrl(channelId))

  if (!response.ok) {
    throw new Error(`Failed to load messages: ${response.status}`)
  }

  const data = (await response.json()) as { messages: Message[] }
  return data.messages
}

export async function listChannels(): Promise<Channel[]> {
  if (isDemoOffline()) {
    throw createOfflineError()
  }

  const response = await fetch(buildChannelsUrl())

  if (!response.ok) {
    throw new Error(`Failed to load channels: ${response.status}`)
  }

  const data = (await response.json()) as { channels: Channel[] }
  return data.channels
}

async function persistChannelCreate(input: { id: string; name: string }): Promise<Channel> {
  if (isDemoOffline()) {
    throw createOfflineError()
  }

  const response = await fetch(buildChannelsUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(`Failed to create channel: ${response.status}`)
  }

  const data = (await response.json()) as { channel: Channel }
  return data.channel
}

async function getBrowserPersistence() {
  if (!browserPersistencePromise) {
    browserPersistencePromise = (async () => {
      try {
        const database = await openBrowserWASQLiteOPFSDatabase({
          databaseName: SQLITE_DATABASE_NAME,
        })
        browserDatabaseHandle = database
        const coordinator = new BrowserCollectionCoordinator({
          dbName: SQLITE_DATABASE_NAME,
        })

        return createBrowserWASQLitePersistence<Message, string>({
          database,
          coordinator,
          schemaMismatchPolicy: "sync-present-reset",
        })
      } catch (error) {
        console.warn("[do-sync] browser SQLite persistence unavailable, falling back to memory", error)
        return null
      }
    })()
  }

  return browserPersistencePromise
}

async function createMessage(input: {
  mutationId: string
  id: string
  workspaceId: string
  channelId: string
  authorId: string
  body: string
}): Promise<Message> {
  if (isDemoOffline()) {
    throw createOfflineError()
  }

  const response = await fetch(buildMessagesUrl(input.channelId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(`Failed to create message: ${response.status}`)
  }

  const data = (await response.json()) as { message: Message }
  return data.message
}

async function saveMessageUpdate(input: {
  mutationId: string
  channelId: string
  id: string
  body: string
}): Promise<Message | null> {
  if (isDemoOffline()) {
    throw createOfflineError()
  }

  const response = await fetch(buildMessageUrl(input.channelId, input.id), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: input.body, mutationId: input.mutationId }),
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Failed to update message: ${response.status}`)
  }

  const data = (await response.json()) as { message: Message }
  return data.message
}

async function removeMessage(input: {
  mutationId: string
  channelId: string
  id: string
}): Promise<void> {
  if (isDemoOffline()) {
    throw createOfflineError()
  }

  const response = await fetch(buildMessageUrl(input.channelId, input.id), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutationId: input.mutationId }),
  })

  if (response.status === 404) {
    return
  }

  if (!response.ok) {
    throw new Error(`Failed to delete message: ${response.status}`)
  }
}

async function clearBrowserSQLitePersistence() {
  try {
    await browserDatabaseHandle?.close?.()
  } catch (error) {
    console.warn("[do-sync] failed closing browser SQLite database before reset", error)
  } finally {
    browserDatabaseHandle = null
    browserPersistencePromise = null
  }

  const getDirectory = navigator.storage?.getDirectory
  if (typeof getDirectory !== "function") {
    return
  }

  const root = await getDirectory.call(navigator.storage)
  const candidates = [
    SQLITE_DATABASE_NAME,
    `${SQLITE_DATABASE_NAME}-journal`,
    `${SQLITE_DATABASE_NAME}-wal`,
    `${SQLITE_DATABASE_NAME}-shm`,
  ]

  for (const name of candidates) {
    try {
      await root.removeEntry(name)
    } catch {
      // Ignore missing files.
    }
  }
}

async function reconcileChannelsCollection(
  collection: Collection<Channel, string>,
  channels: Channel[]
) {
  const incomingIds = new Set(channels.map((channel) => channel.id))

  for (const existingChannel of Array.from(collection.values())) {
    if (!incomingIds.has(existingChannel.id)) {
      await collection.delete(existingChannel.id).isPersisted.promise
    }
  }

  for (const channel of channels) {
    if (collection.has(channel.id)) {
      await collection.update(channel.id, (draft) => {
        draft.workspaceId = channel.workspaceId
        draft.name = channel.name
        draft.createdAt = channel.createdAt
      }).isPersisted.promise
      continue
    }

    await collection.insert(channel).isPersisted.promise
  }
}

function createChannelOutboxCollection(persistence: BrowserPersistence | null) {
  if (persistence) {
    return createCollection(
      persistedCollectionOptions<ChannelOutboxEntry, string>({
        id: "channel-outbox",
        getKey: (entry) => entry.id,
        persistence:
          persistence as unknown as ReturnType<
            typeof createBrowserWASQLitePersistence<ChannelOutboxEntry, string>
          >,
        schemaVersion: CHANNEL_OUTBOX_SCHEMA_VERSION,
      })
    ) as unknown as Collection<ChannelOutboxEntry, string>
  }

  return createCollection(
    localOnlyCollectionOptions<ChannelOutboxEntry, string>({
      id: "channel-outbox",
      getKey: (entry) => entry.id,
    })
  ) as unknown as Collection<ChannelOutboxEntry, string>
}

function sortChannelOutboxEntries(entries: ChannelOutboxEntry[]) {
  return entries.sort((left, right) => {
    const createdDiff = left.createdAt.localeCompare(right.createdAt)
    if (createdDiff !== 0) return createdDiff
    return left.id.localeCompare(right.id)
  })
}

class ChannelOutbox {
  constructor(private collection: Collection<ChannelOutboxEntry, string>) {}

  getEntries() {
    return sortChannelOutboxEntries(Array.from(this.collection.values()))
  }

  hasPendingEntries() {
    return this.collection.size > 0
  }

  hasPendingChannel(channelId: string) {
    return this.getEntries().some((entry) => entry.channelId === channelId)
  }

  applyToChannels(channels: Channel[]) {
    const map = new Map(channels.map((channel) => [channel.id, channel]))

    for (const entry of this.getEntries()) {
      map.set(entry.channelId, entry.channel)
    }

    return Array.from(map.values()).sort((left, right) => {
      const createdDiff = left.createdAt.localeCompare(right.createdAt)
      if (createdDiff !== 0) return createdDiff
      return left.id.localeCompare(right.id)
    })
  }

  async enqueueCreate(channel: Channel) {
    const existing = this.getEntries().find((entry) => entry.channelId === channel.id)
    if (existing) {
      await this.collection.update(existing.id, (draft) => {
        draft.channel = channel
        draft.retryAt = null
        draft.lastError = null
      }).isPersisted.promise
      return
    }

    await this.collection.insert({
      id: crypto.randomUUID(),
      channelId: channel.id,
      channel,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      retryAt: null,
      lastError: null,
    }).isPersisted.promise
  }

  async remove(id: string) {
    if (!this.collection.has(id)) return
    await this.collection.delete(id).isPersisted.promise
  }

  async markFailed(id: string, error: string) {
    if (!this.collection.has(id)) return
    await this.collection.update(id, (draft) => {
      draft.attemptCount += 1
      draft.retryAt = computeRetryAt(draft.attemptCount)
      draft.lastError = error
    }).isPersisted.promise
  }
}

class ChannelOutboxProcessor {
  private flushing = false
  private retryTimer: number | null = null
  private cleanupDemoOffline: (() => void) | null = null

  constructor(
    private outbox: ChannelOutbox,
    private collection: Collection<Channel, string>
  ) {}

  start() {
    window.addEventListener("online", this.handleOnline)
    const unsubscribeDemoOffline = subscribeDemoOffline(() => {
      if (isDemoOffline() || !this.outbox.hasPendingEntries()) return
      this.flushSoon()
    })
    if (this.outbox.hasPendingEntries()) {
      this.flushSoon()
    }
    this.cleanupDemoOffline = unsubscribeDemoOffline
  }

  dispose() {
    window.removeEventListener("online", this.handleOnline)
    this.cleanupDemoOffline?.()
    this.cleanupDemoOffline = null
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  flushSoon(delayMs = 0) {
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer)
    }
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, delayMs)
  }

  private handleOnline = () => {
    if (!this.outbox.hasPendingEntries()) return
    this.flushSoon()
  }

  private async flush() {
    if (this.flushing) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) return
    if (isDemoOffline()) return

    this.flushing = true
    try {
      for (const entry of this.outbox.getEntries()) {
        if (entry.retryAt && Date.parse(entry.retryAt) > Date.now()) {
          this.flushSoon(Math.max(250, Date.parse(entry.retryAt) - Date.now()))
          break
        }

        try {
          const canonical = await persistChannelCreate({
            id: entry.channel.id,
            name: entry.channel.name,
          })

          if (this.collection.has(canonical.id)) {
            await this.collection.update(canonical.id, (draft) => {
              draft.workspaceId = canonical.workspaceId
              draft.name = canonical.name
              draft.createdAt = canonical.createdAt
            }).isPersisted.promise
          } else {
            await this.collection.insert(canonical).isPersisted.promise
          }

          await this.outbox.remove(entry.id)
        } catch (error) {
          await this.outbox.markFailed(entry.id, String(error))
          this.flushSoon()
          break
        }
      }
    } finally {
      this.flushing = false
    }
  }
}

function computeRetryAt(attemptCount: number) {
  const backoffMs = Math.min(30_000, OUTBOX_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1))
  return new Date(Date.now() + backoffMs).toISOString()
}

function sortOutboxEntries(entries: MessageOutboxEntry[]) {
  return entries.sort((left, right) => {
    const createdDiff = left.createdAt.localeCompare(right.createdAt)
    if (createdDiff !== 0) return createdDiff
    return left.id.localeCompare(right.id)
  })
}

function applyOutboxEntries(messages: Message[], entries: MessageOutboxEntry[]) {
  const map = new Map(messages.map((message) => [message.id, message]))

  for (const entry of sortOutboxEntries([...entries])) {
    if (entry.type === "delete") {
      map.delete(entry.messageId)
      continue
    }

    if (entry.message) {
      map.set(entry.messageId, entry.message)
    }
  }

  return Array.from(map.values()).sort((left, right) => {
    const createdDiff = left.createdAt.localeCompare(right.createdAt)
    if (createdDiff !== 0) return createdDiff
    return left.id.localeCompare(right.id)
  })
}

function createOutboxCollection(persistence: BrowserPersistence | null) {
  if (persistence) {
    return createCollection(
      persistedCollectionOptions<MessageOutboxEntry, string>({
        id: "message-outbox",
        getKey: (entry) => entry.id,
        persistence:
          persistence as unknown as ReturnType<
            typeof createBrowserWASQLitePersistence<MessageOutboxEntry, string>
          >,
        schemaVersion: OUTBOX_SCHEMA_VERSION,
      })
    ) as unknown as Collection<MessageOutboxEntry, string>
  }

  return createCollection(
    localOnlyCollectionOptions<MessageOutboxEntry, string>({
      id: "message-outbox",
      getKey: (entry) => entry.id,
    })
  ) as unknown as Collection<MessageOutboxEntry, string>
}

class MessageOutbox {
  constructor(private collection: Collection<MessageOutboxEntry, string>) {}

  getEntries() {
    return sortOutboxEntries(Array.from(this.collection.values()))
  }

  hasPendingEntries() {
    return this.collection.size > 0
  }

  getEntriesForChannel(channelId: string) {
    return this.getEntries().filter((entry) => entry.channelId === channelId)
  }

  hasPendingMessage(messageId: string) {
    return this.getEntries().some((entry) => entry.messageId === messageId)
  }

  applyToChannelMessages(channelId: string, messages: Message[]) {
    return applyOutboxEntries(messages, this.getEntriesForChannel(channelId))
  }

  private findByMessageId(messageId: string) {
    return this.getEntries().find((entry) => entry.messageId === messageId) ?? null
  }

  async enqueueCreate(message: Message) {
    await this.collection.insert({
      id: crypto.randomUUID(),
      mutationId: crypto.randomUUID(),
      channelId: message.channelId,
      type: "create",
      messageId: message.id,
      message,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      retryAt: null,
      lastError: null,
    }).isPersisted.promise
  }

  async enqueueUpdate(message: Message) {
    const existing = this.findByMessageId(message.id)

    if (existing && (existing.type === "create" || existing.type === "update")) {
      await this.collection.update(existing.id, (draft) => {
        draft.channelId = message.channelId
        draft.message = message
        draft.retryAt = null
        draft.lastError = null
      }).isPersisted.promise
      return
    }

    await this.collection.insert({
      id: crypto.randomUUID(),
      mutationId: crypto.randomUUID(),
      channelId: message.channelId,
      type: "update",
      messageId: message.id,
      message,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      retryAt: null,
      lastError: null,
    }).isPersisted.promise
  }

  async enqueueDelete(messageId: string, channelId: string) {
    const existing = this.findByMessageId(messageId)

    if (existing?.type === "create") {
      await this.collection.delete(existing.id).isPersisted.promise
      return
    }

    if (existing?.type === "update") {
      await this.collection.delete(existing.id).isPersisted.promise
    }

    await this.collection.insert({
      id: crypto.randomUUID(),
      mutationId: crypto.randomUUID(),
      channelId,
      type: "delete",
      messageId,
      message: null,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      retryAt: null,
      lastError: null,
    }).isPersisted.promise
  }

  async remove(id: string) {
    if (!this.collection.has(id)) return
    await this.collection.delete(id).isPersisted.promise
  }

  async markFailed(id: string, error: string) {
    if (!this.collection.has(id)) return
    await this.collection.update(id, (draft) => {
      draft.attemptCount += 1
      draft.retryAt = computeRetryAt(draft.attemptCount)
      draft.lastError = error
    }).isPersisted.promise
  }
}

class SharedMessagesSyncSurface {
  private syncApi:
    | {
        begin: (opts?: { immediate?: boolean }) => void
        write: (operation: SyncWriteOperation) => void
        commit: () => void
        markReady: () => void
      }
    | null = null
  private collection: Collection<Message, string> | null = null
  private syncReady = false

  getCollectionConfig() {
    return {
      id: "messages",
      getKey: (message: Message) => message.id,
      sync: {
        sync: (params: any) => {
          const { collection, begin, write, commit, markReady } = params
          this.collection = collection
          this.syncApi = { begin, write, commit, markReady }

          if (!this.syncReady) {
            markReady()
            this.syncReady = true
          }

          return () => {
            this.collection = null
            this.syncApi = null
          }
        },
        rowUpdateMode: "full" as const,
      },
    }
  }

  replaceChannelSnapshot(channelId: string, messages: Message[]) {
    if (!this.syncApi || !this.collection) return

    const existingIds = Array.from(this.collection.values())
      .filter((message) => message.channelId === channelId)
      .map((message) => message.id)

    this.syncApi.begin()
    for (const id of existingIds) {
      this.syncApi.write({ type: "delete", key: id })
    }
    for (const message of messages) {
      this.syncApi.write({ type: "insert", value: message })
    }
    this.syncApi.commit()
  }

  applyServerUpsert(message: Message) {
    if (!this.syncApi || !this.collection) return

    this.syncApi.begin({ immediate: true })
    this.syncApi.write({
      type: this.collection.has(message.id) ? "update" : "insert",
      value: message,
    })
    this.syncApi.commit()
  }

  applyServerDelete(messageId: string) {
    if (!this.syncApi) return

    this.syncApi.begin({ immediate: true })
    this.syncApi.write({ type: "delete", key: messageId })
    this.syncApi.commit()
  }
}

class MessageOutboxProcessor {
  private flushing = false
  private retryTimer: number | null = null
  private cleanupDemoOffline: (() => void) | null = null

  constructor(
    private outbox: MessageOutbox,
    private syncSurface: SharedMessagesSyncSurface
  ) {}

  start() {
    window.addEventListener("online", this.handleOnline)
    const unsubscribeDemoOffline = subscribeDemoOffline(() => {
      if (isDemoOffline() || !this.outbox.hasPendingEntries()) return
      this.flushSoon()
    })
    if (this.outbox.hasPendingEntries()) {
      this.flushSoon()
    }
    this.cleanupDemoOffline = unsubscribeDemoOffline
  }

  dispose() {
    window.removeEventListener("online", this.handleOnline)
    this.cleanupDemoOffline?.()
    this.cleanupDemoOffline = null
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  flushSoon(delayMs = 0) {
    if (this.retryTimer != null) {
      window.clearTimeout(this.retryTimer)
    }

    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null
      void this.flush()
    }, delayMs)
  }

  private handleOnline = () => {
    if (!this.outbox.hasPendingEntries()) return
    this.flushSoon()
  }

  private async flush() {
    if (this.flushing) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) return
    if (isDemoOffline()) return

    this.flushing = true

    try {
      for (const entry of this.outbox.getEntries()) {
        if (entry.retryAt && Date.parse(entry.retryAt) > Date.now()) {
          this.flushSoon(Math.max(250, Date.parse(entry.retryAt) - Date.now()))
          break
        }

        try {
          if (entry.type === "create" && entry.message) {
            const canonical = await createMessage({
              mutationId: entry.mutationId,
              id: entry.message.id,
              workspaceId: entry.message.workspaceId,
              channelId: entry.message.channelId,
              authorId: entry.message.authorId,
              body: entry.message.body,
            })
            this.syncSurface.applyServerUpsert(canonical)
          } else if (entry.type === "update" && entry.message) {
            const canonical = await saveMessageUpdate({
              mutationId: entry.mutationId,
              channelId: entry.message.channelId,
              id: entry.message.id,
              body: entry.message.body,
            })

            if (canonical) {
              this.syncSurface.applyServerUpsert(canonical)
            }
          } else if (entry.type === "delete") {
            await removeMessage({
              mutationId: entry.mutationId,
              channelId: entry.channelId,
              id: entry.messageId,
            })
            this.syncSurface.applyServerDelete(entry.messageId)
          }

          await this.outbox.remove(entry.id)
        } catch (error) {
          await this.outbox.markFailed(entry.id, String(error))
          this.flushSoon()
          break
        }
      }
    } finally {
      this.flushing = false
    }
  }
}

export interface MessagesStore {
  collection: Collection<Message, string>
  activateChannel: (channelId: string) => void
  prefetchChannel: (channelId: string) => void
  sendMessage: (channelId: string, body: string) => Promise<void>
  updateMessage: (id: string, body: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
  setTyping: (channelId: string, active: boolean) => void
  subscribeTyping: (channelId: string, listener: () => void) => () => void
  getTypingUsers: (channelId: string) => string[]
  subscribeChannelReadiness: (listener: () => void) => () => void
  isChannelReady: (channelId: string) => boolean
  resetLocalCache: () => Promise<void>
  dispose: () => void
  isDemoOffline: () => boolean
  setDemoOffline: (value: boolean) => void
  subscribeDemoOffline: (listener: () => void) => () => void
  persisted: boolean
}

export interface ChannelsDb {
  collection: Collection<Channel, string>
  createChannel: (name: string) => Promise<Channel>
  refresh: () => Promise<void>
  dispose: () => void
  persisted: boolean
}

export async function initChannelsDb(): Promise<ChannelsDb> {
  const persistence = await getBrowserPersistence()
  const outboxCollection = createChannelOutboxCollection(persistence)
  await outboxCollection.preload()
  const outbox = new ChannelOutbox(outboxCollection)
  const sync = new ChannelRegistrySync({
    wsUrl: buildChannelsWebSocketUrl(),
    mergeSnapshot: (channels) => outbox.applyToChannels(channels),
    hasPendingMutationForChannel: (channelId) => outbox.hasPendingChannel(channelId),
    isDemoOffline,
    subscribeDemoOffline,
  })
  const collection = persistence
    ? (createCollection(
        persistedCollectionOptions<Channel, string>({
          ...sync.getCollectionConfig(),
          persistence:
            persistence as unknown as ReturnType<typeof createBrowserWASQLitePersistence<Channel, string>>,
          schemaVersion: CHANNELS_SCHEMA_VERSION,
        })
      ) as unknown as Collection<Channel, string>)
    : (createCollection(sync.getCollectionConfig()) as unknown as Collection<Channel, string>)
  const channelOutboxProcessor = new ChannelOutboxProcessor(outbox, collection)
  await collection.preload()
  if (persistence) {
    sync.seedFromPersistence(Array.from(collection.values()))
  }
  channelOutboxProcessor.start()

  const refresh = async () => {
    const channels = await listChannels()
    await reconcileChannelsCollection(collection, channels)
  }

  try {
    await refresh()
  } catch (error) {
    if (!persistence) {
      throw error
    }
  }

  return {
    collection,
    createChannel: async (name: string) => {
      const trimmedName = name.trim()
      const channelId = slugifyChannelName(trimmedName)
      if (!trimmedName || !channelId) {
        throw new Error("Channel name invalid")
      }

      if (collection.has(channelId)) {
        const existing = Array.from(collection.values()).find((channel) => channel.id === channelId)
        if (existing) {
          return existing
        }
      }

      const channel = {
        id: channelId,
        workspaceId: WORKSPACE_ID,
        name: trimmedName,
        createdAt: new Date().toISOString(),
      } satisfies Channel

      await collection.insert(channel).isPersisted.promise
      await outbox.enqueueCreate(channel)
      channelOutboxProcessor.flushSoon()
      return channel
    },
    refresh,
    dispose: () => {
      channelOutboxProcessor.dispose()
      sync.dispose()
    },
    persisted: Boolean(persistence),
  }
}

export async function initMessagesStore(): Promise<MessagesStore> {
  const persistence = await getBrowserPersistence()
  const syncSurface = new SharedMessagesSyncSurface()
  const outboxCollection = createOutboxCollection(persistence)
  await outboxCollection.preload()
  const outbox = new MessageOutbox(outboxCollection)

  const collectionOptions = {
    ...syncSurface.getCollectionConfig(),
    onInsert: async (params: any) => {
      const mutation = params.transaction.mutations[0]
      await outbox.enqueueCreate(mutation.modified)
      outboxProcessor.flushSoon()
    },
    onUpdate: async (params: any) => {
      const mutation = params.transaction.mutations[0]
      await outbox.enqueueUpdate(mutation.modified)
      outboxProcessor.flushSoon()
    },
    onDelete: async (params: any) => {
      const deletedMessage = params.transaction.mutations[0]?.original
      const channelId = deletedMessage?.channelId
      if (!channelId) {
        console.warn("[do-sync] skipped enqueueing delete because the original message was unavailable")
        return
      }
      await outbox.enqueueDelete(String(params.transaction.mutations[0].key), channelId)
      outboxProcessor.flushSoon()
    },
  }

  const collection = persistence
    ? (createCollection(
        persistedCollectionOptions<Message, string>({
          ...collectionOptions,
          persistence,
          schemaVersion: MESSAGES_SCHEMA_VERSION,
        })
      ) as unknown as Collection<Message, string>)
    : (createCollection(collectionOptions) as unknown as Collection<Message, string>)

  const outboxProcessor = new MessageOutboxProcessor(outbox, syncSurface)
  await collection.preload()
  outboxProcessor.start()

  const channelReadinessListeners = new Set<() => void>()
  const loadedChannelIds = new Set<string>()

  // Mark channels with persisted messages as ready so offline refresh
  // shows messages instead of stuck "Loading channel..." state.
  if (persistence) {
    for (const message of collection.values()) {
      loadedChannelIds.add(message.channelId)
    }
  }
  const channelSyncs = new Map<string, ChannelSync>()
  const channelPrefetches = new Map<string, Promise<void>>()
  let activeChannelId: string | null = null

  const notifyChannelReadiness = () => {
    for (const listener of channelReadinessListeners) {
      listener()
    }
  }

  const markChannelReady = (channelId: string) => {
    if (loadedChannelIds.has(channelId)) return
    loadedChannelIds.add(channelId)
    notifyChannelReadiness()
  }

  const releaseChannelSync = (channelId: string) => {
    if (activeChannelId === channelId) return
    if (channelPrefetches.has(channelId)) return

    const sync = channelSyncs.get(channelId)
    if (!sync) return

    sync.dispose()
    channelSyncs.delete(channelId)
  }

  const getOrCreateChannelSync = (channelId: string) => {
    const existing = channelSyncs.get(channelId)
    if (existing) return existing

    const driver: ChannelSyncDriver = {
      replaceChannelSnapshot: (targetChannelId, messages) => {
        syncSurface.replaceChannelSnapshot(targetChannelId, messages)
      },
      applyServerUpsert: (message) => {
        syncSurface.applyServerUpsert(message)
      },
      applyServerDelete: (messageId) => {
        syncSurface.applyServerDelete(messageId)
      },
      markChannelReady: (targetChannelId) => {
        markChannelReady(targetChannelId)
      },
    }

    const sync = new ChannelSync({
      channelId,
      wsUrl: buildWebSocketUrl(channelId),
      authorId: AUTHOR_ID,
      connectLive: false,
      loadSnapshot: () => loadMessages(channelId),
      mergeSnapshot: (messages) => outbox.applyToChannelMessages(channelId, messages),
      hasPendingMutationForMessage: (messageId) => outbox.hasPendingMessage(messageId),
      isDemoOffline,
      subscribeDemoOffline,
      driver,
    })

    channelSyncs.set(channelId, sync)
    return sync
  }

  const prefetchChannel = (channelId: string) => {
    if (loadedChannelIds.has(channelId)) return
    if (channelPrefetches.has(channelId)) return

    const sync = getOrCreateChannelSync(channelId)
    const prefetch = sync
      .prefetchSnapshot()
      .catch(() => {
        // Keep first-visit navigation resilient when prefetch fails.
      })
      .finally(() => {
        channelPrefetches.delete(channelId)
        releaseChannelSync(channelId)
      })

    channelPrefetches.set(channelId, prefetch)
  }

  return {
    collection,
    activateChannel: (channelId: string) => {
      if (activeChannelId === channelId) {
        getOrCreateChannelSync(channelId).activateLive()
        return
      }

      const previousChannelId = activeChannelId
      if (previousChannelId) {
        channelSyncs.get(previousChannelId)?.deactivateLive()
      }

      activeChannelId = channelId
      getOrCreateChannelSync(channelId).activateLive()
      if (previousChannelId) {
        releaseChannelSync(previousChannelId)
      }
    },
    prefetchChannel,
    sendMessage: async (channelId: string, body: string) => {
      await collection.insert({
        id: crypto.randomUUID(),
        workspaceId: WORKSPACE_ID,
        channelId,
        authorId: AUTHOR_ID,
        body,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      }).isPersisted.promise
      markChannelReady(channelId)
    },
    updateMessage: async (id: string, body: string) => {
      if (!collection.has(id)) return
      await collection.update(id, (draft) => {
        draft.body = body
        draft.updatedAt = new Date().toISOString()
      }).isPersisted.promise
    },
    deleteMessage: async (id: string) => {
      if (!collection.has(id)) return
      await collection.delete(id).isPersisted.promise
    },
    setTyping: (channelId: string, active: boolean) => {
      getOrCreateChannelSync(channelId).setTyping(active)
    },
    subscribeTyping: (channelId: string, listener: () => void) => {
      return getOrCreateChannelSync(channelId).subscribeTyping(listener)
    },
    getTypingUsers: (channelId: string) => {
      return getOrCreateChannelSync(channelId).getTypingUsers()
    },
    subscribeChannelReadiness: (listener: () => void) => {
      channelReadinessListeners.add(listener)
      return () => channelReadinessListeners.delete(listener)
    },
    isChannelReady: (channelId: string) => loadedChannelIds.has(channelId),
    resetLocalCache: async () => {
      await clearBrowserSQLitePersistence()
      window.location.reload()
    },
    dispose: () => {
      outboxProcessor.dispose()
      for (const sync of channelSyncs.values()) {
        sync.dispose()
      }
      channelSyncs.clear()
    },
    isDemoOffline,
    setDemoOffline,
    subscribeDemoOffline,
    persisted: Boolean(persistence),
  }
}

export { AUTHOR_ID, DEFAULT_CHANNEL_ID }
