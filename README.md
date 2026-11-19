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
- Keeps a bounded recent BUY SETUP, SELL / EXIT WARNING and urgent-pressure alert feed in memory as well as PostgreSQL when configured. BUY and SELL signals have independent cooldowns, so one side cannot suppress the opposite signal.
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


Wallet-intelligence memory is bounded across the whole session: token-wallet pairs have a global cap, each token has a wallet cap, and burst-event history has a global cap of 100,000 events. Older burst events are evicted first; this can reduce historical burst coverage but cannot create a false coordinated-burst signal.


Trade USD valuation uses a timestamped SOL/USD quote. Quotes more than 60 seconds before or after the observed trade are rejected rather than allowed to distort buy/sell pressure; quote age and whether the USD estimate is approximate are retained with accepted trade observations. Pending trades expire outside this same freshness window.
SOL/USD quote requests also use a failure cooldown (15 seconds by default, or a bounded numeric `Retry-After` when supplied) to avoid hammering the quote provider during outages; the current quote age and next retry time are exposed in `/api/status`.

Token metadata retrieval accepts HTTPS URLs only, rejects credentials, non-standard ports, localhost/internal names and literal private/reserved IP destinations, and refuses redirects. This reduces exposure to malicious token-supplied metadata URLs; arbitrary DNS hostnames are still subject to the host's network-resolution policy.

Pressure-store and wallet-intelligence maps now refresh active records before eviction, using least-recently-used retention so frequently observed tokens and wallets are less likely to be discarded during token churn.

API `limit` query parameters are parsed as bounded safe integers; missing or malformed values use endpoint defaults instead of propagating `NaN` into persistence queries or result slicing.

Dashboard wallet-activity counts distinguish missing observations from a measured zero; early-buyer counts remain `UNVERIFIED` when token first-seen coverage is unavailable. Trade-observation WebSocket updates use the validated USD valuation object. BUY SETUP and SELL / EXIT WARNING decisions are included in the saved and broadcast alert stream, alongside pressure-only alerts when full technical decisions are not ready. Burst-history eviction uses a queue cursor with periodic compaction to avoid repeated O(n) array shifts at high event rates.

The live-feed diagnostics panel also shows stale SOL/USD valuations rejected, current SOL/USD quote age, and the next provider retry time when a cooldown is active.
