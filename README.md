# HENRY ALPHA TERMINAL V2

Cloud-hosted, on-demand Solana token discovery and BUY/SELL decision-support dashboard. Designed to run in the existing GitHub Codespace alongside the GMGN desktop session.

## What it does

- Discovers new PumpPortal token and migration events.
- Subscribes to live token trades when `PUMPPORTAL_API_KEY` is configured, rotating the 100 subscription slots toward newly discovered or selected tokens.
- Retrieves market snapshots from DexScreener with caching and rate-limit backoff.
- Tracks observed buy/sell pressure, trade acceleration, liquidity and holder concentration, with urgent sell-pressure warnings that do not wait for EMA warm-up.
- Calculates EMA 9/20/50 and standard Wilder-smoothed RSI 14 from distinct, timestamped price observations.
- Produces `BUY SETUP`, `WATCHLIST — RISK UNVERIFIED`, `SELL / EXIT WARNING` or `WAIT` decisions with reasons.
- Tracks early observed buyers, repeat wallets across tokens and short-window wallet bursts. These are review signals, not proof of coordination.
- Uses Helius holder-account data when configured and RugCheck token reports for authority, risk-score and insider-network checks. Risk evidence expires after five minutes and is refreshed while a token remains selected.
- Records simulated paper entries/exits and outcome statistics to review which observed conditions worked. It does not automatically change strategy rules.
- Keeps a bounded recent urgent-alert feed in memory as well as PostgreSQL when configured, so live pressure alerts remain visible without a database.
- Optionally persists observations and paper-trade records in PostgreSQL.

## Safety and limitations

- **No real-money order execution, transaction signing, private-key storage or automatic trading is implemented.**
- A BUY SETUP is a heuristic decision-support signal, not a prediction or guarantee.
- A RugCheck low-risk classification requires a complete report, a normalised score at or below 20, revoked mint and freeze authorities, and explicit zero insider-network observations. Missing fields remain unknown.
- Holder concentration and third-party risk reports are snapshots; they do not prove that a token is safe or sellable.
- EMA/RSI require 50 distinct price observations. Cached duplicate quotes are not counted as new observations.
- Paper-learning stop/take-profit baselines are currently -15%/+50%; these are experimental simulation thresholds, not a user-approved live trading strategy.
- PumpPortal trade monitoring requires its API key. Helius holder scanning requires its API key. RugCheck is attempted without a key; an optional key may be configured for authenticated access and higher limits.
- Codespaces can stop when idle. This project is intended for on-demand sessions, not guaranteed 24/7 monitoring.

## Configuration

Copy the variable names from `.env.example` into the Codespace secrets/environment. Never commit API keys, database URLs or wallet secrets.

- `PUMPPORTAL_API_KEY` — enables live token-trade subscriptions.
- `HELIUS_API_KEY` — enables complete holder-account scanning.
- `RUGCHECK_API_KEY` — optional authenticated RugCheck access.
- `DATABASE_URL` — optional PostgreSQL persistence.
- `DEX_REFRESH_MS` — market refresh interval (minimum 15 seconds).

## Run

Node.js 20 or newer:

```bash
npm install
npm test
npm start
```

The dashboard is served by the Node process on `PORT` (default 3000). The `/health` endpoint reports service health; `/api/status` reports provider, feed, persistence and analysis diagnostics.
