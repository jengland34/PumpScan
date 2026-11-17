# PumpWatch Intelligence V4 — Shrine free-feed proof of concept

## Provider and free-tier constraints

V4 Sprint 1A uses Shrine Trade's keyless Solana Data API. No API key, account or token renewal is required for launch, migration and per-token trade feeds.

Documented free limits: 2 open sockets per stream type; up to 50 concurrent subscriptions per Socket.IO connection; free new-token and per-token trade streams. Live OHLCV requires a free key and is not used. The whole-market Advanced Data Stream and 24-hour replay are paid features and are not used.

## Data flow

Shrine Socket.IO launch/migration feeds → bounded mint subscriptions → per-token trade events → canonical event → rolling buffer → features → PostgreSQL raw-event archive.

The free plan does not provide the whole-market Advanced Data Stream. This implementation discovers new tokens and subscribes to their individual trade streams, up to 50 active mints per connection. The cap is exposed in /api/v4/status.

## Environment

Optional: SHRINE_API_KEY. Leave unset for keyless free feeds. Do not configure an invalid key.

## Endpoints

- GET /api/v4/status: provider, connection, subscription count, event count and paper-only flags.
- GET /api/v4/activity: rolling feature snapshots.
- GET /api/v4/features?mint=<token-mint>: latest features.

## Reliability and data quality

Socket.IO reconnects automatically. Active subscriptions are recreated as new launch events arrive; existing active mints are not yet replayed from persistent storage after process restart. The normaliser refuses trades without mint, signature, side and defensible USD value. SOL quote conversion uses the live SOL/USD feed. Shrine emits events before final confirmation and notes rare dropped-block duplicates; final-chain reconciliation is not yet implemented.

## Safety

Paper evaluation only. No wallet connection, private-key storage, signing, live execution or signal publication. Security/liquidity gates and detector wiring remain Sprint 2 work.
