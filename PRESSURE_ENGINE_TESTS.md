# Pressure engine acceptance tests

Run with `npm test` using Node.js 20 or newer.

- No BUY alert may be emitted when liquidity, holder concentration, or wallet risk is unknown.
- Urgent sell-pressure alert does not wait for price confirmation.
- Empty/insufficient provider data returns WAIT and never activates trading.
- Every result reports `automaticTrading: false`.

These tests validate only the standalone pressure engine. They do not certify provider connectivity, persistence, market-data completeness, or the deployed service.
