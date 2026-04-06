const DEFAULT_WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? "http://127.0.0.1:8787"

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} failed: ${response.status}`)
  }
  return response.json()
}

async function listChannels() {
  const data = await fetchJson(`${DEFAULT_WORKER_ORIGIN}/api/channels`)
  return data.channels
}

async function listMessages(channelId) {
  const data = await fetchJson(`${DEFAULT_WORKER_ORIGIN}/api/channels/${channelId}/messages`)
  return data.messages
}

async function deleteMessage(channelId, messageId) {
  const response = await fetch(`${DEFAULT_WORKER_ORIGIN}/api/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mutationId: crypto.randomUUID() }),
  })

  if (response.status === 404) {
    return false
  }

  if (!response.ok) {
    throw new Error(`DELETE ${channelId}/${messageId} failed: ${response.status}`)
  }

  return true
}

async function clearChannel(channel) {
  const messages = await listMessages(channel.id)
  let deleted = 0

  for (const message of messages) {
    const removed = await deleteMessage(channel.id, message.id)
    if (removed) deleted += 1
  }

  return { channelId: channel.id, deleted }
}

async function main() {
  const channels = await listChannels()
  if (channels.length === 0) {
    console.log("No channels found.")
    return
  }

  console.log(`Clearing messages from ${channels.length} channel(s) via ${DEFAULT_WORKER_ORIGIN}`)
  let totalDeleted = 0

  for (const channel of channels) {
    const result = await clearChannel(channel)
    totalDeleted += result.deleted
    console.log(`- ${result.channelId}: deleted ${result.deleted} message(s)`)
  }

  console.log(`Deleted ${totalDeleted} message(s) total.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
