# Season 3 POS System

A web-based Point-of-Sale system for Season 3 Cafe: menu management, cashier ordering with offline support, inventory tracking, food waste logging, sales analytics, AI insights, and audit logging.

- **Live site:** https://season3-pos.onrender.com
- **Stack:** Node.js + Express 5 + MongoDB Atlas (Mongoose 9) | Vanilla JS admin panel + cashier PWA | Chart.js

## Features

- **Login & roles** - Admin and Cashier accounts (JWT auth, bcrypt-hashed passwords, per-device sessions)
- **Cashier page** - touch-friendly ordering, payment/change calculator, receipts, order history, live notifications, barcode-style search, waste logging
- **Offline mode** - service worker caches the cashier app; orders placed offline are queued and auto-synced (idempotent via `clientOrderId`)
- **Admin panel** - dashboard (revenue, performance, live transactions with search), sales analytics (line/radar/usage charts, calendar, CSV export), AI insights (forecast, restock, anomalies, AI business report), menu, users, inventory, waste, audit log
- **Account & sessions** - see every device logged in, kill sessions, revoke others, change password, new-sign-in alerts
- **Audit logging** - logins/logouts, password changes, session revokes, order voids/deletes, and user + waste actions are recorded with actor + detail
- **Security** - rate-limited login, helmet headers, CORS closed by default, required `JWT_SECRET`, request size limits, timing-equalized login, XSS-escaped output
- **Performance** - gzip responses, MongoDB indexes, 30-second dashboard cache, in-flight request guards

## Architecture (one Node process serves everything)

```
 Browser
   |
   |-- /login.html ............ login.js (JWT stored in localStorage)
   |
   |-- /CASHIER/pos.html ...... pos.js + service worker (offline queue)
   |                          sw.js (caches app shell, bypasses /api)
   |
   |-- /ADMIN/admin.html ...... admin.js + per-page modules in ADMIN/js/
   |                          (dashboard, insights, menu, users, inventory,
   |                           waste, audit, account, header, sidebar, ...)
   |
   \--> Express API (/api/...) -- server.js (auth, roles, rate limits)
             |
             \--> MongoDB Atlas (Mongoose: users, products, orders,
                                 inventory, waste, auditlogs)
```

Every page is plain HTML/CSS/JS — no build step, no framework. The Express backend
serves the static files and the JSON API from one process.

## Local Setup

1. Create `backend/.env` from `backend/.env.example` (`MONGO_URI` + `JWT_SECRET` are required; the server refuses to boot in production without `JWT_SECRET`)
2. `cd backend && npm install`
3. `npm start` - server runs at http://localhost:3000
4. Admin page: http://localhost:3000/ADMIN - Cashier page: http://localhost:3000/CASHIER

A default admin is seeded on first boot. Locally you can set
`SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`; in production the password is
**random** and printed in the logs — check Render → Logs on first boot.

## Tests

```
cd backend && npm test
```

43 Jest tests against an in-memory MongoDB (no external DB or API keys needed).

## Deployment

Deployed on Render via blueprint (`render.yaml`) from the `ulan` branch. Auto-deploy
is enabled on the service; a manual API hook also exists as a fallback. See
**DEPLOYING.md** for the full operations guide.

## Keep-Awake & Monitoring (free)

The free Render tier sleeps after ~15 minutes idle (cold start ~40s). Fix it with a
free cron job that pings the health endpoint every 5 minutes — this keeps the app
warm **and** emails you on failure:

1. Sign up at https://cron-job.org (free plan)
2. Create a cron job: URL `https://season3-pos.onrender.com/api/health`, GET, every 5 min
3. Add your email as alert contact, enable it

## Backups (free)

```
cd backend && npm run backup
```

Dumps all collections to `backend/backup/<timestamp>/` as JSON. Schedule it daily
with Windows Task Scheduler (see DEPLOYING.md section 8).

---

# Code Map — what every function does

A plain-language reference for every meaningful function in the codebase,
organized by file. "What does X do?" → find the file, read the row.

**Legend:** `auth: *` = any logged-in user, `auth: Admin` = admin only,
`limit:` = rate limit on that route.

