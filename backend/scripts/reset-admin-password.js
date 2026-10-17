/* ==========================================================================
   reset-admin-password.js — Admin password recovery tool
   For when the production admin password is lost (it is randomly generated
   on first boot). Sets a new password and revokes every active session for
   that user, so any forgotten device is logged out immediately.

    Usage:  npm run reset-admin-password -- <username>
   ========================================================================== */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');

function promptHidden(prompt) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
        return Promise.reject(new Error('Run this command in an interactive terminal to enter the password securely.'));
    }

    const input = process.stdin;
    const output = process.stdout;
    readline.emitKeypressEvents(input);

    return new Promise((resolve, reject) => {
        let answer = '';
        const wasRaw = Boolean(input.isRaw);

        const finish = error => {
            input.removeListener('keypress', onKeypress);
            input.setRawMode(wasRaw);
            input.pause();
            output.write('\n');
            if (error) reject(error);
            else resolve(answer);
        };

        const onKeypress = (character, key = {}) => {
            if (key.ctrl && key.name === 'c') {
                finish(new Error('Password entry cancelled.'));
            } else if (key.name === 'return' || key.name === 'enter') {
                finish();
            } else if (key.name === 'backspace') {
                if (answer.length) {
                    answer = Array.from(answer).slice(0, -1).join('');
                    output.write('\b \b');
                }
            } else if (character && !key.ctrl && character !== '\t') {
                answer += character;
                output.write('*'.repeat(Array.from(character).length));
            }
        };

        input.setRawMode(true);
        input.resume();
        input.on('keypress', onKeypress);
        output.write(prompt);
    });
}

(async () => {
    const [rawUsername, ...extraArgs] = process.argv.slice(2);
    const username = String(rawUsername || '').trim().toLowerCase();

    if (!username || extraArgs.length) {
        console.error('Usage: npm run reset-admin-password -- <username>');
        console.error('Do not pass passwords as command-line arguments; they are entered at a hidden prompt.');
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

        const newPassword = await promptHidden('New password: ');
        if (newPassword.length < 8) {
            throw new Error('New password must be at least 8 characters long.');
        }
        const confirmation = await promptHidden('Confirm new password: ');
        if (newPassword !== confirmation) {
            throw new Error('Passwords do not match.');
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await db.collection('users').updateOne(
            { _id: user._id },
            { $set: { password: hash } }
        );

        const revoked = await db.collection('sessions').deleteMany({ userId: user._id });
        console.log(`✅ Password reset for "${username}" (${user.role}).`);
        console.log(`   All ${revoked.deletedCount} active session(s) revoked — every device must log in again.`);
    } catch (err) {
        console.error('❌ Reset failed:', err.message);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
})();