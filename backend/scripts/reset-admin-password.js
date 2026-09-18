/* ==========================================================================
   reset-admin-password.js — Admin password recovery tool
   For when the production admin password is lost (it is randomly generated
   on first boot). Sets a new password and revokes every active session for
   that user, so any forgotten device is logged out immediately.

   Usage:  npm run reset-admin-password -- <username> <new-password>
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

(async () => {
    const [username, newPassword] = process.argv.slice(2);

    if (!username || !newPassword) {
        console.error('Usage: npm run reset-admin-password -- <username> <new-password>');
        process.exit(1);
    }
    if (newPassword.length < 8) {
        console.error('❌ New password must be at least 8 characters long.');
        process.exit(1);
    }

    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error('❌ MONGO_URI not found in backend/.env — cannot connect.');
        process.exit(1);
    }

    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
        const db = mongoose.connection.db;

        const user = await db.collection('users').findOne({ username });
        if (!user) {
            console.error(`❌ No user named "${username}" found.`);
            console.error('   Usernames are visible in the Admin panel (Users page).');
            process.exit(1);
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { password: hash } }
        );

        const revoked = await db.collection('sessions').deleteMany({ userId: user._id });
        console.log(`✅ Password reset for "${username}" (${user.role}).`);
        console.log(`   All ${revoked.deletedCount} active session(s) revoked — every device must log in again.`);
        console.log(`   New password: ${newPassword}`);
    } catch (err) {
        console.error('❌ Reset failed:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();