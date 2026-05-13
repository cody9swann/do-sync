# DO-Sync

Realtime channel sync demo built with TanStack DB, browser SQLite, Cloudflare Durable Objects, and WebSockets.

This repo is a focused proof of concept for local-first chat-style data flows:

- Durable Objects own canonical channel and message state.
- DO SQLite stores messages, channels, mutation receipts, and replayable message events.
- The browser uses TanStack DB with OPFS-backed SQLite persistence.
- Optimistic creates, updates, and deletes survive offline periods through a local outbox.
- WebSockets fan out live message, channel, and typing events.
- HTTP snapshot refreshes reconcile local state after startup, reconnect, focus, and visibility changes.

## Architecture

```
apps/
  shared/
    protocol.ts              Shared entity and wire-protocol types
  worker/
    src/index.ts             Worker router for HTTP and WebSocket traffic
    src/channel-do.ts        Per-channel Durable Object sync engine
    src/channel-registry-do.ts
  web/
    src/db/messages.ts       TanStack DB collections, persistence, outbox logic
    src/realtime/            WebSocket sync adapters
    src/app.tsx              Slack-style demo UI
```

## What To Look At

- `apps/worker/src/channel-do.ts`: canonical message writes, seq assignment, mutation dedupe, event log, replay support
- `apps/web/src/db/messages.ts`: browser SQLite persistence, optimistic writes, offline outbox, snapshot merge
- `apps/web/src/realtime/channel-sync.ts`: WebSocket lifecycle, snapshot handling, typing events
- `apps/shared/protocol.ts`: shared protocol contract

## Local Development

Install dependencies:

```bash
pnpm install
```

Start the worker:

```bash
pnpm dev:worker
```

Start the web app in another terminal:

```bash
pnpm dev:web
```

Open `http://localhost:3000`.

If the worker is not running at `http://127.0.0.1:8787`, set `VITE_WORKER_ORIGIN` for the web app.

## Demo Flow

1. Open `http://localhost:3000` in two browser tabs.
2. Send, edit, and delete messages.
3. Toggle the app offline and create messages.
4. Toggle online again; queued changes flush to the Durable Object.
5. Create a channel in one tab; the other tab receives it over WebSocket.

## Checks

```bash
pnpm check
```

This runs TypeScript checks, Vitest, and the web production build.

## Scope

This is intentionally not production-ready. It skips authentication, authorization, rate limiting, and multi-workspace membership so the sync mechanics stay visible.
