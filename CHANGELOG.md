# Changelog

All notable changes to the Season 3 POS System.

## [v1.3.0] - 2026-08-16

### Fixed
- **Timezone bug:** server-side day grouping (insights forecast, anomalies, waste) now runs on `Asia/Manila` time. Render containers default to UTC, so orders placed 12:00–08:00 AM Manila time were landing on the wrong day
- **Void crash on bodiless requests:** `PATCH /api/orders/:id/void` with no JSON body returned 500 (`req.body` undefined); now safe
- **CSV export filename** now uses Philippine-local date instead of UTC (was off by one day for late-evening exports)

### Changed
- **Order deletion guard:** `DELETE /api/orders/:id` now refuses to delete a paid order (409) — it must be **voided first**. Hard-deleting a paid order silently rewrote yesterday's revenue, charts, insights, and CSV exports; voiding keeps the row visible and transparently excludes it from stats
- **Bounded order fetches:** `GET /api/orders` accepts `?days=` (1–365) and `?limit=` (1–5000); the admin dashboard now fetches the last 90 days (max 5000 orders) and the cashier history the last 7 days instead of the entire order history — page loads stay fast as the canteen grows
- **`npm run reset-admin-password -- <username> <new-password>`** — recovery tool for a lost production admin password (it is randomly generated on first boot). Resets the password and revokes every active session for that user
- Test suite: 39 → 43 tests (delete guard ×2, fetch bounds ×2)

## [v1.2.0] - 2026-08-16

### Added
- AI Insights panel (Admin > Insights): revenue forecast, restock suggestions, waste insights, sales anomalies, and daily snapshot cards
- AI business report button with ghost-tap guard (prevents double submission); falls back to a plain statistics summary when no AI API key is configured
- Account & Sessions page (Admin and Cashier): lists all active login sessions with device icons, relative time, age badges; kill one session, revoke all others, change password; audible + banner alert when a new sign-in happens on another device
- Animated close for the header profile and notification dropdowns
- Button press animations across the admin panel
- Transactions search box + 100-row cap on the dashboard's Recent Transactions table (searches customer, receipt ID, and item names)
- CSV formula-injection guard: cells starting with `=`, `+`, `-`, or `@` are prefixed with `'` so Excel never executes them
- Dark mode styles for charts, dropdowns, avatars, and the new transactions toolbar
- GitHub Actions CI (runs the test suite on every push)
- `npm run backup` - free local database backup script

### Changed
- Mobile header hides on scroll down, reappears on scroll up (and never hides while the AI panel is open)
- Dashboard orders data: cached for 30 seconds + in-flight request guard; the refresh button forces a fresh fetch
- Sales Analytics layout: calendar card now fills the column height (removed blank space below it)
- Sidebar navigation: added Audit Log entry; removed duplicate Log out button
- Test suite grew from 9 to 39 tests (auth, orders, stock, void, waste, offline dedupe, security hardening)

### Performance
- gzip compression on all responses (Render serves them compressed)
- MongoDB indexes: `Order.date`, `AuditLog { action, date: -1 }`, `Product.stock`
- Path-dispatched request body limits: 100 KB default, 10 MB for product images; oversized bodies rejected with 413
- Cache-busting `?v=` query params bumped v35 -> v40 so every browser picks up the new JS/CSS

### Security
- `JWT_SECRET` is now **required in production** — the server refuses to boot without it (fail-fast), preventing a weak built-in fallback
- CORS is **closed by default** (no cross-origin access unless `CORS_ORIGIN` is set)
- Login timing equalizer: unknown usernames get the same bcrypt hashing cost as real ones (no "user exists" timing leak)
- Password minimum length 8 enforced on change, create, and reset
- AI report endpoint rate-limited (5 requests / min / IP)
- Production seed admin gets a **random password** instead of a known default (printed to logs on first boot)
- XSS escaping sweep: session user-agents and AI report text are HTML-escaped before rendering

## [v1.1.0] - 2026-08-13

### Added
- Orders & Revenue bar chart in Sales Analytics (revenue bars + order count line, Day/Week/Month/All tabs)
- Deploy readiness: `render.yaml` blueprint, `backend/.env.example`, `DEPLOYING.md`

## [v1.0.0] - 2026-08-12

### Added
- POS system for Season 3 Cafe: login, cashier page, admin panel (dashboard, sales analytics, menu, users, inventory, waste)
- PWA offline order queue (service worker + idempotent sync via clientOrderId)
- Backend API tests (9 Jest tests against in-memory MongoDB)
- Same-origin API base fix for HTTPS deploys

### Security
- Initial admin seeding with seeded default account (rotate password on first login)
- Leaked Atlas credentials from early history: user notified; production uses a private serverless Atlas cluster

## Deployment History

- Live on Render: https://season3-pos.onrender.com (branch `ulan`, auto-deploy via GitHub)
- MongoDB Atlas serverless cluster (private credentials, network access 0.0.0.0/0)
- Releases: v1.0.0, v1.1.0, v1.2.0 (shipped across commits `e71a9b7`, `d2f0c23`, `90f56fc`), v1.3.0 (correctness batch: timezone, delete guard, bounded fetches, password reset tool)