import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { eq, useLiveQuery } from "@tanstack/react-db"
import type { Collection } from "@tanstack/react-db"
import "./sidebar.css"
import {
  initChannelsDb,
  initMessagesStore,
  AUTHOR_ID,
  DEFAULT_CHANNEL_ID,
} from "./db/messages"
import type { ChannelsDb, MessagesStore } from "./db/messages"
import type { Channel, Message } from "../../shared/protocol"

// ---------- static sidebar data (demo) ----------

const WORKSPACE_NAME = "Cygnet"

const WORKSPACE_ICONS = [
  { letter: "C", color: "#432916", border: "#F27313" },
  { letter: "G", color: "#202B45", border: "none" },
  { letter: "A", color: "#453F23", border: "none" },
  { letter: "T", color: "#223A26", border: "none" },
]

const AUTHOR_PROFILES: Record<string, { name: string }> = {
  "user-maya": { name: "Maya" },
  "user-theo": { name: "Theo" },
  "user-priya": { name: "Priya" },
  "user-jordan": { name: "Jordan" },
  "user-alex": { name: "Alex" },
  "user-sam": { name: "Sam" },
}

const DM_USERS = [
  { name: "Cody" },
  { name: "Gabby" },
  ...Object.values(AUTHOR_PROFILES),
]

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true

  const tagName = target.tagName
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT"
}

// ---------- color helpers ----------

function avatarColor(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  const colors = ["#5865f2", "#3ba55d", "#ed4245", "#fee75c", "#f47b67", "#e8a1d0", "#59c2e6"]
  return colors[Math.abs(hash) % colors.length]
}

function initials(id: string) {
  return id.replace(/^user-/, "").slice(0, 2).toUpperCase()
}

function isDmRowCurrentUser(displayName: string) {
  const slug = AUTHOR_ID.replace(/^user-/i, "").toLowerCase()
  return displayName.trim().toLowerCase() === slug
}

function authorProfile(authorId: string) {
  const fromMap = AUTHOR_PROFILES[authorId]
  if (fromMap) return fromMap
  const idLower = authorId.toLowerCase()
  if (idLower === "user-cody") {
    return { name: "Cody" }
  }
  if (idLower === "user-gabby") {
    return { name: "Gabby" }
  }
  return null
}

// ---------- root ----------

export default function ChannelApp({
  activeChannelId,
  onNavigateChannel,
}: {
  activeChannelId: string
  onNavigateChannel: (channelId: string) => void
}) {
  const [channelsDb, setChannelsDb] = useState<ChannelsDb | null>(null)
  const [messagesStore, setMessagesStore] = useState<MessagesStore | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void initChannelsDb()
      .then((nextChannelsDb) => {
        if (cancelled) {
          nextChannelsDb.dispose()
          return
        }
        setChannelsDb(nextChannelsDb)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e))
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void initMessagesStore()
      .then((nextStore) => {
        if (cancelled) {
          nextStore.dispose()
          return
        }
        setMessagesStore(nextStore)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      messagesStore?.dispose()
    }
  }, [messagesStore])

  useEffect(() => {
    return () => {
      channelsDb?.dispose()
    }
  }, [channelsDb])

  useEffect(() => {
    messagesStore?.activateChannel(activeChannelId)
  }, [activeChannelId, messagesStore])

  if (error) {
    return (
      <div style={styles.loadingFull}>
        <div>
          <p>Failed to initialize database:</p>
          <pre style={{ fontSize: 12, marginTop: 8 }}>{error}</pre>
        </div>
      </div>
    )
  }

  if (!messagesStore || !channelsDb) {
    return <div style={styles.loadingFull}></div>
  }

  return (
    <ChannelAppBody
      channelsDb={channelsDb}
      messagesStore={messagesStore}
      activeChannelId={activeChannelId}
      onNavigateChannel={onNavigateChannel}
    />
  )
}

