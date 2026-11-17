# HENRY ALPHA V9 — Jupiter execution foundation

## Current branch and status
- Branch: `jupiter-v9` (based on `integrated-build`).
- The existing V2 dashboard remains monitoring-only on `main`.
- This branch adds the Jupiter Swap API V2 client and fail-closed automated-trading risk policy.
- It is not yet connected to the production event loop, wallet signer, durable position ledger, or live deployment.

## Providers
- Discovery and market snapshots: existing PumpPortal launch/migration feed and DEX Screener.
- Holder data: existing Helius holder-account scan.
- Execution: Jupiter Swap API V2 at `https://api.jup.ag/swap/v2`.
- Jupiter supports keyless prototype requests with a low rate limit and a free API key for higher free-tier limits. No paid plan is required for initial testing; rate limits apply.
- Jupiter's managed flow is `GET /order`, wallet signs the returned transaction, then `POST /execute`.

## Safety defaults
- `TRADING_MODE=paper`
- `AUTO_TRADING_ENABLED=false`
- Maximum buy: 0.02 SOL
- Maximum open positions: 2
- Daily realised-loss stop: 0.05 SOL
- Stop-loss: 20%
- Take-profit: 50%
- Maximum slippage: 100 bps
- Minimum liquidity: USD 10,000
- Maximum top-10 holder concentration: 35%
- Stale market data, missing holder data, unknown wallet risk, provider errors, or incomplete signals block buys.
- No withdrawals, no transfer endpoint, no arbitrary destination wallet, no leverage, no averaging down.

These are conservative initial engineering defaults, not a claim that any trade is safe or profitable. They must be reviewed before live activation.

## Critical remaining work before real automatic trading
1. Connect the pressure engine to a position/risk orchestrator and make the buy/sell state durable in PostgreSQL.
2. Add wallet balance and token-balance reconciliation so the bot never assumes an order filled.
3. Add a dedicated burner-wallet signer. The private key must be stored only as a server-side secret, never in GitHub, browser JavaScript, chat, Telegram, or logs. Never use the main wallet.
4. Verify token mint/freeze authority, creator/cluster risk, LP/liquidity quality, sellability and quote impact. The current Helius module only estimates holder concentration; it does not establish wallet risk as low. Therefore its current data cannot pass the live buy gate.
5. Add daily reconciliation, duplicate-order idempotency, transaction confirmation and emergency kill switch.
6. Run tests, then paper-trade for at least 7 days across launches and migrated tokens. Do not enable live mode until paper results and sell handling are verified.
7. Deploy to a host that does not sleep. The existing Render free service can sleep and is not suitable as the sole always-on executor. A no-subscription free tier may be suitable for development but availability and quotas are not guaranteed.

## Environment variables
Copy names only into the host's secret/environment settings. Do not commit real values.

```env
JUPITER_API_KEY=
TRADING_MODE=paper
AUTO_TRADING_ENABLED=false
MAX_BUY_SOL=0.02
MAX_OPEN_POSITIONS=2
MAX_DAILY_LOSS_SOL=0.05
STOP_LOSS_PCT=20
TAKE_PROFIT_PCT=50
MAX_SLIPPAGE_BPS=100
MIN_LIQUIDITY_USD=10000
MAX_TOP10_CONCENTRATION_PCT=35
MAX_MARKET_DATA_AGE_MS=15000
TRADE_COOLDOWN_MS=60000
```

## Android access
The dashboard remains a mobile web app; use Chrome on the Android tablet. No local computer installation is required for dashboard use. Cloud deployment is still required for the background worker.

## Important
The bot is not live and no trade has been placed. The presence of the Jupiter client does not activate trading. Keep the live flag off until the remaining work above is complete.
