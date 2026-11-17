# PumpWatch V3.2 — early-entry discovery (paper only)

Phone-first Solana token discovery and paper-trading dashboard. This branch broadens discovery, removes the manual Watchlist workflow, and records outcomes for both qualified and rejected tokens.

## Safety boundary
Paper trading only. No wallet integration, private-key handling, transaction signing or live execution. Automated entries create simulated positions only. Never add seed phrases or private keys.

## Discovery sources
- DexScreener latest token profiles.
- DexScreener latest boosted tokens (promotion is not a quality signal).
- GeckoTerminal latest Solana new pools (currently the first public page, up to 20 pools).

The feeds are incomplete and rate-limited. GeckoTerminal's public API is cached and subject to change. A pool's creation time is not the token mint's first-ever creation time. The scanner uses the selected pair's age and labels it as pair age.

Sources: [GeckoTerminal API docs](https://api.geckoterminal.com/docs/index.html). Public API documentation describes new pools by network and a rate limit of approximately 10 calls/minute; PumpWatch calls this feed once per discovery scan. (See docs for current behaviour.)

## Two entry models
- **New Launch:** pairs within the configured age window (24h default), weighted toward buy pressure, buyer acceleration and volume expansion.
- **Established:** older pairs, weighted toward volume acceleration and controlled price action.

Both models share hard gates: positive price, minimum liquidity ($10,000 default), minimum 5m volume ($1,500), pair age within 72h, available RugCheck normalized score below 35 with no danger/critical risks, at least two prior observations and minimum score 55. Missing security data fails closed. Scores are heuristics, not probabilities or a validated edge.

The scanner applies a bounded four-worker enrichment pool to reduce total scan time while avoiding unbounded provider requests. Individual failures are retained as rejected discoveries.

## Anti-chase and measurement
The models reward controlled early strength rather than a single vertical candle and penalise 5m price extension above 20%/30%. 5-minute provider statistics are rolling windows; snapshots taken every ~90 seconds overlap and are not independent candles. Acceleration ratios are approximate indicators only.

## Telemetry
Up to 150 recently evaluated tokens are retained, including rejected/failed candidates, with latest score, model, source, checks, rejection reasons, pair age and market-data error. Up to 480 rolling observations per token are retained. Qualified signals track peak/trough and 15m, 1h, 6h and 24h outcomes. This is forward paper evaluation, not historical backtesting.

## Watchlist removal and migration
The Watchlist UI and API routes are removed. Existing positions, trades, events and market history are preserved when loading old state; the legacy watchlist property is discarded. Open positions continue to be refreshed directly by mint address.

## Risk management defaults
- £30 stake cap per position; maximum 3 open positions.
- £30 daily realised-loss pause.
- 25% hard stop default.
- Profit protection from 1.4x; first scale-out at 2x.
- Runner trailing tiers at 3x and 5x.

These are experimental defaults, not optimized parameters. Paper fills do not model route impact, spread, MEV, fees or failed transactions. RugCheck is not a guarantee of safety or sellability. Holder concentration and wallet-level analysis are not yet included.

## Run and test
Node.js 20+.

```bash
npm test
npm start
```

Open `http://localhost:3000`. Set a strong `APP_PASSWORD` before exposing the app outside localhost. `PORT`, `APP_PASSWORD`, `POLL_INTERVAL_MS` and `GBP_USD` are supported environment variables.

GitHub Actions runs `npm test` on pushes and pull requests. The test suite does not establish profitability.
