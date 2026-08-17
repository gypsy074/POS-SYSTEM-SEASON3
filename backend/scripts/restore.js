/* ==========================================================================
   restore.js — Restores a backup folder (produced by backup.js) into a
   database. Each JSON file is read and its documents replace the matching
   collection (deleteMany + insertMany — indexes and other collections
   are untouched).

   Usage:  npm run restore -- <backup-folder> [mongo-uri]
   - backup-folder : the backend/backup/<timestamp>/ folder from backup.js
   - mongo-uri     : optional override — defaults to MONGO_URI in backend/.env
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

(async () => {
    const [folder, uriOverride] = process.argv.slice(2);
    if (!folder) {
        console.error('Usage: npm run restore -- <backup-folder> [mongo-uri]');
        process.exit(1);
    }
    if (!fs.existsSync(folder)) {
        console.error(`❌ Backup folder not found: ${folder}`);
        process.exit(1);
    }

    const uri = uriOverride || process.env.MONGO_URI;
    if (!uri) {
        console.error('❌ MONGO_URI not found in backend/.env and no URI was passed.');
        process.exit(1);
    }

    const files = fs.readdirSync(folder).filter(f => f.endsWith('.json'));
    if (!files.length) {
        console.error(`❌ No JSON files found in ${folder}`);
        process.exit(1);
    }

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
        const db = mongoose.connection.db;

        let totalDocs = 0;
        for (const file of files) {
            const collectionName = file.replace(/\.json$/, '');
            const docs = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
            if (!Array.isArray(docs)) {
                console.warn(`  ⚠ ${collectionName}: not a JSON array — skipped`);
                continue;
            }
            const collection = db.collection(collectionName);
            await collection.deleteMany({});
            if (docs.length) {
                await collection.insertMany(docs, { ordered: false });
            }
            totalDocs += docs.length;
            console.log(`  ✓ ${collectionName}: ${docs.length} documents`);
        }

        console.log(`\n✅ Restore complete → ${uri} (${totalDocs} total documents)`);
    } catch (err) {
        console.error('❌ Restore failed:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