function ChannelAppBody({
  channelsDb,
  messagesStore,
  activeChannelId,
  onNavigateChannel,
}: {
  channelsDb: ChannelsDb
  messagesStore: MessagesStore
  activeChannelId: string
  onNavigateChannel: (channelId: string) => void
}) {
  const { data: channelRows = [] } = useLiveQuery(
    (q) =>
      q
        .from({ channels: channelsDb.collection })
        .orderBy(({ channels }) => channels.createdAt, "asc")
        .orderBy(({ channels }) => channels.id, "asc"),
    [channelsDb.collection]
  )
  const channels = channelRows ?? []

  useEffect(() => {
    if (channels.length === 0) return

    const exists = channels.some((channel) => channel.id === activeChannelId)
    const nextActiveChannelId = exists
      ? activeChannelId
      : channels[0]?.id ?? DEFAULT_CHANNEL_ID

    if (nextActiveChannelId !== activeChannelId) {
      onNavigateChannel(nextActiveChannelId)
    }
  }, [activeChannelId, channels, onNavigateChannel])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      if (channels.length === 0) return

      const currentIndex = channels.findIndex((channel) => channel.id === activeChannelId)
      const fallbackIndex = currentIndex === -1 ? 0 : currentIndex

      if (event.key === "j") {
        const nextIndex = Math.min(channels.length - 1, fallbackIndex + 1)
        const nextChannel = channels[nextIndex]
        if (nextChannel && nextChannel.id !== activeChannelId) {
          event.preventDefault()
          onNavigateChannel(nextChannel.id)
        }
        return
      }

      if (event.key === "k") {
        const previousIndex = Math.max(0, fallbackIndex - 1)
        const previousChannel = channels[previousIndex]
        if (previousChannel && previousChannel.id !== activeChannelId) {
          event.preventDefault()
          onNavigateChannel(previousChannel.id)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [activeChannelId, channels, onNavigateChannel])

  const handleCreateChannel = async () => {
    const name = window.prompt("New channel name")
    if (!name?.trim()) return

    const channel = await channelsDb.createChannel(name)
    onNavigateChannel(channel.id)
  }

  return (
    <div style={styles.shell}>
      <WorkspaceStrip />
      <Sidebar
        channels={channels}
        activeChannel={activeChannelId}
        onSelectChannel={onNavigateChannel}
        onPrefetchChannel={messagesStore.prefetchChannel}
        onCreateChannel={() => void handleCreateChannel()}
      />
      <MainPanel messagesStore={messagesStore} activeChannelId={activeChannelId} />
    </div>
  )
}

// ---------- workspace icon strip ----------

function WorkspaceStrip() {
  return (
    <div style={styles.strip}>
      <div style={styles.stripLogo}>
        {/* <span style={{ fontSize: 18 }}>🏔️</span> */}
        {/* <svg width="39" height="38" viewBox="0 0 39 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M27.8596 18.1563C27.7917 18.1563 27.7324 18.207 27.707 18.2744L27.3 19.6834C27.122 20.2908 27.1898 20.8476 27.4865 21.261C27.7578 21.6407 28.2156 21.86 28.7667 21.8853L30.988 22.0203C31.0559 22.0203 31.1152 22.0541 31.1491 22.1047C31.183 22.1553 31.1915 22.2312 31.1746 22.2903C31.1407 22.3915 31.0389 22.4675 30.9287 22.4759L28.6141 22.6109C27.3593 22.6699 26.0113 23.6739 25.5365 24.9056L25.367 25.3359C25.333 25.4203 25.3924 25.5046 25.4856 25.5046H33.4383C33.5315 25.5046 33.6163 25.4456 33.6417 25.3528C33.7774 24.8635 33.8537 24.3488 33.8537 23.8173C33.8537 20.6958 31.2933 18.1479 28.1478 18.1479C28.0546 18.1479 27.9528 18.1479 27.8596 18.1563Z" fill="#FBAD41" />
          <path d="M24.8243 24.8044C25.0024 24.197 24.9346 23.6402 24.6378 23.2268C24.3665 22.8471 23.9087 22.6278 23.3576 22.6024L12.9209 22.4675C12.853 22.4675 12.7937 22.4337 12.7598 22.3831C12.7259 22.3325 12.7174 22.265 12.7343 22.1975C12.7683 22.0962 12.87 22.0203 12.9802 22.0119L23.5102 21.8769C24.7565 21.8178 26.113 20.8139 26.5878 19.5821L27.1898 18.0214C27.2152 17.9539 27.2237 17.8864 27.2067 17.8189C26.5285 14.7648 23.79 12.4869 20.5174 12.4869C17.4991 12.4869 14.9387 14.4273 14.023 17.1186C13.4296 16.6799 12.675 16.4437 11.8611 16.5196C10.4113 16.6631 9.24978 17.8189 9.10565 19.2615C9.07174 19.6328 9.09717 19.9955 9.18196 20.333C6.81652 20.4005 4.92587 22.324 4.92587 24.6947C4.92587 24.9057 4.94283 25.1166 4.96826 25.3275C4.98522 25.4287 5.07 25.5046 5.17174 25.5046H24.4343C24.5446 25.5046 24.6463 25.4287 24.6802 25.319L24.8243 24.8044Z" fill="#F6821F" />
        </svg> */}
        <svg width="39" height="38" viewBox="0 0 39 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g clip-path="url(#clip0_3897_177)">
            <path d="M6 33L30.5 8.5L6 29.5M9.5 29.5C13 -2 55 5 16.5 26H20" fill="#F6821F" />
            <path d="M6 33V29.5L10 26L9.5 29.5L6 33Z" fill="#FBAD41" />
            <line x1="6" y1="32.5" x2="33" y2="32.5" stroke="#3C2514" />
          </g>
          <defs>
            <clipPath id="clip0_3897_177">
              <rect width="28" height="28" fill="white" transform="translate(6 5)" />
            </clipPath>
          </defs>
        </svg>


      </div>
      {WORKSPACE_ICONS.map((w, i) => (
        <div
          key={i}
          style={{
            ...styles.stripIcon,
            backgroundColor: w.color,
            border: `1px solid ${w.border}`,
          }}
        >
          {w.letter}
        </div>
      ))}
      <div style={{ ...styles.stripIcon, backgroundColor: "#171717", border: "none" }}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4.16667 10H15.8333M10 4.16667V15.8333" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>

      </div>
      {/* user avatar pinned to bottom */}
      <div style={styles.sidebarFooter}>
        <div style={styles.userAvatar}>{initials(AUTHOR_ID)}</div>
      </div>
    </div>
  )
}

// ---------- sidebar ----------

function Sidebar({
  channels,
  activeChannel,
  onSelectChannel,
  onPrefetchChannel,
  onCreateChannel,
}: {
  channels: Channel[]
  activeChannel: string
  onSelectChannel: (channelId: string) => void
  onPrefetchChannel: (channelId: string) => void
  onCreateChannel: () => void
}) {
  return (
    <div style={styles.sidebar}>
      <div style={styles.sidebarHeader}>
        <span style={styles.workspaceName}>{WORKSPACE_NAME}</span>
        <span style={{ color: "#999", fontSize: 12 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6L8 10L12 6" stroke="#5C5C5C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </div>

      <div style={styles.sectionLabel}>Channels</div>
      {channels.map((channel) => (
        <div
          key={channel.id}
          className={
            "sidebar-nav-item sidebar-nav-item--channel" +
            (channel.id === activeChannel ? " sidebar-nav-item--active" : "")
          }
          style={styles.channelItem}
          onMouseEnter={() => onPrefetchChannel(channel.id)}
          onFocus={() => onPrefetchChannel(channel.id)}
          onPointerDown={() => onPrefetchChannel(channel.id)}
          onClick={() => onSelectChannel(channel.id)}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.6667 7.33334H3.33333C2.59695 7.33334 2 7.93029 2 8.66667V13.3333C2 14.0697 2.59695 14.6667 3.33333 14.6667H12.6667C13.403 14.6667 14 14.0697 14 13.3333V8.66667C14 7.93029 13.403 7.33334 12.6667 7.33334Z" stroke="#5C5C5C" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M4.66666 7.33334V4.66667C4.66666 3.78261 5.01785 2.93477 5.64297 2.30965C6.2681 1.68453 7.11594 1.33334 8 1.33334C8.88405 1.33334 9.7319 1.68453 10.357 2.30965C10.9821 2.93477 11.3333 3.78261 11.3333 4.66667V7.33334" stroke="#5C5C5C" stroke-linecap="round" stroke-linejoin="round" />
          </svg>

          {channel.name}
        </div>
      ))}
      <div
        className="sidebar-nav-item sidebar-nav-item--channel"
        style={styles.channelItem}
        onClick={onCreateChannel}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3.33334 8H12.6667M8 3.33333V12.6667" stroke="#5C5C5C" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        Add channel
      </div>

      <div style={{ ...styles.sectionLabel, marginTop: 20 }}>Direct Messages</div>
      {DM_USERS.map((u) => (
        <div key={u.name} className="sidebar-nav-item sidebar-nav-item--muted" style={styles.dmItem}>
          <span style={{ ...styles.dmAvatar, backgroundColor: avatarColor(`user-${u.name}`) }}>
            {initials(`user-${u.name}`)}
          </span>
          <span style={styles.dmNameRow}>
            {u.name}
            {isDmRowCurrentUser(u.name) ? <span style={styles.dmYouLabel}>You</span> : null}
          </span>
        </div>
      ))}

    </div>
  )
}

// ---------- main panel ----------

function MainPanel({
  messagesStore,
  activeChannelId,
}: {
  messagesStore: MessagesStore
  activeChannelId: string
}) {
  const typingUsers = useTypingUsers(messagesStore, activeChannelId)
  const channelReady = useSyncExternalStore(
    messagesStore.subscribeChannelReadiness,
    () => messagesStore.isChannelReady(activeChannelId),
    () => false
  )
  const demoOffline = useSyncExternalStore(
    messagesStore.subscribeDemoOffline,
    messagesStore.isDemoOffline,
    () => false
  )

  return (
    <div style={styles.main}>
      <div style={styles.mainHeader}>
        <span style={styles.mainHeaderTitle}>{activeChannelId}</span>
        <div style={styles.headerActions}>
          <button
            style={{
              ...styles.headerActionBtn,
              ...(demoOffline ? styles.headerActionBtnActive : null),
            }}
            onClick={() => {
              messagesStore.setDemoOffline(!demoOffline)
            }}
          >
            {demoOffline ? "Offline" : "Online"}
          </button>
          {/* <button
            style={styles.headerActionBtn}
            onClick={() => {
              void messagesStore.resetLocalCache()
            }}
          >
            Clear local cache
          </button> */}
        </div>
      </div>
      <MessageList
        collection={messagesStore.collection}
        channelId={activeChannelId}
        channelReady={channelReady}
        updateMessage={messagesStore.updateMessage}
        deleteMessage={messagesStore.deleteMessage}
      />
      <TypingIndicator typingUsers={typingUsers} />
      <MessageInput
        key={activeChannelId}
        channelId={activeChannelId}
        onSend={messagesStore.sendMessage}
        setTyping={(active) => messagesStore.setTyping(activeChannelId, active)}
      />
    </div>
  )
}

// ---------- message list ----------

function MessageList({
  collection,
  channelId,
  channelReady,
  updateMessage,
  deleteMessage,
}: {
  collection: Collection<Message, string>
  channelId: string
  channelReady: boolean
  updateMessage: (id: string, body: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>
}) {
  const { data: messages = [] } = useLiveQuery(
    (q) =>
      q
        .from({ messages: collection })
        .where(({ messages }) => eq(messages.channelId, channelId))
        .orderBy(({ messages }) => messages.createdAt, "asc")
        .orderBy(({ messages }) => messages.id, "asc"),
    [collection, channelId]
  )
  const bottomRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" })
  }, [channelId, messages?.length])

  return (
    <div style={styles.messageList}>
      {!channelReady && messages.length === 0 && (
        <div style={styles.emptyState}>Loading channel...</div>
      )}
      {channelReady && messages.length === 0 && (
        <div style={styles.emptyState}>No messages yet. Say something!</div>
      )}
      {/* spacer pushes messages to bottom when few */}
      <div style={{ flex: 1 }} />
      {messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          onUpdate={updateMessage}
          onDelete={deleteMessage}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

// ---------- message row ----------

function MessageRow({
  message,
  onUpdate,
  onDelete,
}: {
  message: Message
  onUpdate: (id: string, body: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(message.body)
  const [isSaving, setIsSaving] = useState(false)
  const isOwn = message.authorId === AUTHOR_ID

  const handleSaveEdit = async () => {
    const trimmed = editBody.trim()
    if (!trimmed || trimmed === message.body) {
      setEditing(false)
      return
    }
    setIsSaving(true)
    try {
      await onUpdate(message.id, trimmed)
      setEditing(false)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsSaving(true)
    try {
      await onDelete(message.id)
    } finally {
      setIsSaving(false)
    }
  }

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })

  const profile = authorProfile(message.authorId)
  const displayName = profile?.name ?? message.authorId.replace(/^user-/, "")

  return (
    <div style={styles.messageRow}>
      <div
        style={{
          ...styles.msgAvatar,
          backgroundColor: avatarColor(message.authorId),
        }}
      >
        {initials(message.authorId)}
      </div>
      <div style={styles.msgContent}>
        <div style={styles.msgMeta}>
          <span style={styles.msgAuthor}>{displayName}</span>
          <span style={styles.msgTime}>
            {time}
            {message.updatedAt ? " (edited)" : ""}
          </span>
          {isOwn && !editing && (
            <span style={styles.msgActions}>
              <button
                style={styles.actionBtn}
                onClick={() => {
                  setEditing(true)
                  setEditBody(message.body)
                }}
              >
                edit
              </button>
              <button
                style={styles.actionBtn}
                onClick={() => void handleDelete()}
                disabled={isSaving}
              >
                delete
              </button>
            </span>
          )}
        </div>
        {editing ? (
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              style={styles.editInput}
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveEdit()
                if (e.key === "Escape") setEditing(false)
              }}
              autoFocus
            />
            <button style={styles.saveBtn} onClick={() => void handleSaveEdit()} disabled={isSaving}>
              save
            </button>
            <button style={styles.cancelBtn} onClick={() => setEditing(false)} disabled={isSaving}>
              cancel
            </button>
          </div>
        ) : (
          <div style={styles.msgBody}>{message.body}</div>
        )}
      </div>
    </div>
  )
}

// ---------- message input ----------

function MessageInput({
  channelId,
  onSend,
  setTyping,
}: {
  channelId: string
  onSend: (channelId: string, body: string) => Promise<void>
  setTyping: (active: boolean) => void
}) {
  const [body, setBody] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = async () => {
    const trimmed = body.trim()
    if (!trimmed) return

    setBody("")
    inputRef.current?.focus()
    setTyping(false)

    try {
      await onSend(channelId, trimmed)
    } catch (error) {
      setBody((current) => (current.trim() ? current : trimmed))
      throw error
    }
  }

  return (
    <div style={styles.inputWrapper}>
      <div style={styles.inputBox}>
        <textarea
          ref={inputRef}
          style={styles.textarea}
          placeholder="Send a message..."
          rows={1}
          value={body}
          onChange={(e) => {
            const nextValue = e.target.value
            setBody(nextValue)
            setTyping(nextValue.trim().length > 0)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void handleSend()
            }
          }}
          onBlur={() => setTyping(false)}
        />
        <div style={styles.inputToolbar}>
          <button style={styles.plusBtn}>+</button>
          <button
            style={{
              ...styles.sendArrow,
              opacity: body.trim() ? 1 : 0.35,
            }}
            onClick={() => void handleSend()}
            disabled={!body.trim()}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g clipPath="url(#sendBtnClip)">
                <path
                  d="M9.09468 10.9044C8.93542 10.7454 8.74561 10.6203 8.53671 10.5367L1.92837 7.88669C1.84947 7.85503 1.78214 7.79999 1.73542 7.72897C1.6887 7.65794 1.66483 7.57431 1.66701 7.48933C1.66918 7.40434 1.69731 7.32205 1.7476 7.2535C1.7979 7.18496 1.86795 7.13344 1.94837 7.10586L17.7817 1.68919C17.8555 1.66252 17.9355 1.65743 18.0121 1.67452C18.0887 1.69161 18.1589 1.73016 18.2144 1.78567C18.2699 1.84119 18.3085 1.91136 18.3255 1.98799C18.3426 2.06461 18.3375 2.14452 18.3109 2.21836L12.8942 18.0517C12.8666 18.1321 12.8151 18.2022 12.7466 18.2525C12.678 18.3028 12.5957 18.3309 12.5107 18.3331C12.4258 18.3352 12.3421 18.3114 12.2711 18.2646C12.2001 18.2179 12.145 18.1506 12.1134 18.0717L9.46337 11.4617C9.37936 11.2529 9.25394 11.0634 9.09468 10.9044ZM9.09468 10.9044L18.2117 1.78919"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
              <defs>
                <clipPath id="sendBtnClip">
                  <rect width="20" height="20" fill="white" />
                </clipPath>
              </defs>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function useTypingUsers(messagesStore: MessagesStore, channelId: string): string[] {
  return useSyncExternalStore(
    (callback) => messagesStore.subscribeTyping(channelId, callback),
    () => messagesStore.getTypingUsers(channelId),
    () => []
  )
}

function TypingIndicator({ typingUsers }: { typingUsers: string[] }) {
  const names = typingUsers.map((id) => id.replace(/^user-/, ""))
  const label =
    names.length === 0
      ? ""
      : names.length === 1
        ? `${names[0]} is typing...`
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are typing...`

  return (
    <div
      style={{
        ...styles.typingIndicator,
        opacity: typingUsers.length > 0 ? 1 : 0,
      }}
      aria-hidden={typingUsers.length === 0}
    >
      {label}
    </div>
  )
}

// ============================================================================
// styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  // -- layout shell --
  shell: {
    display: "flex",
    height: "100vh",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    backgroundColor: "#000",
    color: "#dbdee1",
    WebkitFontSmoothing: "antialiased",
  },

  loadingFull: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
    color: "#949ba4",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },

  // -- workspace strip (far left icons) --
  strip: {
    width: 56,
    backgroundColor: "#000",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 8,
    gap: 12,
    borderRight: "1px solid #222",
    flexShrink: 0,
  },
  stripLogo: {
    width: 40,
    height: 40,
    borderRadius: 6,
    // backgroundColor: "#222",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    // marginBottom: 8,
  },
  stripIcon: {
    width: 32,
    height: 32,
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 400,
    color: "#fff",
    cursor: "pointer",
  },

  // -- sidebar --
  sidebar: {
    width: 262,
    backgroundColor: "#000",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    position: "relative" as const,
    borderRight: "1px solid #222",
  },
  sidebarHeader: {
    padding: "14px 16px",
    display: "flex",
    alignItems: "center",
    height: "54px",
    gap: 6,
    fontSize: 16,
    fontWeight: 700,
    borderBottom: "1px solid #222",
  },
  workspaceName: {
    color: "#e0e0e0",
  },
  sectionLabel: {
    padding: "24px 16px 14px 24px",
    fontSize: 13,
    fontWeight: 400,
    color: "#A1A1A1",
    letterSpacing: 0,
  },
  channelItem: {
    padding: "8px 12px",
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderRadius: 4,
    margin: "0 12px",
  },
  channelIcon: {
    fontSize: 14,
    opacity: 0.6,
  },
  dmItem: {
    padding: "8px 12px",
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: "0 12px",
    borderRadius: 4,
  },
  dmAvatar: {
    width: 20,
    height: 20,
    borderRadius: 4,
    alignItems: "center",
    color: "#FFFFFF",
    display: "inline-flex",
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 700,
    justifyContent: "center",
  },
  dmNameRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
  },
  dmYouLabel: {
    fontSize: 12,
    fontWeight: 500,
    opacity: 0.5,
    color: "#949ba4",
  },
  sidebarFooter: {
    marginTop: "auto",
    padding: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: "6px",
    backgroundColor: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "#000",
  },

  // -- main panel --
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    backgroundColor: "#000",
  },
  mainHeader: {
    height: "54px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 20px",
    borderBottom: "1px solid #222",
    fontSize: 16,
    fontWeight: 700,
  },
  mainHeaderTitle: {
    color: "#e0e0e0",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  headerActionBtn: {
    backgroundColor: "transparent",
    border: "1px solid #2f2f2f",
    borderRadius: 6,
    color: "#949ba4",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 500,
    padding: "6px 10px",
  },
  headerActionBtnActive: {
    border: "1px solid #8b3a3a",
    color: "#ffb0b0",
    backgroundColor: "#2a1111",
  },
  // -- messages --
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 20px",
    display: "flex",
    flexDirection: "column",
  },
  emptyState: {
    color: "#949ba4",
    fontSize: 14,
    textAlign: "center" as const,
    padding: 40,
  },
  messageRow: {
    display: "flex",
    gap: 12,
    padding: "8px 0",
  },
  msgAvatar: {
    width: 36,
    height: 36,
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 13,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
    marginTop: 2,
    overflow: "hidden" as const,
  },
  msgContent: {
    flex: 1,
    minWidth: 0,
  },
  msgMeta: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 14,
  },
  msgAuthor: {
    fontWeight: 700,
    color: "#e0e0e0",
  },
  msgTime: {
    fontSize: 11,
    color: "#949ba4",
  },
  msgActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 4,
  },
  actionBtn: {
    background: "none",
    border: "none",
    color: "#949ba4",
    cursor: "pointer",
    fontSize: 11,
    padding: "0 2px",
  },
  msgBody: {
    fontSize: 14,
    lineHeight: 1.5,
    marginTop: 2,
    color: "#dbdee1",
  },
  editInput: {
    flex: 1,
    padding: "4px 8px",
    backgroundColor: "#222",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#dbdee1",
    fontSize: 14,
    outline: "none",
  },
  saveBtn: {
    padding: "4px 10px",
    backgroundColor: "#5865f2",
    border: "none",
    borderRadius: 4,
    color: "#fff",
    cursor: "pointer",
    fontSize: 12,
  },
  cancelBtn: {
    padding: "4px 10px",
    backgroundColor: "#333",
    border: "none",
    borderRadius: 4,
    color: "#dbdee1",
    cursor: "pointer",
    fontSize: 12,
  },

  // -- input bar --
  inputWrapper: {
    padding: "0 20px 20px",
  },
  typingIndicator: {
    height: 26,
    padding: "4px 20px 8px",
    boxSizing: "border-box",
    fontSize: 12,
    color: "#949ba4",
    transition: "opacity 120ms ease",
    pointerEvents: "none",
  },
  inputBox: {
    backgroundColor: "#171717",
    borderRadius: 8,
    border: "1px solid #262626",
    display: "flex",
    flexDirection: "column",
  },
  textarea: {
    width: "100%",
    padding: "12px 16px",
    backgroundColor: "transparent",
    border: "none",
    color: "#dbdee1",
    fontSize: 14,
    fontFamily: "inherit",
    resize: "none" as const,
    outline: "none",
    lineHeight: 1.5,
  },
  inputToolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "4px 8px 8px",
  },
  plusBtn: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    backgroundColor: "transparent",
    border: "none",
    color: "#dbdee1",
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    lineHeight: 1,
  },
  sendArrow: {
    boxSizing: "border-box" as const,
    width: 32,
    height: 32,
    minWidth: 32,
    minHeight: 32,
    padding: 0,
    borderRadius: 6,
    backgroundColor: "#fff",
    border: "none",
    color: "#111",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
}
