# Season 3 POS System

A web-based Point-of-Sale system for Season 3 Cafe: menu management, cashier ordering with offline support, inventory tracking, food waste logging, sales analytics, and audit logging.

- **Live site:** https://season3-pos.onrender.com
- **Stack:** Node.js + Express 5 + MongoDB Atlas (Mongoose 9) | Vanilla JS admin panel + cashier PWA | Chart.js

## Features

- **Login & roles** - Admin and Cashier accounts (JWT auth, bcrypt-hashed passwords)
- **Cashier page** - touch-friendly ordering, payment/change calculator, receipts, order history, live notifications, barcode-style search
- **Offline mode** - service worker caches the cashier app; orders placed offline are queued and auto-synced (idempotent via clientOrderId)
- **Admin panel** - dashboard (revenue, performance, updates), sales analytics (line/radar/usage charts, calendar, CSV export), menu, users, inventory, waste food, audit log
- **Audit logging** - every order, user, waste, and menu action is recorded with actor + detail
- **Security** - rate-limited login, helmet security headers, role-based API access

## Local Setup

1. Create `backend/.env` from `backend/.env.example` (MONGO_URI, JWT_SECRET, CORS_ORIGIN)
2. `cd backend && npm install`
3. `npm start` - server runs at http://localhost:3000
4. Admin page: http://localhost:3000/ADMIN - Cashier page: http://localhost:3000/CASHIER

A default admin (`admin` / `admin123`) is seeded on first boot - **change it immediately** in Admin > Add Users.

## Tests

```
cd backend && npm test
```

9 Jest tests against an in-memory MongoDB (no external DB needed).

## Deployment

Deployed on Render via blueprint (`render.yaml`), auto-deployed from the `ulan` branch. See **DEPLOYING.md** for the full operations guide.

## Uptime Monitoring (free)

1. Sign up at https://uptimerobot.com (free plan)
2. Add monitor: HTTPS, url `https://season3-pos.onrender.com`, interval 5 min
3. Set contact email alerts - you'll be notified if the site goes down

## Backups (free)

```
cd backend && npm run backup
```

Dumps all collections to `backend/backup/<timestamp>/` as JSON. Schedule it daily with Windows Task Scheduler (see DEPLOYING.md).
