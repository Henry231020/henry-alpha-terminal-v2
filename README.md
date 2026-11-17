# HENRY ALPHA TERMINAL V2

Mobile-friendly Solana token discovery and market-intelligence dashboard. The server runs continuously on a supported Node.js host; the dashboard is opened from an Android tablet or any browser.

## Current build scope

- PumpPortal launch and migration discovery over a persistent WebSocket.
- Helius standard WebSocket monitoring of Pump.fun and PumpSwap program logs, followed by confirmed transaction lookups for observed buy/sell activity.
- DexScreener market snapshots with caching and rate-limit backoff.
- Observed buy/sell pressure alerts with explicit data-quality and risk gates.
- Helius-backed holder concentration, creator-wallet share, mint-authority and freeze-authority checks; free RugCheck reports for token risk and insider indicators; and standard WebSocket trade observation when a Helius API key is configured.
- EMA 9/20/50 and RSI 14 from locally observed price samples grouped into UTC one-minute buckets.
- Earliest observed buyer summaries from the subscribed trade feed.
- Tablet-friendly dashboard, token details, Solscan and DexScreener links.
- Optional PostgreSQL persistence for observations and alert history.
- Optional paper-only position simulator with stop-loss, take-profit, trailing-stop, max-position and daily-loss controls. It is disabled by default and never signs or submits transactions.

## Important limitations

- **No automatic trading is enabled.** This build does not sign transactions, connect to a trading wallet, or submit swaps.
- Early buyers means the earliest wallets observed by the Helius log/transaction parser after the token's first-seen event. It does not prove the first on-chain buyers. The parser estimates trade size from signer SOL balance changes, so values may include rent or other transaction effects.
- EMA/RSI values are calculated from sampled DexScreener prices grouped into UTC minute buckets, not exchange-native historical OHLCV. The server retains up to six hours of samples; indicators remain unavailable until enough observations exist.
- PumpPortal launch/migration events are discovery notifications, not a complete transaction tape. Helius standard logs are used for Pump.fun and PumpSwap trade observations; transactions that cannot be reliably parsed are skipped.
- Holder concentration, creator share, and SPL mint/freeze authority checks are only partial risk indicators. Token-2022 extensions, liquidity lock/burn, insider clusters, and wallet/scam reputation are not fully assessed. Unknown or partial risk data must remain unknown; the wallet-risk gate therefore stays closed.
- The app is a long-running Node.js service. A static website or serverless function alone cannot keep its outbound PumpPortal WebSocket open continuously.

## Run

Requirements: Node.js 20 or newer.

```bash
npm install
npm start
```

Open the dashboard at `http://localhost:3000`.

## Container deployment\n\nA production-ready `Dockerfile` and `compose.yaml` are included. Compose runs the app and PostgreSQL with persistent storage and binds the dashboard only to `127.0.0.1:3000`. Use Tailscale Serve to expose it privately over HTTPS to your Android tablet; do not publish ports 3000 or 5432 to the public internet. Set secrets in a private `.env` file, never in GitHub.\n\n**Hosting warning:** many free web-hosting plans sleep when idle or impose short runtime limits. That disconnects the PumpPortal WebSocket and causes missed launches/trades. A static site host or a sleeping free web service is not suitable for continuous monitoring. Confirm the host is always-on and check its current costs before deploying.\n\n## Configuration

Copy `.env.example` into a local `.env` file or set the variables in your hosting provider. Never commit real credentials.

- `HELIUS_API_KEY`: used for standard Solana WebSocket logs, confirmed transaction lookups, holder scans and mint-account checks. The free plan has usage limits; monitor credit consumption.\n- RugCheck's unauthenticated cached token-report endpoint is used for risk/insider signals and is throttled to one request per second; no RugCheck API key is required.\n- PumpPortal is used only for its free token-creation and migration notifications. Its metered trade-subscription endpoint is not used.
- `HELIUS_API_KEY`: optional holder-account enrichment.
- `DATABASE_URL`: optional PostgreSQL persistence.
- `PORT`: web server port.
- `DEX_REFRESH_MS`: market refresh interval; keep conservative to respect provider limits.

## API endpoints

- `GET /health` — health check.
- `GET /api/status` — feed, persistence, and provider diagnostics.
- `GET /api/tokens` — discovered tokens.
- `GET /api/token/:mint` — token and latest market snapshot.
- `GET /api/pressure?mint=:mint` — observed buy/sell pressure.
- `GET /api/indicators/:mint` — sampled 1-minute EMA 9/20/50 and RSI 14.
- `GET /api/early-buyers/:mint` — earliest observed buyer wallets after first-seen time. Requires the token-trade feed and records only wallets observed by that feed.\n- Helius holder-risk lookups are globally rate-limited to five requests per minute and cached per mint for five minutes to protect RPC quotas. The background queue is bounded and exposes its depth in `/api/status`.
- `GET /api/risk/:mint` — holder concentration observation.
- `GET /api/alerts?mint=:mint` — persisted alert history when PostgreSQL is configured.

## Tests

```bash
npm test
```

## Paper trading\n\nPaper simulation is disabled unless `PAPER_TRADING_ENABLED=true` and every risk parameter is supplied in `.env`. It uses observed market prices and is not a realistic execution model: fees, slippage, priority fees and price impact are excluded. Open paper positions and balances are in memory and reset when the process restarts. Check `/api/paper` for its state.\n\n## Security

- Do not put API keys, Telegram tokens, or wallet private keys in source code or GitHub.
- Rotate any API key that has been posted into a chat or committed to a repository.
- Do not import a wallet until the application and its security controls have been reviewed.
- Keep real-money execution disabled until the data feed, risk gates, persistence, and emergency stop have been independently tested.

## Trading roadmap

1. Complete and verify discovery, technical indicators, wallet observations, and alerting.
2. Add paper-trading simulation and replay tests.
3. Add Jupiter quote/transaction construction behind explicit approvals and strict limits.
4. Consider live automation only after paper results and security review. No trade automation is part of the current build.
