# Season 3 POS — System Workflow

> These diagrams are Mermaid — they render as images on GitHub, in VS Code
> (extension: *Markdown Preview Mermaid Support*), and on mermaid.live
> (paste the code, download PNG).

## 1. System architecture

```mermaid
flowchart TB
    subgraph devices["CAFÉ FLOOR — devices (any browser)"]
        cashier["Cashier App — /CASHIER/pos.html<br/>menu grid · cart · pay · void · waste · offline queue"]
        admin["Admin App — /ADMIN/admin.html<br/>dashboard · menu · inventory · users · audit · insights"]
    end

    subgraph backend["BACKEND — Node.js + Express (backend/server.js)"]
        api["REST API /api/*<br/>auth · orders · waste · products · inventory<br/>dashboard · insights · audit · users · account"]
        static["Serves the frontend statically"]
    end

    subgraph cloud["CLOUD MODE — Render + Atlas"]
        render["Render service — season3-pos.onrender.com"]
        atlas[("MongoDB Atlas — pos_season3cafe")]
    end

    subgraph laptop["LAPTOP MODE — café server (brownout-proof)"]
        local[("MongoDB local — 127.0.0.1:27017")]
        nssm["NSSM service — Season3POS<br/>auto-starts on boot"]
    end

    cashier --> api
    admin --> api
    static -. serves .-> cashier
    static -. serves .-> admin
    api --> atlas
    api --> local
    nssm --> local
    render --> atlas

    backup["backup.js — dump → backend/backup/&lt;date&gt;/*.json"]
    restore["restore.js — replay JSON → any MongoDB"]
    mirror["mirror.js — local → Atlas (one command)"]
    backup -. dumps .-> atlas
    backup -. dumps .-> local
    restore -. replays .-> local
    mirror -. pushes .-> atlas

    keepalive["GitHub keep-alive workflow — pings /api/health every 5 min"] -. pings .-> render
```

## 2. Order lifecycle (ingredient ledger)

```mermaid
flowchart LR
    A["Cashier picks items"] --> B["POST /api/orders"]
    B --> C{"Linked ingredients<br/>enough stock?"}
    C -- "NO" --> D["409 Shortage blocked<br/>'name (needs productName)'"]
    C -- "YES" --> E["Order saved<br/>ingredient stock −= unitsPerSale × qty"]
    E --> F["Audit log entry"]
    E --> G["Dashboard / insights update"]
    H["Void order"] --> I["Ingredient stock restored<br/>+ unitsPerSale × qty"]
    I --> F
    J["Manual stock edit / restock"] -. "never propagates (independent ledgers)" .-> E
```

## 3. Offline flow (per device)

```mermaid
flowchart TD
    A["Device opens app"] --> B{"Online?"}
    B -- "YES" --> C["Normal operation"]
    B -- "NO" --> D["Service worker + cached menu<br/>PRODUCTS_CACHE_KEY"]
    D --> E["Sell / log waste normally"]
    E --> F["Queue in localStorage<br/>posOfflineOrders / posOfflineWaste"]
    F --> G{"Retry every 30 s<br/>or Sync-now button"}
    G -- "still unreachable" --> F
    G -- "success" --> H["Queue flushed → server applies<br/>same stock + shortage rules"]
```

## 4. Database schema (MongoDB — 7 collections)

```mermaid
erDiagram
    PRODUCTS ||--o{ ORDERS : "sold in"
    PRODUCTS ||--o{ INVENTORYITEMS : "linked supply"
    PRODUCTS ||--o{ WASTEITEMS : "wasted as"
    USERS ||--o{ ORDERS : "cashier"
    USERS ||--o{ WASTEITEMS : "logged by"
    USERS ||--o{ SESSIONS : "holds"
    USERS ||--o{ AUDITLOGS : "acted by"

    PRODUCTS {
        ObjectId _id PK
        string name
        number price
        string category
        number stock
        string status
        string image
    }
    INVENTORYITEMS {
        ObjectId _id PK
        ObjectId productId FK
        string name
        number unitsPerSale
        number stock
        number threshold
    }
    ORDERS {
        ObjectId _id PK
        array items
        number qty
        string cashier
        number total
        date createdAt
    }
    WASTEITEMS {
        ObjectId _id PK
        string item
        number qty
        string reason
        string cashier
        date createdAt
    }
    USERS {
        ObjectId _id PK
        string username
        string passwordHash
        string role
    }
    SESSIONS {
        ObjectId _id PK
        ObjectId userId FK
        string token
        date expiresAt
    }
    AUDITLOGS {
        ObjectId _id PK
        string action
        string user
        string target
        date createdAt
    }
```

## 5. Deployment

```mermaid
flowchart LR
    subgraph cloud_deploy["CLOUD"]
        A["git push origin ulan"] --> B["POST Render deploy hook"]
        B --> C["Render rebuilds + restarts season3-pos"]
        C --> D["Live site + Atlas DB"]
    end

    subgraph laptop_deploy["CÁFÉ LAPTOP"]
        E["Copy project → npm install"] --> F["backend/.env (local URIs + ATLAS_MONGO_URI)"]
        F --> G["npm run restore -- &lt;backup folder&gt;"]
        G --> H["NSSM install Season3POS → service"]
        H --> I["Devices open http://&lt;laptop-IP&gt;:3000"]
        I --> J["Scheduled daily: npm run backup + npm run mirror"]
        J -. mirrors .-> D
    end
```