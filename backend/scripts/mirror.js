/* ==========================================================================
   mirror.js — One-command sync of the LOCAL database into the cloud Atlas
   database, so the Render site acts as a remote read-only mirror.

   Every collection from the local database replaces the matching
   collection in Atlas (deleteMany + insertMany — indexes survive).
   The local database is never modified.

   Config (backend/.env):
     LOCAL_MONGO_URI = the café laptop's MongoDB
     ATLAS_MONGO_URI = the cloud database used by Render

   Usage:  npm run mirror
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

(async () => {
    const localUri = process.env.LOCAL_MONGO_URI;
    const atlasUri = process.env.ATLAS_MONGO_URI;

    if (!localUri || !atlasUri) {
        console.error('❌ LOCAL_MONGO_URI and ATLAS_MONGO_URI are both required in backend/.env');
        process.exit(1);
    }

    const dbNameOf = uri => {
        const match = String(uri).match(/\/([^\/\s?]+)(\?|$)/);
        return match ? match[1] : null;
    };
    if (dbNameOf(localUri) === dbNameOf(atlasUri)) {
        console.error('❌ Refusing to mirror: LOCAL and ATLAS URIs point to the same database.');
        process.exit(1);
    }

    try {
        await mongoose.connect(localUri, { serverSelectionTimeoutMS: 20000 });
        const localDb = mongoose.connection.db;
        const collections = await localDb.listCollections().toArray();
        const names = collections.map(c => c.name);
        await mongoose.disconnect();

        const atlasConn = await mongoose.connect(atlasUri, { serverSelectionTimeoutMS: 30000 });
        const atlasDb = atlasConn.connection.db;

        let totalDocs = 0;
        for (const name of names) {
            await mongoose.connect(localUri, { serverSelectionTimeoutMS: 20000 });
            const docs = await mongoose.connection.db.collection(name).find({}).toArray();
            await mongoose.disconnect();

            const atlasCollection = atlasDb.collection(name);
            await atlasCollection.deleteMany({});
            if (docs.length) {
                await atlasCollection.insertMany(docs, { ordered: false });
            }
            totalDocs += docs.length;
            console.log(`  ✓ ${name}: ${docs.length} documents`);
        }

        console.log(`\n✅ Mirror complete → Atlas (${totalDocs} total documents). Render now shows the local data.`);
    } catch (err) {
        console.error('❌ Mirror failed:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();