## Backend — `backend/server.js`

### Helper functions (non-route)

| Function | What it does |
|---|---|
| `isValidObjectId(id)` | Rejects malformed MongoDB ids before they hit a query (prevents cast errors / 500s) |
| `isBcryptHash(value)` | Detects if a stored value is already a bcrypt hash (users are stored hashed) |
| `normalizePaymentMethod(value)` | Accepts `cash`/`card`/`gcash` (and legacy `cashier`/`e-wallet`) → returns the canonical value |
| `normalizeWastePayload(input)` | Cleans + validates the waste-log payload (reason required, counts clamped) |
| `normalizeOrderPayload(input)` | Validates an incoming order: items array, payment method, cash received; returns a safe shape or `null` |
| `sanitizeUser(user)` | Strips password/hash fields before a user object is sent to the client |
| `writeLog(action, actor, targetId, detail)` | Writes one audit-log entry for every meaningful action (order, user, waste, menu) |
| `touchUserActivity(userId)` | Updates the user's `lastActiveAt` so the sessions page shows real activity times |
| `signToken(user)` | Creates the JWT for a login (contains user id, role, and a unique session id `jti`) |
| `jwtExpiresAt()` | Calculates the session expiry (default 8h, `JWT_EXPIRES_IN` overrides) |
| `authRequired(roles)` | Middleware factory: rejects unauthenticated requests, optionally restricted to specific roles (e.g. `authRequired(['Admin'])`); also blocks tokens whose session was revoked |
| `cleanupLegacyOrderFields()` | One-time migration: normalizes old payment-method values in existing orders |
| `cleanupLegacyProductStock()` | One-time migration: backfills stock fields on legacy products |
| `getInsights()` | Aggregates orders/products/inventory/waste from MongoDB into the AI Insights payload (cached 5 min) |
| `seedDefaultAdmin()` | Creates the first admin account if no users exist (random password in production) |
| `checkRenderStatus()` | Verifies the environment on boot: exits the process if `JWT_SECRET`/`MONGO_URI` are missing (fail-fast) |

### API routes

| Method & path | Access | What it does |
|---|---|---|
| `GET /` | public | Redirects to `/login.html` |
| `GET /CASHIER` `/ADMIN` | public | Redirects to the POS / admin page |
| `POST /api/login` | limit: 10/15min/IP | Checks credentials, creates a session, returns JWT + user. Unknown usernames get a dummy bcrypt hash so timing doesn't leak |
| `GET /api/auth/me` | auth: * | Returns the current user (used on page load to restore the session) |
| `POST /api/logout` | auth: * | Revokes the current session token |
| `GET /api/auth/sessions` | auth: * | Lists every active login for the user (device, time, current one) |
| `POST /api/auth/sessions/revoke-others` | auth: * | Kills all sessions except the current one |
| `DELETE /api/auth/sessions/:jti` | auth: * | Kills one specific session (used by the "kill device" button) |
| `PUT /api/auth/password` | auth: * | Changes the password (checks current password first, enforces min 8 chars) |
| `GET /api/health` | public | Returns `{"ok":true,"mongo":"connected"}` — used by the keep-awake pinger |
| `GET /api/orders` | auth: * | Returns orders (all for Admin, own for Cashier), optionally bounded by `?days=` (1–365) and `?limit=` (1–5000) so page loads stay fast as history grows |
| `POST /api/orders` | auth: * | Places an order: deducts stock, records audit; rejects if stock runs out (409). Dedupes retries via `clientOrderId` |
| `DELETE /api/orders/:id` | auth: Admin | Deletes an order — **voided orders only** (409 otherwise: deleting a paid order would silently rewrite past revenue/charts) |
| `PATCH /api/orders/:id/void` | auth: * | Voids an order: restores stock, excludes it from revenue |
| `GET /api/products` | auth: * | Returns the menu (public-ish list used by the cashier) |
| `GET /api/products/categories` | auth: * | Distinct category list for the filter pills |
| `POST/PUT/DELETE /api/products(/:id)` | auth: Admin | Create / update / delete menu items (image uploads allowed up to 10 MB) |
| `GET/POST/PUT/DELETE /api/users(/:id)` | auth: Admin | Manage user accounts (create / edit / delete) |
| `GET/POST/PUT/DELETE /api/inventory(/:id)` | auth: Admin | Manage the inventory list |
| `GET /api/waste` `POST /api/waste` | auth: * | Read / log food waste (cashiers log waste at end of day) |
| `DELETE /api/waste/:id` | auth: Admin | Delete a waste entry |
| `GET /api/audit` | auth: Admin | Returns the audit log, filterable by action + date |
| `GET /api/insights` | auth: Admin | Returns the AI Insights payload (forecast, restock, anomalies, waste) |
| `POST /api/ai/report` | auth: Admin, limit: 5/min/IP | Generates the AI business report (or a stats fallback when no API key) |

