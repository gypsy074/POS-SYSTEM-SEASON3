# Season 3 POS — Local Café Server Setup (brownout-proof)

Run the whole POS on a laptop inside the café: no internet needed. Render
stays as a remote mirror for viewing sales from anywhere.

## 1. Install on the laptop (one-time)

1. **MongoDB Community Server** (Windows MSI)
   - Choose "Install MongoDB as a Service" — it auto-starts on boot
2. **Node.js LTS** (nodejs.org — accept defaults)
3. Copy the project folder to the laptop (e.g. clone the repo and check out
   the `ulan` branch), then in a terminal in `backend/`:
   ```
   npm install
   ```
4. Create `backend/.env`:
   ```
   MONGO_URI=mongodb://127.0.0.1:27017/pos_season3cafe
   LOCAL_MONGO_URI=mongodb://127.0.0.1:27017/pos_season3cafe
   ATLAS_MONGO_URI=<your cloud connection string from Render/Atlas>
   JWT_SECRET=<any long random string — make one up>
   CORS_ORIGIN=*
   PORT=3000
   ```
   Never commit this file.

## 2. Migrate the current data (one-time)

On today's machine:
```
cd backend
npm run backup
```
Copy the newest folder under `backend/backup/` to the laptop, then on the
laptop:
```
npm run restore -- <path-to-backup-folder>
```
This copies users (admin keeps its current password), menu items, orders,
inventory and waste into the laptop's local database.

## 3. Run the backend as a Windows service (NSSM)

1. Download NSSM (nssm.cc) and put `nssm.exe` in `backend/` (or in PATH)
2. From an **Administrator** terminal:
   ```
   nssm install Season3POS "C:\Program Files\nodejs\node.exe" "D:\pos\backend\server.js"
   nssm set Season3POS AppDirectory D:\pos\backend
   nssm set Season3POS AppStdout D:\pos\backend\logs\pos.out.log
   nssm set Season3POS AppStderr D:\pos\backend\logs\pos.err.log
   nssm start Season3POS
   ```
   (Adjust `D:\pos` to wherever the project lives. Create the `logs` folder.)
3. Check it: `http://localhost:3000/api/health` → `{"ok":true,...}`

## 4. Devices connect over wifi

1. Give the laptop a **static IP** (or DHCP reservation in the router)
2. Each cashier/admin device opens: `http://<laptop-IP>:3000`
3. Bookmark/pin it. No internet is required — wifi-only LAN works.

## 5. Daily backups + Render mirror (Task Scheduler)

Create two scheduled tasks (run as the logged-in user, "At startup" and
daily at e.g. 02:00):

| Task | Action |
|------|--------|
| Local backup | `cmd /c cd /d D:\pos\backend && npm run backup` |
| Mirror to Render | `cmd /c cd /d D:\pos\backend && npm run mirror` |

- The local backup lands in `backend/backup/<date>/` (put that folder under
  OneDrive/Google Drive for an off-site copy)
- `npm run mirror` pushes the laptop data into Atlas — Render then shows it
- Restore a backup anytime: `npm run restore -- backend/backup/<date>`

## 6. Brownout drill

- Laptop runs on its own battery — it keeps working through a power outage
- If the wifi router dies too: turn on the laptop's **Mobile hotspot**
  (Settings → Network & Internet → Mobile hotspot) and have devices connect
  to it — the POS keeps selling with zero internet
- The cashier app's offline queue still covers a device that drops wifi

## Troubleshooting

- `server.js` won't start → check `logs/pos.err.log`; confirm MongoDB
  service is running (Services → "MongoDB Server")
- Devices can't reach the laptop → firewall: allow Node.js on private
  networks, confirm the laptop's IP with `ipconfig`
- Mirror says "same database" → LOCAL and ATLAS URIs must be different
