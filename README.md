# PumpWatch Intelligence V4 — Solana signal research (paper only)

PumpWatch V4 is a Solana-first signal intelligence platform. It is designed to detect two distinct opportunity types: early **Ignition** and confirmed **Momentum**. V4 is paper-only: it does not connect wallets, hold private keys, sign transactions or execute live trades.

## Architecture

Bitquery Solana trade stream → canonical event normalisation → deduplication → rolling feature engine → independent Ignition and Momentum models → risk validation → signal lifecycle → forward paper outcomes.

Sprint 1 implements the live event ingestion foundation and rolling features. Signal publication remains disabled until token security/liquidity enrichment, lifecycle handling and outcome measurement are implemented and tested.

## Bitquery setup

Set `BITQUERY_ACCESS_TOKEN` in the hosting environment. The token is server-side only and must never be exposed to the browser or committed to Git. Without it, the stream stays disabled and status endpoints report the missing configuration.

The live feed uses Bitquery's GraphQL WebSocket endpoint and the Solana `Trading.Trades` cube, filtered to Solana. See [Bitquery Solana API](https://docs.bitquery.io/docs/blockchain/Solana/) and [WebSocket subscription examples](https://docs.bitquery.io/docs/subscriptions/examples/).

## V4 endpoints

- `/api/v4/status` — feed, persistence and safety status.
- `/api/v4/activity` — current activity feature snapshots.
- `/api/v4/features?mint=<mint>` — rolling features for one mint.
- `/api/health` — application health.

## Persistence

PostgreSQL stores canonical raw events in `raw_events`, uniquely keyed by transaction signature and trade index. The runtime maintains bounded in-memory rolling windows for feature calculation. A durable event archive enables later replay and model evaluation.

## Development

Node.js 22+.

```bash
npm install
npm test
npm start
```

Configure `DATABASE_URL`, `BITQUERY_ACCESS_TOKEN` and a strong `APP_PASSWORD`. PostgreSQL is required for durable event history. Keep the application private while configuring credentials.

## Delivery status

- [x] V4 branch and event schema
- [x] Bitquery GraphQL WebSocket adapter
- [x] Canonical trade normalisation and deduplication
- [x] Rolling 10s / 1m / 5m / 15m / 1h feature windows
- [x] PostgreSQL raw event persistence
- [x] Paper-only runtime and diagnostics endpoints
- [x] Independent detector scaffolds with fail-closed risk gates
- [ ] Provider integration verified with a live credential
- [ ] Token/pool discovery and security/liquidity enrichment
- [ ] Production-grade reconnect/backfill and durable feature replay
- [ ] Signal lifecycle and forward outcome evaluation

Passing tests do not establish signal profitability.
