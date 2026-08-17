# Season 3 POS — Local Café Server Setup (brownout-proof)

Run the whole POS on a laptop inside the café: no internet needed. Render
stays as a remote mirror for viewing sales from anywhere.

**Run the parts in order.** Part A rehearses the entire flow on your own PC
first — if anything breaks, it breaks on the practice machine. Part B is the
real deployment on the café laptop. The commands are identical.

---

# PART A — Dry run on your PC (practice)

### A1. Check what you already have

```
node --version
Get-Service -Name "MongoDB*"
```

- Node must be installed (any recent version). If missing, install Node LTS
  from nodejs.org.
- You need a MongoDB **Windows service**. If you see one (even "Stopped"),
  you're fine — this PC already has one. If not, install MongoDB Community
  (MSI) and pick **"Install MongoDB as a Service"** — it auto-starts on boot.

### A2. Start MongoDB

Open a terminal **as Administrator** (right-click → "Run as administrator")
and run:

```
net start MongoDB
```

You can close that terminal afterwards — everything else runs in a normal one.

### A3. Migrate the current data into the local database

This is the "move" step: copy everything from the cloud database into the
local one.

```
cd backend
npm run backup
```

Note the new folder it prints: `backend/backup/<date>/`. Then restore it into
the local MongoDB:

```
npm run restore -- backend\backup\<date>
```

Wait — `npm run restore` without a second argument restores into whatever
`MONGO_URI` says (currently the cloud). For the dry run you want the **local**
database explicitly:

```
npm run restore -- backend\backup\<date> mongodb://127.0.0.1:27017/pos_season3cafe
```

This copies users (admin keeps its current password), menu items, orders,
inventory and waste into the local database.

### A4. Switch this PC to "laptop mode"

Edit `backend/.env` (Notepad is fine):

```
MONGO_URI=mongodb://127.0.0.1:27017/pos_season3cafe
LOCAL_MONGO_URI=mongodb://127.0.0.1:27017/pos_season3cafe
ATLAS_MONGO_URI=<the cloud URI that was in MONGO_URI>
JWT_SECRET=<unchanged — keep the one already there>
CORS_ORIGIN=*
PORT=3000
```

- `MONGO_URI` is now the **local** database — the app, backup and restore all
  use it.
- `ATLAS_MONGO_URI` is the cloud URI used only by `npm run mirror`.
- First save the old cloud URI to a side file for easy revert:
  copy the current `.env` to `backend/.env.atlas-backup` **before** editing.
  `.env*` is gitignored, so it never gets committed.

### A5. Start the server and check it

```
start-pos.bat
```

Then in a browser:
- `http://localhost:3000/api/health` → `{"ok":true,"mongo":"connected"}`
- `http://localhost:3000` → log in as `admin` / `admin123456`
  (the users were migrated, so the password is unchanged)

**Your PC is now behaving exactly like the café laptop will.** The Render
live site is untouched — it has its own environment.

### A6. Smoke test

1. In the Admin app, create a scratch product, e.g. "zzz-dryrun"
2. Place an order for it in the Cashier app
3. Confirm it exists in the local database:
   ```
   npm run backup
   ```
   ...and the new backup folder contains the scratch product.

### A7. Test the mirror to Render

```
npm run mirror
```

It prints every collection copied, e.g. `✓ products: 21 documents`. Now open
the live site (https://season3-pos.onrender.com) as admin — the scratch
product is there. Render is now a **remote read-only mirror** of this PC.

Clean up: delete the scratch product and its order in the local app, then
run `npm run mirror` again — the live site matches the local data again.

### A8. Decide the ending

- **Stay in laptop mode** — this PC keeps working exactly like the café
  laptop will (backup/restore/mirror all local-first). Good for more testing.
- **Revert to cloud-first** — restore the old file:
  ```
  copy /Y backend\.env.atlas-backup backend\.env
  ```
  and restart `start-pos.bat`.

The dry run is complete. Everything that follows happens on the café laptop.

---

# PART B — Real deployment on the café laptop

### B1. Install MongoDB + Node (one-time)

1. **MongoDB Community Server** (Windows MSI)
   - Choose **"Install MongoDB as a Service"** — it auto-starts on boot
2. **Node.js LTS** (nodejs.org — accept defaults)

### B2. Copy the project

Copy the project folder to the laptop (e.g. clone the repo and check out the
`ulan` branch), then in a terminal in `backend/`:

```
npm install
```

### B3. Create `backend/.env`

```
MONGO_URI=mongodb://127.0.0.1:27017/pos_season3cafe
LOCAL_MONGO_URI=mongodb://127.0.0.1:27017/pos_season3cafe
ATLAS_MONGO_URI=<your cloud connection string from Render/Atlas>
JWT_SECRET=<any long random string — make one up>
CORS_ORIGIN=*
PORT=3000
```

Never commit this file.

### B4. Migrate the current data (one-time)

On the PC (still in cloud mode or laptop mode — either way `npm run backup`
writes a JSON folder):

```
cd backend
npm run backup
```

Copy the newest folder under `backend/backup/` to the laptop (USB stick),
then on the laptop:

```
npm run restore -- <path-to-backup-folder>
```

This copies users (admin keeps its current password), menu items, orders,
inventory and waste into the laptop's local database.

### B5. Run the backend as a Windows service (NSSM)

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

### B6. Devices connect over wifi

1. Give the laptop a **static IP** (or DHCP reservation in the router)
2. Each cashier/admin device opens: `http://<laptop-IP>:3000`
3. Bookmark/pin it. No internet is required — wifi-only LAN works.

### B7. Daily backups + Render mirror (Task Scheduler)

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

### B8. Brownout drill

- Laptop runs on its own battery — it keeps working through a power outage
- If the wifi router dies too: turn on the laptop's **Mobile hotspot**
  (Settings → Network & Internet → Mobile hotspot) and have devices connect
  to it — the POS keeps selling with zero internet
- The cashier app's offline queue still covers a device that drops wifi

---

## Troubleshooting

- `server.js` won't start → check `logs/pos.err.log`; confirm MongoDB
  service is running (Services → "MongoDB Server")
- Devices can't reach the laptop → firewall: allow Node.js on private
  networks, confirm the laptop's IP with `ipconfig`
- Mirror says "same database" → LOCAL and ATLAS URIs must be different
- `net start MongoDB` fails → you weren't in an **Administrator** terminal
- Restore went into the wrong database → you passed no URI and `MONGO_URI`
  wasn't the local one; pass the URI explicitly:
  `npm run restore -- <folder> mongodb://127.0.0.1:27017/pos_season3cafe`