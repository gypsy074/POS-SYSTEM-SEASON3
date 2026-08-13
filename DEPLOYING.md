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
| `JWT_SECRET` | Secret that signs login sessions — use a long random string |
| `CORS_ORIGIN` | Allowed origins. `*` = any (classroom use) |

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
| Env vars | `MONGO_URI`, `JWT_SECRET`, `CORS_ORIGIN` |

### Free-tier behavior (important)

- The service **sleeps after ~15 minutes without visitors**
- The first visit after sleep takes ~30–60 seconds to wake up (cold start)
- The Atlas database stays online 24/7 — **no data is ever lost**
- Tip: open the site 1–2 minutes before a class demo so it stays fast for everyone
- Optional: upgrade to Render Starter ($7/month) for always-awake

### Troubleshooting fast check

`/api/health` shows `"mongo":"disconnected"` — look at Render → **Logs**:

| Log line | Cause | Fix |
|---|---|---|
| `getaddrinfo ENOTFOUND cluster0-shard...` | Wrong/old hostname in MONGO_URI | Paste the correct string from Atlas |
| `Could not connect... not whitelisted` | Atlas blocks Render's IPs | Atlas → Network Access → add `0.0.0.0/0` |
| `Authentication failed` | Wrong user or database name | Check the db name/user in the URI |

---

## 5. Deploying a Change (the push flow)

1. Edit code locally, test with `npm test`
2. Commit and push the branch Render follows (`ulan`):

```bash
git add .
git commit -m "feat(whatever): short description"
git push origin ulan
```

3. Render auto-deploys (~2 minutes) because the repo is connected (webhook)
4. Verify: open `https://season3-pos.onrender.com/api/health`

If a deployment ever does not trigger (e.g., before the repo was connected), use
Render → service → **Manual Deploy → Deploy latest commit**.

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

Expect 9 passing tests: auth, order placement, stock deduction, overload (409),
waste logging, void + stock restore, and offline-retry dedupe.

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

---

## 9. Uptime Monitoring (free)

1. Sign up at https://uptimerobot.com (free plan)
2. Add a monitor: **HTTPS**, URL `https://season3-pos.onrender.com`, interval 5 minutes
3. Add your email as the alert contact — you'll be notified if the site goes down.
   Free tier also covers the monthly sleep at the end of the week; expect alerts during
   Render's scheduled maintenance only.

---

## 10. Security Notes

- Login is rate-limited (10 attempts / 15 min per IP) and protected by helmet headers
- The old Atlas user that appeared in public git history was retired; the live DB uses a
  separate user. If you ever leak credentials again, rotate them immediately in Atlas
  (Database Access → the user → edit) and update `backend/.env` + the Render env vars.
- Admin page actions are recorded in the audit log — view them in Admin → Audit Log