import { createCollection, localOnlyCollectionOptions } from "@tanstack/react-db"
import type { Collection } from "@tanstack/react-db"
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import type { BrowserWASQLiteDatabase } from "@tanstack/browser-db-sqlite-persistence"
import type { Message } from "../../../shared/protocol"
import { ChannelSync } from "../realtime/channel-sync"

const CHANNEL_ID = "general"
const WORKSPACE_ID = "demo-workspace"
const AUTHOR_ID_STORAGE_KEY = "do-sync.author-id"
const DEMO_OFFLINE_STORAGE_KEY = "do-sync.demo-offline"
const SQLITE_DATABASE_NAME = "do-sync-browser.sqlite"
const MESSAGES_SCHEMA_VERSION = 1
const OUTBOX_SCHEMA_VERSION = 1
const OUTBOX_RETRY_BASE_MS = 1_500

let browserPersistencePromise: Promise<ReturnType<typeof createBrowserWASQLitePersistence<Message, string>> | null> | null = null
let browserDatabaseHandle: BrowserWASQLiteDatabase | null = null
let demoOffline = window.localStorage.getItem(DEMO_OFFLINE_STORAGE_KEY) === "true"
const demoOfflineListeners = new Set<() => void>()

type BrowserPersistence = ReturnType<typeof createBrowserWASQLitePersistence<Message, string>>

type OutboxMutationType = "create" | "update" | "delete"

interface MessageOutboxEntry {
  id: string
  mutationId: string
  type: OutboxMutationType
  messageId: string
  message: Message | null
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

function isDemoOffline() {
  return demoOffline
}

function setDemoOffline(nextValue: boolean) {
  if (demoOffline === nextValue) return
  demoOffline = nextValue
  window.localStorage.setItem(DEMO_OFFLINE_STORAGE_KEY, String(nextValue))
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
  const queryValue = new URLSearchParams(window.location.search).get("user")
  const fromQuery = queryValue ? normalizeAuthorId(queryValue) : ""
  if (fromQuery) {
    window.localStorage.setItem(AUTHOR_ID_STORAGE_KEY, fromQuery)
    return fromQuery
  }

  const storedValue = window.localStorage.getItem(AUTHOR_ID_STORAGE_KEY)
  const fromStorage = storedValue ? normalizeAuthorId(storedValue) : ""
  if (fromStorage) {
    return fromStorage
  }

  const generated = `user-${Math.random().toString(36).slice(2, 8)}`
  window.localStorage.setItem(AUTHOR_ID_STORAGE_KEY, generated)
  return generated
}

const AUTHOR_ID = resolveAuthorId()

function resolveWorkerOrigin() {
  const configuredOrigin = import.meta.env.VITE_WORKER_ORIGIN
  return configuredOrigin
    ? new URL(configuredOrigin, window.location.href)
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
        persistence: persistence as unknown as ReturnType<typeof createBrowserWASQLitePersistence<MessageOutboxEntry, string>>,
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

  hasPendingMessage(messageId: string) {
    return this.getEntries().some((entry) => entry.messageId === messageId)
  }

  applyToMessages(messages: Message[]) {
    return applyOutboxEntries(messages, this.getEntries())
  }

  private findByMessageId(messageId: string) {
    return this.getEntries().find((entry) => entry.messageId === messageId) ?? null
  }

  async enqueueCreate(message: Message) {
    await this.collection.insert({
      id: crypto.randomUUID(),
      mutationId: crypto.randomUUID(),
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
        draft.message = message
        draft.retryAt = null
        draft.lastError = null
      }).isPersisted.promise
      return
    }

    await this.collection.insert({
      id: crypto.randomUUID(),
      mutationId: crypto.randomUUID(),
      type: "update",
      messageId: message.id,
      message,
      createdAt: new Date().toISOString(),
      attemptCount: 0,
      retryAt: null,
      lastError: null,
    }).isPersisted.promise
  }

