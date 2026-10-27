'use strict';

const path = require('node:path');
const { createSchoolServer } = require('../server');

const { database } = createSchoolServer();
try {
    const tables = database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all().map((row) => row.name);

    console.log(`SQLite database initialized at ${path.resolve(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'school.sqlite'))}`);
    console.log(`Tables ready: ${tables.join(', ')}`);
} finally {
    database.close();
}
