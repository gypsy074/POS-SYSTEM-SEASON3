# Season 3 POS — Deployment & Operations Guide

Everything you need to run, deploy, and update the Season 3 POS System.

---

## 1. What This Project Is

A food-ordering + billing system built with:

- **Frontend** (plain HTML/CSS/JS): login page, cashier POS, admin panel
- **Backend** (Node.js + Express + Mongoose): REST API for orders, menu, users, inventory, waste, audit logs
- **Database**: MongoDB Atlas (cloud), database `pos_season3cafe`

The backend serves the frontend too — one Node process runs the whole app.

---

## 2. Running Locally

Prerequisites: Node.js 18+, your `backend/.env` file.

```bash
cd backend
npm install        # first time only
npm run dev        # or: node server.js
```

Then open:

| Page | URL |
|---|---|
| Login | http://localhost:3000 |
| Cashier POS | http://localhost:3000/CASHIER/pos.html |
| Admin panel | http://localhost:3000/ADMIN/admin.html |

### `backend/.env` (never commit this file)

| Key | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string (see `.env.example`) |
| `JWT_SECRET` | Secret that signs login sessions — **required in production**. The server refuses to boot without it (fail-fast), so there is never a weak built-in fallback |
| `CORS_ORIGIN` | Comma-separated allowed origins. **Empty = CORS closed** (only same-origin requests work). Set it to `https://season3-pos.onrender.com` (plus your LAN IP during class demos, e.g. `http://192.168.1.50:3000`) |
| `SEED_ADMIN_USERNAME` | Optional. Admin username created on first boot if no users exist (default `admin`) |
| `SEED_ADMIN_PASSWORD` | Optional. Local dev only. In production this is ignored — a **random password** is generated and printed in the logs instead |
| `AI_API_KEY` | Optional. Google AI Studio key (`gemini-2.0-flash`) for the AI business report. Without it the report falls back to a statistics summary |
| `AI_PROVIDER` | Optional. `gemini` (default) or `groq` (free tier, `llama-3.3-70b-versatile`) |
| `GROQ_API_KEY` / `AI_MODEL` | Optional. Only when `AI_PROVIDER=groq` |
| `JWT_EXPIRES_IN` | Optional. Session lifetime, default `8h` |

A default **admin** account is created automatically on first boot if no users exist.

---

## 3. The Live App

| Item | Value |
|---|---|
| URL | https://season3-pos.onrender.com |
| Health check | https://season3-pos.onrender.com/api/health |
| Cashier | https://season3-pos.onrender.com/CASHIER/pos.html |
| Admin | https://season3-pos.onrender.com/ADMIN/admin.html |

Health passes when it returns `{"ok":true,"mongo":"connected"}`.

> Classmates log in with an admin-created **Cashier** account (Admin panel → Users). Share the admin password only with trusted people.

---

## 4. How Render Deployment Works

Render builds and runs the backend from the `render.yaml` blueprint:

| Setting | Value |
|---|---|
| Root directory | `backend` |
| Build command | `npm install` |
| Start command | `node server.js` |
| Env vars (required) | `MONGO_URI`, `JWT_SECRET` |
| Env vars (optional) | `CORS_ORIGIN`, `AI_API_KEY`, `AI_PROVIDER`, `GROQ_API_KEY`, `AI_MODEL`, `JWT_EXPIRES_IN` |

> If a deploy fails instantly, the first thing to check is the **Environment tab**:
> the server now refuses to boot without `JWT_SECRET` and a valid `MONGO_URI`.

### Free-tier behavior (important)

- The service **sleeps after ~15 minutes without visitors**
- The first visit after sleep takes ~30–60 seconds to wake up (cold start)
- **Fix: a keep-awake pinger** (see section 9) hits `/api/health` every 5 minutes,
  so the app is always warm before class starts
- The Atlas database stays online 24/7 — **no data is ever lost**
- Optional: upgrade to Render Starter ($7/month) for always-awake