## Backend — `backend/ai-report.js`

| Function | What it does |
|---|---|
| `currency(n)` | Formats a number as `₱` peso text for the report prompt |
| `aiProvider()` / `aiModel(provider)` / `aiKey(provider)` | Resolve the configured provider (`gemini` default, `groq`), model, and API key from env vars |
| `buildAiRequest(provider, prompt)` | Builds the provider-specific request body (Gemini vs Groq differ in shape) |
| `buildReportPrompt(insights)` | Turns the insights data into a text prompt: "You are a business analyst for a canteen…" |
| `buildStatsReport(insights)` | Generates the plain statistics summary used when no AI key is configured |
| `fetchAiReport(prompt)` | Calls the AI provider with a 20-second timeout and returns the text |

## Backend — `backend/ai-insights.js`

| Function | What it does |
|---|---|
| `startOfDay(d)` / `dayKey(d)` | Date helpers that group orders by calendar day (server runs on `Asia/Manila` time — set at the top of server.js — so "today" matches what the dashboard shows) |
| `isCompleted(order)` | True when an order is paid and not voided (the only ones counted) |
| `mean(values)` / `stddev(values)` | Statistics helpers used by the anomaly detection |
| `round1(n)` / `round2(n)` | Round to 1 / 2 decimals for pesos |
| `forecastRevenue(dailyTotals, targetDayIndex)` | Projects the next day's revenue from the last 7 days' totals |
| `forecastTopItems(soldByItem, daysWithSales)` | Estimates what will sell best tomorrow |
| `computeRestock(...)` | Flags products whose stock will run out soon (uses sales + waste + inventory) |
| `computeWasteInsights(...)` | Finds the most wasted products and average daily waste value |
| `computeAnomalies(orders, products)` | Flags unusually high/low revenue days (more than 1.5 stddevs from the mean) |
| `computeInsights({...})` | Orchestrator: combines all of the above into the `/api/insights` payload |

---

## Admin panel — shared modules (`frontend/ADMIN/js/`)

### `admin.js` (bootstrap)

| Function | What it does |
|---|---|
| `guardAdminPage()` | On load: checks the saved token, calls `/api/auth/me`; redirects to login if invalid; also shows the new-sign-in alert and wires up all per-page setups |
| `openProfileDropdown()` / `closeProfileDropdown()` | Opens/closes the avatar menu with a close animation |
| `setupProfileBadge()` | Fills the header avatar with the logged-in user's initials |

### `api.js` (shared API helper — used by every admin module)

| Function | What it does |
|---|---|
| `getApiBaseUrl()` | Returns the API origin — same-origin on the live site, `http://localhost:3000` when opened from `file://` locally |
| `getAuthToken()` / `clearSession()` / `redirectToLogin()` | Read the JWT from localStorage / wipe it / bounce to the login page on 401 |
| `apiFetch(path, options)` | The single fetch wrapper: attaches `Authorization: Bearer <token>` and `Content-Type`, and on 401 clears the session and redirects |
| `escapeHtml(value)` | The central XSS guard — converts `<`, `>`, `&`, `"`, `'` into safe text before any user data is rendered |

### `toast.js`

