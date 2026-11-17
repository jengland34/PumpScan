# PumpWatch V3 — Early Entry Engine (paper trading only)

PumpWatch V3 is a phone-first Solana token discovery and **paper-trading** application. It preserves the V2 PWA, watchlist, JSON persistence, DexScreener discovery, RugCheck summaries and simulated position management, while adding two separate candidate-scoring models, persisted rolling market observations and progressive profit protection.

## Safety boundary

This application cannot execute real cryptocurrency trades. There is no wallet integration, private-key handling, Jupiter execution or live-trading mode. `autoPaper` creates simulated positions only. Do not add wallet seed phrases or private keys to this project.

## V3 changes

### Model A — New launches

Pairs up to the configured `newLaunchMaxAgeHours` (default 24h) receive a score weighted toward buy-side pressure, buyer-transaction acceleration and early volume expansion. The pair age is based on the selected DexScreener pair, not necessarily the token's first-ever pool.

### Model B — Established pairs

Older pairs (up to the configured maximum pair age) receive a score weighted more toward volume acceleration, controlled 5-minute price action and buyer activity.

### Shared hard safety gates

- Positive, available price data.
- Minimum liquidity (default $10,000).
- Pair age within configured maximum (default 72h).
- RugCheck report available with normalized score below configured maximum (default 35).
- No RugCheck `danger` or `critical` risk level.
- Minimum 5-minute activity floor (default $1,500 volume).
- At least two prior observations before a candidate can pass for entry.

Unknown/unavailable security data is a fail, never a pass. Momentum cannot compensate for a failed safety gate. Scores are heuristics, not probabilities or evidence of profitability.

### Rolling observation history

Each discovery scan stores up to 12 observations per candidate in `data/state.json`. Current DexScreener 5-minute rolling volume and transaction counts are compared with earlier snapshots to estimate acceleration. These are overlapping rolling-window snapshots, not independent 1-minute candles or a full historical tick feed. History is warmed up over multiple scans; candidates are not eligible for entry until at least two prior observations exist.

### Position management

- Emergency hard stop remains 25% below entry by default.
- Profit protection activates once the observed peak reaches 1.4x entry, using the configured trailing percentage (20% default).
- At 2x, the system sells 50% of the original position fraction.
- The remaining runner uses a 20% trail by default, widening to 22% after 3x and 25% after 5x to allow larger moves some room.
- Maximum three open positions, £30 maximum stake per position and £30 daily realized-loss pause remain defaults.

These are initial research parameters, not optimized settings. The wider runner tiers deliberately allow more giveback at higher multiples and must be evaluated in forward paper trading.

## Important limitations

- DexScreener's latest token-profile and latest-boost feeds are curated/enhanced/paid-promotion feeds, not a complete feed of every new Solana mint. A boost is not a quality signal.
- No holder-count, wallet concentration, top-holder distribution or sellability simulation is currently included.
- RugCheck summaries are not guarantees that a token is safe or sellable.
- The scanner enriches candidates sequentially to reduce API rate-limit pressure; discovery may take time.
- No historical OHLCV backtester is included yet. V3 collects rolling observations for forward evaluation; do not describe its score as historically validated.
- Public API availability, freshness and rate limits can change.

## Run locally

Requires Node.js 20+.

```bash
cp .env.example .env
# Set APP_PASSWORD to a long unique password before exposing the app beyond localhost.
npm test
npm start
```

Open `http://localhost:3000`. For phone access on the same Wi-Fi, use the computer's LAN IP and port 3000. Do not expose an unauthenticated instance to the public internet.

## Deploy to Render

1. Push this folder to a private GitHub repository.
2. Create a Render Blueprint deployment from the repository; Render reads `render.yaml`.
3. Use an always-on instance and persistent disk mounted at `/app/data`.
4. Set/retain a unique `APP_PASSWORD`; keep it private.
5. Open the HTTPS service on Android and add it to the home screen.

## Environment variables

- `PORT` — defaults to 3000.
- `APP_PASSWORD` — HTTP Basic Auth password; set it on any public host.
- `POLL_INTERVAL_MS` — position price monitoring interval; minimum 10 seconds, default 15 seconds.
- `GBP_USD` — estimated GBP/USD conversion for paper accounting; default 1.27, not a live FX feed.

## Tests

```bash
npm test
```

The automated tests cover scanner scoring gates/model classification and exit behaviour. They do not establish a profitable trading edge.

## Live execution intentionally out of scope

Any future live execution phase would require a separate isolated signer, strict capital limits, transaction simulation, minimum-output checks, idempotency, on-chain balance reconciliation, hardened authentication, audit logs, emergency stop and extensive independent testing. Never store a wallet seed phrase in the browser, repository or ordinary `.env` file.
