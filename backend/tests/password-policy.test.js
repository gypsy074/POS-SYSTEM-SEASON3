const { MAX_PASSWORD_BYTES, MIN_PASSWORD_CHARACTERS, validatePassword } = require('../password-policy');

describe('Password policy', () => {
    test('requires at least eight characters', () => {
        expect(MIN_PASSWORD_CHARACTERS).toBe(8);
        expect(validatePassword('abcdefg')).toContain('at least 8 characters');
        expect(validatePassword('abcdefgh')).toBeNull();
    });

    test('allows spaces in passphrases', () => {
        expect(validatePassword('ab cd ef')).toBeNull();
    });

    test('limits passwords to bcrypt’s 72-byte input limit', () => {
        expect(MAX_PASSWORD_BYTES).toBe(72);
        expect(validatePassword('😀'.repeat(18))).toBeNull();
        expect(validatePassword('😀'.repeat(19))).toContain('72 UTF-8 bytes');
    });

    test('rejects common passwords after case and punctuation normalization', () => {
        expect(validatePassword('Password123!')).toContain('less common');
        expect(validatePassword('WelcomeToCafe2026')).toContain('less common');
    });

    test('rejects a password matching the username after normalization', () => {
        expect(validatePassword('jane doe', 'Jane.Doe')).toContain('username');
    });

    test('rejects passwords containing the cafe name', () => {
        expect(validatePassword('mySeason3CafePass')).toContain('cafe name');
    });
});