| Function | What it does |
|---|---|
| `showToast(message, type)` | Shows the green/red toast popup ("Saved!" etc.), auto-dismisses after 2.5s |
| `getToastContainer()` | Creates/returns the toast container element (used by `showToast`) |
| `dismiss(toast, immediate)` | Removes a toast, with or without the slide-out animation |
| `escapeToast(value)` | Escapes toast text so a crafted message can't run HTML |

### `confirm.js`

| Function | What it does |
|---|---|
| `showConfirmModal({title, body, confirmLabel, ...})` | The styled "Are you sure?" dialog used for destructive actions (void order, delete user, kill session). Returns a promise that resolves `true`/`false` |

### `header.js`

| Function | What it does |
|---|---|
| `setupHeaderActions()` | Wires the header buttons (profile, notifications, search, refresh) |
| `openNotificationDropdown()` / `closeNotificationDropdown()` | Open/close the notifications panel with a close animation |
| `setupGlobalSearch()` | Debounced header search that filters the current page's table |
| `updateHeaderCenter()` / `setupHeaderCenter()` | Shows the page title + live date/time in the header center |
| `refreshCurrentPanel()` | The refresh button: forces a fresh dashboard fetch (bypasses the 30s cache) and refreshes the current page's table |
| `setupDarkModeToggle()` | Saves the dark-mode choice in localStorage and applies it |
| `setupScrollHeader()` | Hides the header on scroll down / shows on scroll up (except while the AI panel is open) |
| `setupServerStatus()` | Polls `/api/health` and shows a live "server" dot in the header |

### `sidebar.js`

| Function | What it does |
|---|---|
| `setupSidebarNavigation()` | Makes the sidebar links switch panels without a full page reload |

### `imageCompressor.js`

| Function | What it does |
|---|---|
| `compressImage(file, maxPx, quality)` | Downsizes menu photos in the browser (600px, 30% quality) before upload — keeps product uploads under the 10 MB limit and makes pages load fast |

---

## Admin panel — page modules

### `dashboard.js`

| Function | What it does |
|---|---|
| `loadLiveDashboardData(force)` | The dashboard's data engine: fetches the last 90 days of orders (bounded, max 5000) once, then reuses the **30s cache**; if `force` is true (refresh button) it always fetches; an in-flight guard prevents duplicate requests |
| `loadActivityFeed()` | Fetches the recent orders for the "Updates" panel |
| `timeAgo(ts)` | Formats timestamps as "5m ago / 2h ago / 3d ago" |
| `buildUpdates()` / `renderUpdates()` | Computes and renders the live-update list (new orders, voids, low stock) |
| `setupUpdateSectionExpand()` | Makes the Updates panel collapse/expand with animation |
| `openUpdatesSection(header)` / `closeUpdatesSection()` / `closeUpdatesSectionOnEsc(e)` | Update-panel open/close + Esc-to-close |
| `buildNotificationItems()` / `renderNotifications()` | Turn raw events into notification rows (low stock, new items, new orders) |
| `renderDailySnapshot()` | The top stat cards: today's revenue, order count, items sold, waste value |
| `exportSalesCsv()` | Downloads the filtered transactions as a CSV (filename uses Philippine-local date, not UTC); cells starting with `=`/`+`/`-`/`@` are prefixed with `'` so Excel can't run formulas from the data |
| `loadWasteData()` / `updateWasteStat()` / `renderWasteTable()` / `removeWasteEntry(entryId)` | The waste panel: fetch, stat card, table, delete-with-confirm |
| `renderTransactionTable(orders)` | Renders the Recent Transactions table: searches by customer/receipt/items, caps at **100 rows**, shows "Showing X of Y", and an empty state when nothing matches |
| `setupTransactionSearch()` | Wires the search box with a 150ms debounce; searching re-renders from the warm cache (no server call) |
| `getChartTheme()` | Returns Chart.js colors that match light/dark mode |
| `renderSalesCharts(orders, products, range)` | Builds the Orders & Revenue bar chart (revenue bars + order-count line, Day/Week/Month/All) |
| `renderUsageChart(orders, range)` | The radar chart of which items/categories are used most |
| `setupCategoryPills()` / `setupSalesFilterTabs()` | Menu-filter pills and the Day/Week/Month/All tabs |
| `setupCalendarControls()` / `renderCalendar()` | The mini calendar: navigates by month, highlights days with sales, click a day to filter |

