/* ==========================================================================
   backup.js — Free local database backup
   Dumps every collection to backend/backup/<timestamp>/ as JSON files.
   Usage: npm run backup
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

(async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error('❌ MONGO_URI not found in backend/.env — nothing to back up.');
        process.exit(1);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outDir = path.join(__dirname, '..', 'backup', timestamp);
    fs.mkdirSync(outDir, { recursive: true });

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();

        let totalDocs = 0;
        for (const { name } of collections) {
            const docs = await db.collection(name).find({}).toArray();
            fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(docs, null, 2), 'utf8');
            totalDocs += docs.length;
            console.log(`  ✓ ${name}: ${docs.length} documents`);
        }

        console.log(`\n✅ Backup complete → backend/backup/${timestamp}/ (${totalDocs} total documents)`);
    } catch (err) {
        console.error('❌ Backup failed:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
