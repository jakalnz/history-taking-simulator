# Cloudflare Worker Deployment

This Worker acts as a secure proxy between the browser app and the Anthropic API. The API key never reaches the browser.

## Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`

## Deploy in 4 steps

### 1. Log in to Cloudflare
```bash
wrangler login
```

### 2. Go to the worker folder
```bash
cd worker
```
The `worker.js` and `wrangler.toml` are already there — no init needed.

### 3. Set secrets (never committed to git)
```bash
wrangler secret put ANTHROPIC_API_KEY
# Paste your Anthropic API key when prompted

wrangler secret put SESSION_TOKEN
# Choose a password for students — e.g. "audiology2026"
# Change this each semester to rotate access
```

### 4. (Optional) Restrict to your GitHub Pages domain
Edit `wrangler.toml` and uncomment the `[vars]` block:
```toml
[vars]
ALLOWED_ORIGIN = "https://YOUR-USERNAME.github.io"
```

### 5. Deploy
```bash
wrangler deploy
```

Wrangler will output a URL like:
```
https://audiology-sim.YOUR-SUBDOMAIN.workers.dev
https://audiology-sim.mpsanders.workers.dev
```

Copy this URL — paste it into:
- **Clinician mode → Settings → Proxy URL** (saves to localStorage)
- Share it with students so they can enter it in **Student mode → Settings**

## Rotating access each semester

Just change the `SESSION_TOKEN` secret:
```bash
wrangler secret put SESSION_TOKEN
```
Old passwords stop working immediately. Students enter the new one in Settings.

## Rate limiting (optional)

Add [Cloudflare Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/cache/) to the Worker if you want to cap usage per IP. The free tier includes basic rate limiting rules via the Cloudflare dashboard under **Security → WAF → Rate limiting rules**.

## Cost

- Cloudflare Workers: **free** for up to 100,000 requests/day
- Anthropic API: ~$0.01–0.05 per student session (using `claude-haiku-4-5`)
