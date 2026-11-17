# PumpWatch MVP architecture

## Architectural decision

PumpWatch is a centralised intelligence service. Discovery, market evaluation, risk checks, signal generation and paper-trade evaluation run on the server independently of browser sessions. The browser is a client of the service; it must not be responsible for generating market intelligence.

## MVP runtime

The current MVP deliberately uses one Render web-service instance for both the API/UI and the background intelligence loops. This keeps the prototype inexpensive and straightforward to operate while ensuring that all connected clients consume the same server-generated market data and signals.

The server currently runs:
- Candidate discovery and refresh scans.
- V4 event ingestion and feature calculation.
- Ignition and momentum signal detection.
- Risk and liquidity checks.
- Paper-trade entry and exit evaluation.
- HTTP APIs used by the UI.

Do not increase the number of web-service instances for this MVP: doing so would start duplicate scanners, stream consumers and paper-trade loops. A later production split should move background work into a dedicated worker with a single-leader/lease mechanism, leaving horizontally scalable API instances to serve clients.

## Shared data and persistence

PostgreSQL is the durable shared store and source of truth for persisted application state and V4 signal history. The `v4_signals` table is keyed by signal ID and stores the complete signal payload, including model, status, timestamps, entry/last/peak prices, risk context and outcome. Signal updates are upserted as the signal evolves.

At startup, the V4 runtime reloads persisted signal payloads from PostgreSQL into its in-memory working cache. The cache is an execution optimisation, not the only copy of signal history. The V4 signals API exposes the runtime's shared signal set to every connected client.

Other existing durable tables include raw events, tokens, market snapshots, score history, leaderboard history, scan runs, risk assessments and paper trades. The application state snapshot also persists scanner configuration and the current MVP paper-trading state.

## Shared versus user-specific data

Global/shared in the MVP:
- Token discovery and candidate evaluations.
- Market observations and model scores.
- V4 signals and their lifecycle/outcomes.
- Risk and liquidity assessments.

The current MVP paper-trading configuration and portfolio are still application-wide. There is not yet a user identity/tenant model or isolated per-user portfolios. Keep the prototype private; do not present the current shared-password access as multi-tenant security.

## Explicit MVP limitations

- One active intelligence engine instance only; no horizontal worker scaling yet.
- API and worker responsibilities still share one Node process.
- User authentication, per-user configuration and portfolio isolation are not implemented.
- PostgreSQL persistence and signal restoration are implemented in code, but should be acceptance-tested against the live Render database before relying on it operationally.
- Live trading is not enabled.

## Production evolution (after MVP validation)

If the MVP proves useful, evolve without changing the shared-data principle:
1. Separate a dedicated background worker from stateless API/web instances.
2. Add a distributed lease/lock so exactly one active scanner and paper engine owns each workload.
3. Add proper user authentication, tenant-scoped settings and isolated paper portfolios.
4. Keep global market intelligence and signals shared; expose user-specific views and paper trades through authenticated APIs.
5. Add Redis/pub-sub or equivalent for fan-out and cache invalidation when concurrent connections justify it.
6. Add migrations, backups, retention policies, observability, rate limits and load testing.

The MVP goal is a single central engine and a single shared database serving all connected clients—not a production-grade multi-tenant deployment yet.