  async enqueueDelete(messageId: string) {
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

class OutboxProcessor {
  private flushing = false
  private retryTimer: number | null = null
  private heartbeatTimer: number | null = null

  constructor(
    private outbox: MessageOutbox,
    private channelSync: ChannelSync
  ) {}

  start() {
    window.addEventListener("online", this.handleOnline)
    const unsubscribeDemoOffline = subscribeDemoOffline(() => {
      if (isDemoOffline()) {
        return
      }
      this.flushSoon()
    })
    this.heartbeatTimer = window.setInterval(() => {
      this.flushSoon()
    }, 2_000)
    this.flushSoon()
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
    if (this.heartbeatTimer != null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
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
    this.flushSoon()
  }

  private cleanupDemoOffline: (() => void) | null = null

  private async flush() {
    if (this.flushing) return
    if (typeof navigator !== "undefined" && navigator.onLine === false) return
    if (isDemoOffline()) return

    this.flushing = true

    try {
      const entries = this.outbox.getEntries()

      for (const entry of entries) {
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
            this.channelSync.applyServerUpsert(canonical)
          } else if (entry.type === "update" && entry.message) {
            const canonical = await saveMessageUpdate({
              mutationId: entry.mutationId,
              channelId: entry.message.channelId,
              id: entry.message.id,
              body: entry.message.body,
            })

            if (canonical) {
              this.channelSync.applyServerUpsert(canonical)
            }
          } else if (entry.type === "delete") {
            await removeMessage({
              mutationId: entry.mutationId,
              channelId: CHANNEL_ID,
              id: entry.messageId,
            })
            this.channelSync.applyServerDelete(entry.messageId)
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

export interface MessagesDb {
  collection: Collection<Message, string>
  channelSync: ChannelSync
  sendMessage: (body: string) => Promise<void>
  updateMessage: (id: string, body: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
  resetLocalCache: () => Promise<void>
  isDemoOffline: () => boolean
  setDemoOffline: (value: boolean) => void
  subscribeDemoOffline: (listener: () => void) => () => void
  persisted: boolean
}

export async function initMessagesDb(): Promise<MessagesDb> {
  const persistence = await getBrowserPersistence()
  const initialMessages = persistence ? undefined : await loadMessages(CHANNEL_ID)
  const outboxCollection = createOutboxCollection(persistence)
  await outboxCollection.preload()
  const outbox = new MessageOutbox(outboxCollection)

  const channelSync = new ChannelSync({
    channelId: CHANNEL_ID,
    wsUrl: buildWebSocketUrl(CHANNEL_ID),
    authorId: AUTHOR_ID,
    initialMessages,
    loadSnapshot: () => loadMessages(CHANNEL_ID),
    mergeSnapshot: (messages) => outbox.applyToMessages(messages),
    hasPendingMutationForMessage: (messageId) => outbox.hasPendingMessage(messageId),
    isDemoOffline,
    subscribeDemoOffline,
  })
  const outboxProcessor = new OutboxProcessor(outbox, channelSync)

  const collectionOptions = {
    ...channelSync.getCollectionConfig(),
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
      const mutation = params.transaction.mutations[0]
      await outbox.enqueueDelete(String(mutation.key))
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

  outboxProcessor.start()

  async function sendMessage(body: string) {
    await collection.insert({
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      channelId: CHANNEL_ID,
      authorId: AUTHOR_ID,
      body,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    }).isPersisted.promise
  }

  async function updateMessage(id: string, body: string) {
    await collection.update(id, (draft) => {
      draft.body = body
      draft.updatedAt = new Date().toISOString()
    }).isPersisted.promise
  }

  async function deleteMessage(id: string) {
    await collection.delete(id).isPersisted.promise
  }

  return {
    collection,
    channelSync,
    sendMessage,
    updateMessage,
    deleteMessage,
    resetLocalCache: async () => {
      await clearBrowserSQLitePersistence()
      window.location.reload()
    },
    isDemoOffline,
    setDemoOffline,
    subscribeDemoOffline,
    persisted: Boolean(persistence),
  }
}

export { AUTHOR_ID, CHANNEL_ID }