### `insights.js`

| Function | What it does |
|---|---|
| `aiPeso(value)` / `aiEmpty(text)` | Format helpers (peso strings / "—" for empty values) |
| `renderForecastCard(data)` / `renderRestockCard(items)` / `renderWasteCard(data)` / `renderAnomaliesCard(items)` | Render each AI insight card (tomorrow's forecast, restock list, waste stats, anomaly flags) |
| `renderInsights(data)` | Orchestrates rendering all four cards |
| `renderAiReportCard()` / `fillAiReportCard(report)` | The AI report card: shows the "Generate" button state, then fills it with the report text (HTML-escaped) |
| `generateAiReport()` | Calls `POST /api/ai/report` with a spinner, rate-limit error handling, and the result render |
| `updateAiPillCount(data)` | Puts the anomaly/alert count on the sidebar "Insights" pill |
| `loadInsights()` | Fetches `/api/insights` and renders everything |
| `aiTapGuarded()` | The **ghost-tap guard**: ignores taps for 1.5s after a tap so a double-tap never fires two AI requests |
| `setAiPanelOpen(open)` / `setupAiHeaderPanel()` | The collapsible AI panel in the header: tracks open state (so the mobile header stays visible) and wires the toggle |

### `account.js`

| Function | What it does |
|---|---|
| `fmtTime(d)` | Formats a session's start time as "Aug 16, 8:45 AM" |
| `deviceLabel(ua)` / `deviceIcon(ua)` | Turn a browser User-Agent string into a friendly name + icon ("Chrome on Windows") |
| `relTime(d)` | "3 min ago / 2 days ago" formatting for session ages |
| `sessionAgeInfo(d)` | Returns the age text + a warning badge (new session = green "Just now") |
| `confirmDialog(title, message, confirmLabel)` | The modal used for kill-session / revoke-others confirmations |
| `api(path, options)` | Account-page fetch wrapper (same pattern as `api.js`) |
| `getAlertAudioContext()` / `alertTone(...)` / `playNewSignInAlert()` | Audio alert: plays a tone when a **new device** logs into your account |
| `evaluateBanner()` | Compares sessions: if a newer session exists than yours, shows the "New sign-in on another device" banner |
| `switchTab(tab)` / `openAccountModal(tab)` / `closeAccountModal()` | The account modal's Sessions/Password tabs + open/close with animation |
| `showMsg(text, isError)` | Inline error/success message inside the password form |
| `loadSessions()` / `renderSessions()` | Fetch and render the session list (device, time, age badge, "This device" marker, Kill button) |
| `killSession(jti, device)` | Confirms then calls `DELETE /api/auth/sessions/:jti` to log a device out |
| `revokeOthers()` | Confirms then calls the revoke-others endpoint (logs out every other device) |
| `changePassword()` | Validates new password (min 8) and calls `PUT /api/auth/password` |

### `menu.js`

| Function | What it does |
|---|---|
| `setupMenuTableSelection()` / `setupMenuActionButtons()` | Row-click selection + the Add/Edit/Delete button states |
| `setupImageUploadEngine()` | The image picker → compression preview flow for menu photos |
| `selectMenuRow(product)` | Fills the form from the clicked row |
| `updateMenuButtonStates(hasSelection)` | Enables/disables Edit/Delete based on selection |
| `renderImagePreview(imageData)` | Shows the chosen photo before saving |
| `clearMenuForm()` | Resets the form after save/delete |
| `getMenuPayload()` | Collects the form into a JSON payload (validating price/stock) |
| `addMenuItem()` / `updateMenuItem()` / `deleteMenuItem()` | Create / update / delete a menu item via the API |
| `loadLiveMenuData()` / `renderMenuTable(products)` | Fetch + render the menu table (image, name, category, price, stock, status) |

### `users.js`

| Function | What it does |
|---|---|
| `setupUserTableSelection()` / `setupUserActionButtons()` | Row selection + button states (same pattern as menu) |
| `selectUserRow(user)` / `clearUserForm()` | Fill / reset the user form |
| `getUserPayload(requirePassword)` | Collects the form (username, role, password when creating) |
| `addUser()` / `updateUser()` / `deleteUser()` | Create / edit / delete an account |
| `loadLiveUserData()` / `renderUserTable(users)` | Fetch + render accounts (name, role, last active, status) |

### `inventory.js`

| Function | What it does |
|---|---|
| `setupInventoryTableSelection()` / `setupInventoryActionButtons()` | Row selection + button states |
| `selectInventoryRow(item)` / `clearInventoryForm()` | Fill / reset the inventory form |
| `getInventoryPayload()` | Collects the form (item name, quantity, unit) |
| `addInventoryItem()` / `updateInventoryItem()` / `deleteInventoryItem()` | CRUD via API |
| `loadLiveInventoryData()` / `renderInventoryTable(items)` | Fetch + render the inventory table |

### `audit.js`

| Function | What it does |
|---|---|
| `loadAuditData()` | Fetches the audit log with the active action/date filters |
| `renderAuditTable()` | Renders the log table (time, actor, action, target, detail) |
| `exportAuditCsv()` | Downloads the filtered log as CSV (local-date filename) |
| `setupAuditFilters()` | Wires the action + date filter inputs (debounced) |

---

## Cashier page — `frontend/CASHIER/pos.js`

Key functions (the important 20 of ~70):

### Access & API
| Function | What it does |
|---|---|
| `getApiBaseUrl()` / `apiFetch(path, options)` | Same API pattern as the admin (`file://` local vs same-origin live), token + JSON wrapper |
| `guardCashierPage()` | On load: validates the cashier token, restores the cart and offline queue, wires everything |

### Offline ordering (the PWA part)
| Function | What it does |
|---|---|
| `getOfflineQueue()` / `saveOfflineQueue(queue)` | Read/write the pending-orders list in `localStorage` |
| `queueOfflineOrder(payload)` | Saves an order locally when offline |
| `flushOfflineOrders()` | On reconnect: re-sends every queued order; each carries a `clientOrderId` so retries never create duplicates (the server dedupes) |
| `getOfflineQueueCount()` / `updateOfflineBanner()` / `showSyncBanner(count)` | The "3 orders waiting" banner + the green "synced!" flash after flush |
| `setupOfflineSupport()` | Listens for online/offline events and runs the flush when the connection returns |

### Cart & ordering
| Function | What it does |
|---|---|
| `loadCashierMenu()` / `refreshCashierProducts()` | Fetch the menu; the second is the pull-to-refresh for new items |
| `addToCart(productId)` / `renderCart()` | Add an item (bumping qty if already in cart) and re-render the cart list + total |
| `changeQuantity(index, delta)` / `removeCartItem(index)` | +/- quantity and remove from cart |
| `setupSwipeSubmit()` | The signature **swipe-to-pay**: swiping right on the total area submits the order |
| `updateSwipeSummary()` / `updateCalculatorVisibility()` | The "Pay ₱X / Change ₱Y" summary + showing the calculator when cash is selected |
| `updateChangeCalculator()` / `calculateChangeBreakdown(amount)` / `calcPress(key)` / `setupQuickTenderChips()` / `resetChangeCalculator()` | The payment calculator: cash input, quick ₱20/₱50/₱100 chips, exact change breakdown, and the amount-keypad |
| `submitOrder()` | Validates the cart, sends the order (online: immediate; offline: queued), shows the receipt, clears the cart |
| `printReceipt(order)` | Opens the browser print dialog with a formatted receipt |
| `requestOrderVoid(orderId)` / `fetchVoidOrder(orderId, reason)` | The cashier's void flow: confirm dialog (with optional reason) → `PATCH /api/orders/:id/void` directly (no admin approval) → stock restored, order marked Voided |
| `showPosConfirm(...)` / `showPosAlert(...)` / `cancelOrder(silent)` | The POS-styled confirm/alert dialogs + clearing the cart with/without confirmation |
| `getCashierName()` | Reads the logged-in cashier's name for the receipt/audit trail |

### Waste logging & extras
| Function | What it does |
|---|---|
| `logWasteItems(items, reason)` | Logs leftover/unsold food at end of day (stock is not re-added; it is recorded as waste) |
| `buildWasteProductSearch()` / `openWasteDropdown()` / `renderWasteProductDropdown(searchTerm)` / `moveWasteHighlight(delta)` / `selectWasteProduct(productId)` | The searchable product picker inside the waste form |
| `syncCashierNotifications()` / `renderCashierNotificationPanel(...)` / `updateCashierNotificationBadge(count)` / `dismissSeenNotifications()` | The cashier's bell: low-stock and new-item alerts, with a badge count that remembers what you've seen |
| `loadCashierHistory()` / `renderCashierHistory()` / `showCashierOrderDetail(orderId)` | The "My Orders" tab: today's orders with a detail modal (and the void button) |
| `setHistoryPanelOpen(open)` | Opens/closes the order history panel |
| `setupCashierControls()` / `setupKeyboardShortcuts()` / `setupCashierProfile()` | Global wiring: buttons, keyboard shortcuts (Esc closes any dialog, Enter submits the order — guarded against modifier keys), profile menu |
| `generateOrderId()` / `renderOrderId()` | Creates the order id (`POS-xxxx`) shown on the order card + receipt |

## Cashier page — `frontend/CASHIER/sw.js` (service worker)

| Function | What it does |
|---|---|
| `isApiRequest(url)` | The service worker intercepts requests: it **bypasses `/api/`** (the API is never cached — always live), and caches the app shell (HTML/CSS/JS) so the POS loads offline |

---

## Login page — `frontend/login.js`

| Function | What it does |
|---|---|
| `getApiBaseUrl()` | Same-origin / localhost resolution (identical helper to the other pages) |
| `initDateBadge()` | Shows today's date on the login card |
| `showError(message)` / `clearError()` / `setLoading(isLoading)` | Error display + button spinner while logging in |
| `handleLogin(e)` | The submit handler: validates, calls `/api/login`, stores token + user in localStorage, then redirects |
| `redirectAfterLogin(role, username)` | Sends admins to `/ADMIN` and cashiers to `/CASHIER` |

## Shared — `frontend/js/passwordToggle.js` & `frontend/js/logoutTransition.js`

| Function | What it does |
|---|---|
| `init()` (passwordToggle) | Turns every password field into a show/hide field (eye icon) with a flash animation |
| `runAnim(el, cls)` / `runFlash(el)` | The toggle's little icon animations |
| `injectStyle()` / `escapeHtml(text)` (logoutTransition) | Injects the CSS and safely renders the "Goodbye" screen |
| *(cup-fill flow)* | On logout: a coffee cup fills with animation, then redirects — the friendly sign-off transition shared by admin and cashier pages |

---

# Workflows — how the pieces move

The functions above don't run alone; here is how the main flows actually work
end to end. (Details verified against the code.)

## 1. Login & session lifecycle

```
login form → POST /api/login (rate-limited 10/15min/IP)
  → bcrypt.compare (dummy hash for unknown usernames → same timing)
  → signToken() creates JWT with jti (unique session id)
  → Session row created in MongoDB (TTL index expires it after 8h, same as the token)
  → token + user saved in localStorage (posAdminToken/posAdminUser, or posToken/posUser)

every API call → apiFetch() attaches "Authorization: Bearer <token>"
  → authRequired() verifies the JWT AND looks up the Session row:
     revoked → 401 (killed sessions die instantly, even before expiry)

sessions page → GET /api/auth/sessions lists all rows
  → "Log out other devices" → revoke-others → all other Session rows revoked
  → "Kill" → DELETE /api/auth/sessions/:jti
logout → POST /api/logout → current row revoked → cup-fill transition → /login.html
```

New-sign-in alert: on page load, the account module compares all sessions;
any session newer than yours triggers a banner + an audio tone.

## 2. Order flow (online)

```
cashier taps items → cart → swipe to pay (or Enter)
  → submitOrder() → POST /api/orders
  → server: normalizeOrderPayload() validates items/payment
  → DEDUPE: if clientOrderId was already saved, the existing order is returned
            (unique index protects even two racing requests)
  → stock verified for every item first; any shortage → 409 (no partial order)
  → stock deducted ($inc -qty), sold-out items auto-flagged "Sold Out"
  → order saved → receipt modal → print dialog
  → dashboard shows it in Updates/Transactions; insights count it (if completed)
```

The order itself lives in the Orders collection (that is the record — order
placement does not write an audit-log row; only voids/deletes do). Fetches are
**bounded**: the admin dashboard pulls the last 90 days (`?days=90&limit=5000`),
the cashier history the last 7 days (`?days=7`) — the server refuses to grow
unbounded payloads as the canteen collects more orders.

## 3. Order flow (offline / PWA)

```
no connection → submitOrder() → queueOfflineOrder() (localStorage, key: posOfflineQueue)
  → banner: "N orders waiting to sync"
connection returns → setupOfflineSupport() fires → flushOfflineOrders()
  → every queued order POSTed with its clientOrderId
  → server dedupes retries → green "synced!" banner, queue cleared
```

## 4. Void flow

```
cashier → My Orders → Void (confirm dialog, optional reason)
  → fetchVoidOrder() → PATCH /api/orders/:id/void   (no admin approval — direct)
  → server: stock restored per item ($inc +qty), "Sold Out" flags cleared
  → status = "Voided", voidedBy/voidedAt/voidReason recorded
  → writeLog('order.void', ...) → audit log
  → excluded from revenue, charts, and insights (isCompleted() == false)
  → another void attempt → 409 "already voided"

admin hard-delete: only works on already-voided orders (409 otherwise) —
  deleting a paid order would silently rewrite past revenue, so the safe path
  is always: void first (keeps the row, excluded from stats), delete only if
  you truly want the row gone.
```

## 5. Menu & product flow

```
admin → Menu → Add/Edit (photo picked → compressImage() 600px/30% in the browser
  → 10MB upload limit) → POST/PUT /api/products → writeLog (menu actions)
  → cashier's next refresh (or new-item notification bell) picks it up
  → sold-out products are restored automatically by the void flow
```

## 6. Waste flow

```
cashier → Waste form → searchable product picker → logWasteItems(items, reason)
  → POST /api/waste (validated: reason required) → writeLog('waste.create')
  → feeds the dashboard waste stat/table and the AI restock + waste insights
  → admin can delete entries (audited)
```

## 7. AI insights flow

```
server: getInsights() aggregates orders/products/inventory/waste
  → cached 5 minutes (INSIGHTS_TTL_MS) so the dashboard never hammers the DB
  → ai-insights.js: forecastRevenue (last 7 days), computeRestock,
     computeWasteInsights, computeAnomalies (>1.5 stddev from mean)
  → Admin > Insights renders 4 cards

AI report: Generate → POST /api/ai/report (rate-limited 5/min/IP)
  → buildReportPrompt(insights) → provider call (Gemini default / Groq,
     20s timeout) → no API key? buildStatsReport() plain summary instead
  → result HTML-escaped before rendering (XSS guard)
  → ghost-tap guard ignores double-taps (1.5s) so one tap = one request
```

## 8. Audit flow

Every meaningful action calls `writeLog(action, actor, target, detail)`:
`user.login`, `user.logout`, `user.password`, `session.revoke`,
`order.void`, `order.delete`, `user.create/update/delete`, `waste.create`.
(Order placement itself is not audited — the Orders collection is the record.)
Admin → Audit Log filters by action + date and exports to CSV.

## 9. Ops flows

- **Keep-awake:** cron-job.org pings `/api/health` every 5 min → service never
  sleeps → instant first visit. Health returns `{"ok":true,"mongo":"connected"}`.
- **Backups:** `npm run backup` dumps all collections to
  `backend/backup/<timestamp>/` as JSON (schedule via Windows Task Scheduler).
- **Password recovery:** lost the production admin password? `npm run
  reset-admin-password -- <username> <new-password>` (resets it + revokes every
  active session) — see DEPLOYING.md section 8.
- **Release:** every change goes through the release workflow in DEPLOYING.md
  section 5 — test gate, `?v=` bump, push, deploy, verify.