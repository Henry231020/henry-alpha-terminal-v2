# HENRY ALPHA TERMINAL V2 — integrated build notes

## Safety and deployment
- Work on the `integrated-build` branch. Do not merge into `main` until integration checks pass.
- Automatic real-money trading must remain disabled.
- Never commit API keys. Configure `HELIUS_API_KEY` in Render Environment.
- Use a managed PostgreSQL database for durable state. Local filesystem and in-memory maps are not durable on ephemeral hosting.

## Required integrated capabilities
1. Launch and migration discovery over one persistent PumpPortal WebSocket.
2. Market-data client with cache, bounded concurrency, request pacing, and exponential backoff on HTTP 429.
3. Persist token metadata and timestamped market observations for chart history.
4. OHLC candle aggregation from stored observations, with explicit minimum-history/interval labels; do not fabricate missing candles.
5. Helius-backed token-account/holder and transaction enrichment, with API rate limits and clear partial-data states.
6. Token detail endpoint covering mint, metadata, pair, liquidity, price, volume, transactions, holders and creator-wallet evidence.
7. Potential insider/cluster heuristics based on observable on-chain links; never claim wallet ownership or insider status as proven.
8. Pressure signals from observed buy/sell trades with acceleration, price confirmation, liquidity and risk checks. BUY alerts require confirmation; DUMP alerts may trigger on accelerating sell pressure. No order execution.
9. Wallet performance analytics with lookback window, distinct-token minimum evidence, estimated returns and explicit limitations.
10. Persistent background worker, reconnect handling, alert history and end-to-end tests.

## Provider/data limitations
- A launch/migration event stream is not a full transaction tape.
- Historical candles must come from a documented OHLCV provider or from persisted observations collected over time.
- Holder rankings require a reliable token-account data source and careful treatment of LP, burn, and program-owned accounts.
- Missing provider data must be represented as unavailable, never as zero or as a clean risk result.
- Respect provider terms, request quotas and backoff headers.

## Acceptance checks before merge
- Server starts under supported Node version.
- Health/status endpoints respond.
- WebSocket reconnects without duplicate sockets.
- Market client backs off after HTTP 429 and reuses cached data.
- Token detail APIs handle unknown mints and provider failures without crashing.
- Chart intervals never imply historical data exists before it was collected.
- Holder totals disclose account-vs-owner distinctions where applicable.
- No real trade submission code is enabled.
