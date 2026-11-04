const MIN_PASSWORD_CHARACTERS = 8;
const MAX_PASSWORD_BYTES = 72;
const COMMON_PASSWORDS = new Set([
    '12345678',
    '123456789',
    '1234567890',
    'admin',
    'admin123',
    'abc12345',
    'baseball',
    'changeme',
    'dragon',
    'football',
    'hello',
    'iloveyou',
    'letmein',
    'letmein123',
    'master',
    'monkey',
    'password',
    'password1',
    'password123',
    'passw0rd',
    'princess',
    'qwerty',
    'qwerty123',
    'sunshine',
    'trustno1',
    'welcome',
    'welcome1'
]);
const COMMON_PASSWORD_PREFIXES = [
    '123456',
    'abc123',
    'admin',
    'baseball',
    'changeme',
    'dragon',
    'football',
    'hello',
    'iloveyou',
    'letmein',
    'master',
    'monkey',
    'password',
    'passw0rd',
    'princess',
    'qwerty',
    'sunshine',
    'trustno1',
    'welcome'
];

function normalizePasswordForComparison(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validatePassword(password, username = '') {
    if (typeof password !== 'string') {
        return 'Password must be a string.';
    }

    if (Array.from(password).length < MIN_PASSWORD_CHARACTERS) {
        return `Password must be at least ${MIN_PASSWORD_CHARACTERS} characters.`;
    }

    if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
        return `Password must be no more than ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
    }

    const normalizedPassword = normalizePasswordForComparison(password);
    const normalizedUsername = normalizePasswordForComparison(username);
    if (normalizedUsername && normalizedPassword === normalizedUsername) {
        return 'Password must not be the same as the username.';
    }

    if (COMMON_PASSWORDS.has(normalizedPassword)
        || COMMON_PASSWORD_PREFIXES.some(prefix => normalizedPassword.startsWith(prefix))) {
        return 'Choose a less common password.';
    }

    if (normalizedPassword.includes('season3')) {
        return 'Password must not contain the cafe name.';
    }

    return null;
}

module.exports = {
    MAX_PASSWORD_BYTES,
    MIN_PASSWORD_CHARACTERS,
    validatePassword
};
