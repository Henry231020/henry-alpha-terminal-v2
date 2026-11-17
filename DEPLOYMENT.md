# HENRY ALPHA — private, always-on deployment

This is the deployment plan for controlling HENRY ALPHA from an Android tablet without exposing the dashboard or PostgreSQL to the public internet.

## Target architecture

- **Compute:** Oracle Cloud Always Free Ampere VM, within its Always Free limits (up to 2 OCPUs and 12 GB RAM). Availability depends on the home region; do not upgrade to a paid shape just to get capacity.
- **Runtime:** Docker Compose. The Node.js scanner and PostgreSQL database restart automatically and PostgreSQL data persists in a Docker volume.
- **Chain data:** PumpPortal free launch/migration notifications plus Helius standard Solana WebSockets and confirmed transaction lookups. PumpPortal's metered trade-subscription endpoint is not used. Free RugCheck cached reports add token-risk and insider-network signals; Jupiter Price V3 provides a read-only reference-price cross-check. No RugCheck or Jupiter API key is required for these read-only calls.
- **Private tablet access:** Tailscale Personal plan plus Tailscale Serve HTTPS. Only devices signed into the same private tailnet can reach the dashboard.
- **Trading:** discovery, indicators, risk observations and alerts. Optional paper-only simulation is disabled by default. No wallet signer, Jupiter quote/order build or swap execution, or automatic trading.

This architecture aims for no monthly subscription. Important: Oracle can reclaim an Always Free compute instance if CPU, network, and memory utilisation all remain below its idle thresholds for seven days. A lightly loaded scanner may be at risk of reclamation, so Oracle is a free trial deployment candidate, not a guaranteed always-on host. Helius free credits also have limits. Monitor usage and never select a paid resource by accident. If uninterrupted hosting is essential and no free host meets the workload, an always-on VPS may cost money; do not approve one without checking first.

## One-time cloud setup

1. Create an Oracle Cloud Free Tier account and a Linux ARM64 Ampere VM in the Always Free allowance. If the console says there is no capacity, wait or try another availability domain in the home region. Do not choose a paid shape.
2. Add your SSH public key during VM creation. Keep the SSH private key private.
3. Install Docker Engine and the Docker Compose plugin using Docker's official installation instructions.
4. Install Tailscale on the VM using its official Linux instructions, then run `sudo tailscale up` and complete the sign-in page. The Personal plan is free for personal use; confirm your account remains on that plan.
5. In the Tailscale admin console, enable MagicDNS and HTTPS certificates. Tailscale Serve uses the private tailnet and provides an HTTPS address; it does not publish the app to the public internet.

## Configure HENRY ALPHA

From the VM:

```bash
git clone --branch henry-alpha-build --single-branch https://github.com/Henry231020/henry-alpha-terminal-v2.git
cd henry-alpha-terminal-v2
cp .env.example .env
chmod 600 .env
nano .env
```

Set only these private values in `.env`:

- `HELIUS_API_KEY`: your Helius Mainnet API key. RugCheck uses its unauthenticated free cached-report endpoint and is throttled to one request per second.
- `POSTGRES_PASSWORD`: a long, unique random password.

Keep the other example values unless we deliberately change them. Never paste `.env`, the Helius key, or any wallet key into chat or GitHub.

Start the app and database:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
```

The app is published only on `127.0.0.1:3000` on the VM. The database has no public port. Tailscale Personal is $0 for personal use (up to six users); Serve provides private HTTPS within your tailnet.

## Private access from the Android tablet

On the VM, run:

```bash
sudo tailscale serve --bg 3000
sudo tailscale serve status
```

Tailscale prints the private HTTPS address for this server (a `.ts.net` address). Install the Tailscale app on the Android tablet, sign in with the same account, turn Tailscale on, then open that HTTPS address in Chrome.

Do **not** open ports 3000 or 5432 in the Oracle firewall/security list. Do not use Tailscale Funnel; Serve is the private option.

## Health checks

- Dashboard: the private `.ts.net` address shown by `tailscale serve status`.
- Health endpoint: append `/health`.
- Provider and usage diagnostics: append `/api/status`.
- Logs: `docker compose logs -f app`.

The status endpoint must show PumpPortal connected and Helius standard logs connected before we count the feeds as operational. The dashboard should show real token events and observed trade counts. If Helius is disconnected or its key is missing, early-buyer and trade-pressure data must remain unavailable rather than being guessed.

## Limits and safety

- Helius Free currently includes a monthly credit allowance and request-rate limit. WebSocket traffic and transaction lookups consume resources; monitor the Helius dashboard.
- Early buyers means earliest wallets our parser observed after the token first-seen event, not a guarantee of the first on-chain buyers.
- SOL trade size is estimated from signer balance changes and may include transaction effects. It is not an exact fill receipt.
- Helius holder/mint checks and RugCheck's cached report are partial signals, not a full rug-pull guarantee. RugCheck free reports may be stale; unknown or incomplete data blocks buy alerts.
- A VM, network, provider or database can still fail. The service reconnects to its feeds, but it cannot recover events missed while offline unless a later backfill is added.
- Never import a funded wallet or enable live trading during initial deployment. Paper simulation is also disabled until you choose its test parameters; it never uses a wallet. We will validate the scanner and alerts first.
