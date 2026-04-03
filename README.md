# DO Sync POC

Proof-of-concept realtime sync engine for a Slack-like channel using TanStack DB on the client and Cloudflare Durable Objects + WebSockets as the sync engine.

## Architecture

- `@tanstack/react-db@0.1.79` wraps `@tanstack/db@0.6.1` for the browser collection.
- `@tanstack/browser-db-sqlite-persistence@0.1.5` persists the collection into browser SQLite using OPFS + WA-SQLite.
- `ChannelDO` is the authoritative per-channel sync engine and durable store.
- Durable Object SQLite stores canonical `messages`, channel `seq`, a replayable `event_log`, and non-pruned `mutation_receipts` for idempotent retries.
- The browser connects over WebSocket and handles snapshot, replay, and `must-refetch`.

## Sync Behavior

- `mutationId`: Every client mutation uses TanStack DB's mutation id. The server stores a durable receipt for it, so reconnect retries are safe.
- `tempId`: Optimistic creates use a temporary client id locally. The server returns a canonical message id in `message.created`.
- `seq`: The Durable Object assigns a monotonically increasing sequence number to every canonical event.
- `snapshot`: Used for first load or after `must-refetch`. The client truncates sync state, writes the snapshot, then marks ready on `snapshot-end`.
- `replay`: On reconnect, the client sends persisted `lastSeq`. The server replays missed events if the log still covers that range.
- `must-refetch`: If replay is no longer possible, the client resets `lastSeq` and asks for a fresh snapshot.

## Important Files

- `apps/worker/src/index.ts`: worker entrypoint and WebSocket routing to the channel Durable Object
- `apps/worker/src/channel-do.ts`: authoritative sync engine, canonical store, replay log, and mutation dedupe
- `apps/web/src/db/messages.ts`: TanStack DB collection and browser SQLite persistence wiring
- `apps/web/src/realtime/channel-sync.ts`: WebSocket sync adapter, reconciliation, persisted `lastSeq`, reconnect resend
- `apps/web/src/app.tsx`: minimal UI for create, update, and delete
- `apps/shared/protocol.ts`: shared message and protocol types

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Start the worker:

```bash
cd apps/worker
pnpm dev
```

3. Start the web app in another terminal:

```bash
cd apps/web
pnpm dev
```

4. Open the app at `http://localhost:3000`.

If your worker is not running at `http://127.0.0.1:8787`, set `VITE_WORKER_ORIGIN` for the web app.

## Notes

- Message ordering comes from server-side `created_seq`, not client timestamps.
- Browser persistence survives reloads; the sync adapter also persists `lastSeq` into collection metadata so reloads can replay instead of always starting from scratch.
- This POC intentionally skips auth and stays focused on one entity: `messages`.
# do-sync
