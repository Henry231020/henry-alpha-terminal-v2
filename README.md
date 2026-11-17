# HENRY ALPHA TERMINAL V2

Mobile-friendly Solana token discovery and market-intelligence dashboard. The server runs continuously on a supported Node.js host; the dashboard is opened from an Android tablet or any browser.

## Current build scope

- PumpPortal launch and migration discovery over a persistent WebSocket.
- Optional PumpPortal token-trade subscriptions for observed buy/sell activity.
- DexScreener market snapshots with caching and rate-limit backoff.
- Observed buy/sell pressure alerts with explicit data-quality and risk gates.
- Helius-backed holder concentration lookup when a Helius API key is configured.
- EMA 9/20/50 and RSI 14 from locally observed price samples grouped into UTC one-minute buckets.
- Earliest observed buyer summaries from the subscribed trade feed.
- Tablet-friendly dashboard, token details, Solscan and DexScreener links.
- Optional PostgreSQL persistence for observations and alert history.

## Important limitations

- **No automatic trading is enabled.** This build does not sign transactions, connect to a trading wallet, or submit swaps.
- Early buyers means the earliest wallets observed by the configured feed after the token's first-seen event. It does not prove the first on-chain buyers.
- EMA/RSI values are calculated from sampled DexScreener prices grouped into minute buckets, not exchange-native historical OHLCV. Indicators remain unavailable until enough samples exist.
- PumpPortal launch/migration events are not a complete transaction tape. Token-trade subscription access requires a valid `PUMPPORTAL_API_KEY`.
- Holder concentration is not a complete token-safety verdict. Unknown or partial risk data must remain unknown.
- The app is a long-running Node.js service. A static website or serverless function alone cannot keep its outbound PumpPortal WebSocket open continuously.

## Run

Requirements: Node.js 20 or newer.

```bash
npm install
npm start
```

Open the dashboard at `http://localhost:3000`.

## Configuration

Copy `.env.example` into a local `.env` file or set the variables in your hosting provider. Never commit real credentials.

- `PUMPPORTAL_API_KEY`: optional for launch/migration discovery; required for token-trade subscriptions and observed wallet activity.
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
- `GET /api/early-buyers/:mint` — earliest observed buyer wallets after first-seen time.
- `GET /api/risk/:mint` — holder concentration observation.
- `GET /api/alerts?mint=:mint` — persisted alert history when PostgreSQL is configured.

## Tests

```bash
npm test
```

## Security

- Do not put API keys, Telegram tokens, or wallet private keys in source code or GitHub.
- Rotate any API key that has been posted into a chat or committed to a repository.
- Do not import a wallet until the application and its security controls have been reviewed.
- Keep real-money execution disabled until the data feed, risk gates, persistence, and emergency stop have been independently tested.

## Trading roadmap

1. Complete and verify discovery, technical indicators, wallet observations, and alerting.
2. Add paper-trading simulation and replay tests.
3. Add Jupiter quote/transaction construction behind explicit approvals and strict limits.
4. Consider live automation only after paper results and security review. No trade automation is part of the current build.