### Troubleshooting fast check

`/api/health` shows `"mongo":"disconnected"` — look at Render → **Logs**:

| Log line | Cause | Fix |
|---|---|---|
| `getaddrinfo ENOTFOUND cluster0-shard...` | Wrong/old hostname in MONGO_URI | Paste the correct string from Atlas |
| `Could not connect... not whitelisted` | Atlas blocks Render's IPs | Atlas → Network Access → add `0.0.0.0/0` |
| `Authentication failed` | Wrong user or database name | Check the db name/user in the URI |

---

## 5. Deploying a Change (the release workflow)

Every release follows the same path: **edit → test → bump → commit → push → verify**.

### Step 1 — Edit & self-check

```bash
cd backend && npm test      # 43 tests must pass (in-memory DB, no keys needed)
node --check frontend/ADMIN/js/dashboard.js   # quick syntax check on changed JS
```

### Step 2 — Bump the `?v=` version markers (important)

The frontend loads JS/CSS with cache-busting query params (`dashboard.js?v=40`).
If you change a JS/CSS file **without** bumping its marker, phones and laptops
may keep running the old cached copy. In `frontend/ADMIN/admin.html` (and
`frontend/CASHIER/pos.html` where shared files load), bump the marker of every
file you touched. Example: `dashboard.js?v=40` → `?v=41`.

The current markers also act as the **release signature** — after a deploy you
can confirm the new version is live just by checking which `?v=` numbers
`https://season3-pos.onrender.com/ADMIN/admin.html` shows.

### Step 3 — Commit & push

```bash
git add .
git commit -m "feat(whatever): short description"
git push origin ulan
```

### Step 4 — Deploy

Render auto-deploys (~2 minutes) **if Auto-Deploy is enabled** for the service
(Render → service → Settings → Deploy branch `ulan` → Auto-Deploy **Yes**).
Check the Render dashboard to confirm it is on.

**If a push does not trigger a deploy** (Auto-Deploy off, or Render missed it),
use one of these fallbacks:

- Render → service → **Manual Deploy → Deploy latest commit**, or
- the API hook (one-liner, no login needed):

```powershell
Invoke-RestMethod -Uri "https://api.render.com/deploy/srv-d9u8ng942hec739raah0?key=KcL_9tDyxIY" -Method Post -ContentType "application/json" -Body '{}'
```

The hook returns `{"deploy":{"id":"dep-..."}}`; the deploy usually lands within
45–90 seconds. If the first trigger seems stuck, fire the hook again.

### Step 5 — Verify

1. `https://season3-pos.onrender.com/api/health` → `{"ok":true,"mongo":"connected"}`
2. Load `https://season3-pos.onrender.com/ADMIN/admin.html` and check the `?v=`
   markers match what you pushed (they change with each release — see CHANGELOG)
3. Log in and smoke-test the changed page

---

## 6. Database Safety Notes

- Credentials exist only in `backend/.env` (local) and Render's Environment tab (live) — never in git
- `backend/.gitignore` and `.env.example` protect the setup:
  - `.env`, `.env.*`, `atlas-credentials.env` are ignored
  - `.env.example` documents which keys are needed, without secrets
- Old credentials that appeared in public git history were retired; the live DB uses a separate user
- The POS supports offline ordering: orders placed without a connection are queued
  in the browser (`localStorage`) and auto-synced when the connection returns.
  Each order carries a `clientOrderId`, so retries never create duplicates.

---

## 7. Testing

Automated (backend, requires the dependencies installed):

```bash
cd backend
npm test
```

Expect 43 passing tests: auth, order placement, stock deduction, overload (409),
waste logging, void + stock restore, offline-retry dedupe, password minimum
length (3 routes), oversized-body rejection (413), CORS closed by default, AI
report rate limiting (429), order-delete guard (paid orders 409, voided 200),
and order-fetch bounds (`?days=`/`?limit=`).

