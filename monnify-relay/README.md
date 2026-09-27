# Monnify Relay (Static IP via Fixie)

A tiny Node.js service that forwards Monnify API calls through Fixie's proxy so they originate
from a fixed set of IPs — Monnify requires IP whitelisting for disbursement/collection calls, and
neither Railway's nor Vercel's outbound IP pool is guaranteed static across deploys/restarts.

## Architecture

```
api (Railway)  ->  this relay (Railway, separate service)  ->  Fixie  ->  Monnify
                                                              ↑ 2 static IPs
```

The main API's `MonnifyService` (api/src/modules/monnify) calls this relay instead of Monnify
directly whenever `MONNIFY_RELAY_URL` is set — see `monnifyConfig` in
api/src/config/configuration.ts. Contract: `POST {MONNIFY_RELAY_URL}/forward` with header
`x-relay-secret: ${MONNIFY_RELAY_SHARED_SECRET}` and a JSON body `{ method, path, headers, body,
baseUrl }`; the relay returns Monnify's raw response status/body untouched. `GET /health` returns
`{"ok":true}`.

## Deploy to Railway

1. Push this folder as its own repo (or a Railway service pointed at this subdirectory of the
   monorepo — Railway supports a custom root directory per service).
2. Railway → New Project → Deploy from GitHub repo → this repo/subdirectory. Auto-detects Node.

3. Add Fixie: go to https://usefixie.com → sign up → create an app → copy the **FIXIE_URL** and
   note the **2 static IPs** shown.

4. Set env vars on the Railway service:
   - `FIXIE_URL` — from Fixie.
   - `RELAY_SHARED_SECRET` — a long random string (`openssl rand -hex 32`); also set as
     `MONNIFY_RELAY_SHARED_SECRET` on the main api's Railway service.
   - `MONNIFY_BASE_URL` — `https://api.monnify.com` (or `https://sandbox.monnify.com` while
     testing).

5. Railway → Settings → Networking → Generate Domain → copy the relay's URL and set it as
   `MONNIFY_RELAY_URL` on the main api's Railway service.

6. Whitelist Fixie's 2 IPs in the Monnify dashboard (Settings → Developer → IP Whitelist).

## Test

```bash
curl https://YOUR-RELAY-URL/health
# → {"ok":true}
```
