# Changelog

All notable changes to the Season 3 POS System.

## [Unreleased]

### Added
- Audit Log page (Admin): date-filtered activity table with CSV export
- Dark mode toggle in the admin header (persisted per browser)
- Login rate limiting (10 attempts / 15 min per IP)
- Helmet security headers
- GitHub Actions CI (runs the test suite on every push)
- `npm run backup` - free local database backup script
- README.md with setup, deployment, and monitoring guide
- USAGE: removed the sidebar Log out button (profile menu has one)

### Changed
- Sales Analytics layout: calendar card now fills the column height (removed blank space below it)
- Sidebar navigation: added Audit Log entry; removed duplicate Log out button
- Admin header: added dark mode toggle

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