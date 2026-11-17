# PumpWatch Intelligence V4 — Sprint 1

V4 replaces the V3 snapshot-driven discovery loop with a Solana event-ingestion foundation. The existing mobile PWA and paper-position management remain in place during the engine replacement.

## Data flow

Bitquery GraphQL subscription → canonical trade event → in-memory rolling event buffer → rolling feature snapshots → PostgreSQL raw event archive.

The Bitquery Trading.Trades stream is filtered to Solana. It provides decoded trade-side, trader, transaction, token/pair and USD amount fields. The implementation uses the GraphQL WebSocket endpoint and requires a server-side `BITQUERY_ACCESS_TOKEN`.

## Endpoints

- `GET /api/v4/status`: provider state, counts, persistence status and paper-only safety flags.
- `GET /api/v4/activity`: current top-activity feature snapshots.
- `GET /api/v4/features?mint=<token-mint>`: latest rolling features for a token.

## Safety

- No wallet connection, private-key storage, transaction signing or live execution.
- V4 signal publication is deliberately disabled in Sprint 1.
- Missing Bitquery credentials leave the stream disabled; no synthetic market data is generated.
- Events are deduplicated by transaction signature and index.
- Raw events are persisted only when PostgreSQL is configured. The runtime reports the in-memory/persistence distinction.

## Runtime

Node.js 22+ is required for the built-in WebSocket client. Configure `BITQUERY_ACCESS_TOKEN` as a private environment variable. Do not commit the token to Git.

Sprint 1 is an ingestion and feature foundation, not a validated trading strategy. The ignition and momentum detector modules are provisional scaffolding and are not yet connected to published signals.