Run them locally:

```bash
cd backend
npm test
```

Tests use an in-memory MongoDB (`mongodb-memory-server`) — no real database
or API keys are needed.

Manual smoke test (live site or local):

1. Login (admin or a cashier account)
2. Cashier: add an item to the cart → pay cash (calculator) → swipe to place
3. Confirm the receipt modal + print dialog, then find it under My Orders
4. Admin → Menu: the product's stock decreased; Sales shows the order; CSV export works
5. Void the order from My Orders → stock returns, revenue excludes it
 6. Offline test: DevTools → Network → Offline → place an order → green "synced" banner when back online

---

## 8. Backups (free)

Atlas auto-backups are a paid feature, so this project ships a free local backup script:

```bash
cd backend
npm run backup
```

It dumps every collection (users, products, orders, waste, inventory, auditlogs) to
`backend/backup/<timestamp>/` as JSON files.

**Schedule it daily (Windows):**

1. Open Task Scheduler → Create Basic Task → name "POS Backup"
2. Trigger: Daily at a quiet hour (e.g. 4:00 AM)
3. Action: Start a program → `powershell.exe` → arguments:
   `-NoProfile -Command "cd D:\rawpos\POS-SYSTEM-SEASON3\backend; npm run backup"`
4. Optionally back up the `backend/backup` folder to OneDrive/Google Drive for off-site safety

### Lost admin password? Reset it

The production admin password is **randomly generated** on first boot. If it gets
lost, reset it from any machine with `backend/.env` (the Atlas URI):

```bash
cd backend
npm run reset-admin-password -- admin MyNewPass123
```

It sets the new password (min 8 characters) and **revokes every active session**
for that user, so any forgotten device is logged out immediately. Run it locally
— it connects straight to Atlas; the Render service does not need to be touched.

---

## 9. Uptime Monitoring & Keep-Awake (free)

A pinger does two jobs at once: it **keeps the free tier awake** (killing the
~40-second cold start) and **alerts you by email** if the site stops responding.

1. Sign up at https://cron-job.org (free plan)
2. Create a cron job:
   - URL: `https://season3-pos.onrender.com/api/health`
   - Method: **GET**
   - Schedule: **every 5 minutes**
   - Alert contact: your email, notification on failure
3. Save and enable it — the job runs forever in the background

Optional alternative: https://uptimerobot.com (free plan) monitors the same URL
and emails you on downtime, but it does **not** keep the app awake — with
cron-job.org you get both.

---

## 10. Security Notes

- **Login is rate-limited** (10 attempts / 15 min per IP) and protected by helmet headers
- **`JWT_SECRET` is required in production** — the server refuses to boot without it
  (fail-fast), so a weak default can never be deployed by accident
- **CORS is closed by default** — no other website can call the API unless
  `CORS_ORIGIN` explicitly allows it
- **Login timing equalizer** — unknown usernames are hashed with the same bcrypt
  cost as real ones, so attackers can't tell which usernames exist
- **Password minimum length 8** — enforced on create, change, and reset
- **AI report rate limit** — 5 requests / minute / IP
- **Request size limits** — 100 KB default, 10 MB for product images (413 on oversized)
- **Production seed admin has a random password** — printed once in the logs on
  first boot. **Still: change the live admin password immediately** if it is ever
  the known `admin123` default
- **Output is HTML-escaped** everywhere user data is rendered (sessions page,
  AI report, toasts, tables) to prevent stored XSS
- The old Atlas user that appeared in public git history was retired; the live DB
  uses a separate user. If you ever leak credentials again, rotate them immediately
  in Atlas (Database Access → the user → edit) and update `backend/.env` + the
  Render env vars.
- Logins, logouts, password changes, session revokes, order voids/deletes, and
  user + waste actions are recorded in the audit log — view them in Admin → Audit Log