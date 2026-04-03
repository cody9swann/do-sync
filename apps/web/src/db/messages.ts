import { createCollection } from "@tanstack/react-db"
import type { Collection } from "@tanstack/react-db"
import type { Message } from "../../../shared/protocol"
import { ChannelSync } from "../realtime/channel-sync"

const CHANNEL_ID = "general"
const WORKSPACE_ID = "demo-workspace"
const AUTHOR_ID = `user-${Math.random().toString(36).slice(2, 8)}`

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
  const response = await fetch(buildMessagesUrl(channelId))

  if (!response.ok) {
    throw new Error(`Failed to load messages: ${response.status}`)
  }

  const data = (await response.json()) as { messages: Message[] }
  return data.messages
}

async function createMessage(input: {
  id: string
  workspaceId: string
  channelId: string
  authorId: string
  body: string
}): Promise<void> {
  const response = await fetch(buildMessagesUrl(input.channelId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })

  if (!response.ok) {
    throw new Error(`Failed to create message: ${response.status}`)
  }
}

async function saveMessageUpdate(input: {
  channelId: string
  id: string
  body: string
}): Promise<void> {
  const response = await fetch(buildMessageUrl(input.channelId, input.id), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: input.body }),
  })

  if (!response.ok) {
    throw new Error(`Failed to update message: ${response.status}`)
  }
}

async function removeMessage(input: {
  channelId: string
  id: string
}): Promise<void> {
  const response = await fetch(buildMessageUrl(input.channelId, input.id), {
    method: "DELETE",
  })

  if (!response.ok) {
    throw new Error(`Failed to delete message: ${response.status}`)
  }
}

export interface MessagesDb {
  collection: Collection<Message, string>
  channelSync: ChannelSync
  sendMessage: (body: string) => Promise<void>
  updateMessage: (id: string, body: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
  persisted: boolean
}

export async function initMessagesDb(): Promise<MessagesDb> {
  const initialMessages = await loadMessages(CHANNEL_ID)

  const channelSync = new ChannelSync({
    channelId: CHANNEL_ID,
    wsUrl: buildWebSocketUrl(CHANNEL_ID),
    authorId: AUTHOR_ID,
    initialMessages,
  })

  const collection = createCollection<Message, string>({
    ...channelSync.getCollectionConfig(),
    onInsert: async ({ transaction }) => {
      const mutation = transaction.mutations[0]
      await createMessage({
        id: String(mutation.key),
        workspaceId: mutation.modified.workspaceId,
        channelId: mutation.modified.channelId,
        authorId: mutation.modified.authorId,
        body: mutation.modified.body,
      })
    },
    onUpdate: async ({ transaction }) => {
      const mutation = transaction.mutations[0]
      await saveMessageUpdate({
        channelId: mutation.modified.channelId,
        id: String(mutation.key),
        body: mutation.modified.body,
      })
    },
    onDelete: async ({ transaction }) => {
      const mutation = transaction.mutations[0]
      await removeMessage({
        channelId: CHANNEL_ID,
        id: String(mutation.key),
      })
    },
  }) as Collection<Message, string>

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
    persisted: false,
  }
}

export { AUTHOR_ID, CHANNEL_ID }
