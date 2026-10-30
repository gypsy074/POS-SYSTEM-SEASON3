/* ==========================================================================
   restore.js — Restores a backup folder (produced by backup.js) into a
   database. Each JSON file is read and its documents replace the matching
   collection (deleteMany + insertMany — indexes and other collections
   are untouched).

   Usage: npm run restore -- <backup-folder> --confirm-database <database-name> [--allow-cross-database]
   Restores only to MONGO_URI configured in backend/.env. A cross-database
   restore also requires the explicit --allow-cross-database option.
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

(async () => {
    const args = process.argv.slice(2);
    const folder = args[0];
    const confirmIndex = args.indexOf('--confirm-database');
    const confirmedDatabase = confirmIndex >= 0 ? args[confirmIndex + 1] : '';
    const allowCrossDatabase = args.includes('--allow-cross-database');
    if (!folder) {
        console.error('Usage: npm run restore -- <backup-folder> --confirm-database <database-name> [--allow-cross-database]');
        process.exit(1);
    }
    if (!fs.existsSync(folder)) {
        console.error(`❌ Backup folder not found: ${folder}`);
        process.exit(1);
    }

    if (!confirmedDatabase) {
        console.error('❌ Restore requires --confirm-database <database-name> matching the target database.');
        process.exit(1);
    }

    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error('❌ MONGO_URI not found in backend/.env and no URI was passed.');
        process.exit(1);
    }

    const manifestPath = path.join(folder, 'backup-manifest.json');
    let manifest = null;
    if (fs.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch (err) {
            console.error(`❌ Backup manifest is invalid: ${err.message}`);
            process.exit(1);
        }
        if (manifest.formatVersion !== 2 || !manifest.database || !Array.isArray(manifest.collections)) {
            console.error('❌ Unsupported or invalid backup manifest.');
            process.exit(1);
        }
    } else {
        console.warn('⚠ Legacy backup without a manifest. BSON types may not be recoverable.');
    }

    const files = fs.readdirSync(folder).filter(f => f.endsWith('.json') && f !== 'backup-manifest.json');
    if (!files.length) {
        console.error(`❌ No JSON files found in ${folder}`);
        process.exit(1);
    }
    if (manifest) {
        if (manifest.collections.some(collection =>
            !collection
            || typeof collection.name !== 'string'
            || !collection.name
            || !Number.isInteger(collection.documents)
            || collection.documents < 0
            || /[$\/\\\0]/.test(collection.name)
            || collection.name.startsWith('system.')
        )) {
            console.error('❌ Backup manifest contains invalid collection metadata.');
            process.exit(1);
        }
        const expectedFiles = new Set(manifest.collections.map(collection => `${collection.name}.json`));
        const unexpectedFiles = files.filter(file => !expectedFiles.has(file));
        const missingFiles = [...expectedFiles].filter(file => !files.includes(file));
        if (unexpectedFiles.length || missingFiles.length) {
            console.error(
                `❌ Backup files do not match the manifest. Unexpected: ${unexpectedFiles.join(', ') || 'none'}; ` +
                `missing: ${missingFiles.join(', ') || 'none'}.`
            );
            process.exit(1);
        }
    }

    // Parse and validate every collection before making any destructive change.
    const collections = [];
    try {
        for (const file of files) {
            const documents = mongoose.mongo.BSON.EJSON.parse(
                fs.readFileSync(path.join(folder, file), 'utf8'),
                { relaxed: true }
            );
            if (!Array.isArray(documents)) {
                throw new Error(`${file} does not contain a JSON array`);
            }
            const name = file.replace(/\.json$/, '');
            const expected = manifest && manifest.collections.find(collection => collection.name === name);
            if (expected && expected.documents !== documents.length) {
                throw new Error(`${file} document count does not match the backup manifest`);
            }
            collections.push({ name, documents });
        }
    } catch (err) {
        console.error(`❌ Backup validation failed: ${err.message}`);
        process.exit(1);
    }

    function reviveLegacyTypes(value, field = '') {
        if (Array.isArray(value)) return value.map(item => reviveLegacyTypes(item, field));
        if (value && typeof value === 'object') {
            for (const [key, nested] of Object.entries(value)) {
                value[key] = reviveLegacyTypes(nested, key);
            }
            return value;
        }
        if (typeof value !== 'string') return value;
        if (
            ['_id', 'menuProductId', 'menuProductIds', 'userId'].includes(field)
            && /^[0-9a-fA-F]{24}$/.test(value)
        ) {
            return new mongoose.Types.ObjectId(value);
        }
        if (
            ['date', 'voidedAt', 'refundedAt', 'createdAt', 'expiresAt', 'lastActiveAt', 'updatedAt', 'closedAt'].includes(field)
            && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
        ) {
            return new Date(value);
        }
        return value;
    }

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
        const db = mongoose.connection.db;
        if (db.databaseName !== confirmedDatabase) {
            throw new Error(`Target database is "${db.databaseName}", not the explicitly confirmed "${confirmedDatabase}".`);
        }
        if (manifest && manifest.database !== db.databaseName && !allowCrossDatabase) {
            throw new Error(
                `Backup is from "${manifest.database}" but target is "${db.databaseName}". ` +
                'Use --allow-cross-database only when restoring intentionally to a different database.'
            );
        }

        let totalDocs = 0;
        for (const { name: collectionName, documents } of collections) {
            const collection = db.collection(collectionName);
            await collection.deleteMany({});
            if (documents.length) {
                await collection.insertMany(documents.map(document =>
                    manifest ? document : reviveLegacyTypes(document)
                ), { ordered: false });
            }
            totalDocs += documents.length;
            console.log(`  ✓ ${collectionName}: ${documents.length} documents`);
        }

        console.log(`\n✅ Restore complete → database "${db.databaseName}" (${totalDocs} total documents)`);
    } catch (err) {
        console.error('❌ Restore failed:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
