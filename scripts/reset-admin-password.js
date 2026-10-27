'use strict';

const readline = require('node:readline');
const { createSchoolServer, hashPassword } = require('../server');

function resetAdminPassword(database, username, password) {
    const accountName = String(username || '').trim();
    if (!accountName) {
        throw new Error('An administrator username is required.');
    }
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
        throw new Error('The new administrator password must be between 12 and 128 characters.');
    }

    const admin = database.prepare(`
        SELECT id FROM users
        WHERE username = ? COLLATE NOCASE AND role = 'admin'
    `).get(accountName);
    if (!admin) {
        throw new Error(`No administrator account was found for username "${accountName}".`);
    }

    database.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .run(hashPassword(password), admin.id);
}

function readHiddenPassword(prompt) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
        return Promise.reject(new Error('Run this command in an interactive terminal to enter the password securely.'));
    }

    return new Promise((resolve, reject) => {
        let password = '';

        function finish(error) {
            process.stdin.removeListener('data', onData);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write('\n');

            if (error) {
                reject(error);
            } else {
                resolve(password);
            }
        }

        function onData(chunk) {
            for (const character of chunk.toString('utf8')) {
                if (character === '\u0003') {
                    finish(new Error('Password reset cancelled.'));
                    return;
                }
                if (character === '\r' || character === '\n') {
                    finish();
                    return;
                }
                if (character === '\u007f' || character === '\b') {
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                    continue;
                }
                if (character >= ' ' && character !== '\u007f') {
                    password += character;
                    process.stdout.write('*');
                }
            }
        }

        process.stdout.write(prompt);
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
    });
}

async function main() {
    const username = process.env.ADMIN_USERNAME;
    if (!username) {
        throw new Error('Set ADMIN_USERNAME in .env to the administrator account you want to reset.');
    }

    const { database } = createSchoolServer();
    try {
        console.log(`Resetting the password for administrator "${username}".`);
        const password = await readHiddenPassword('New password (12-128 characters): ');
        const confirmation = await readHiddenPassword('Confirm new password: ');

        if (password !== confirmation) {
            throw new Error('The passwords do not match.');
        }

        resetAdminPassword(database, username, password);
        console.log('Administrator password reset successfully. Sign in with the new password.');
    } finally {
        database.close();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = { resetAdminPassword };
