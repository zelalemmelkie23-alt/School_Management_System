'use strict';

const { createHash, randomBytes, scryptSync, timingSafeEqual, randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const SESSION_COOKIE = 'school_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const JSON_BODY_LIMIT = 1024 * 1024;
const MULTIPART_BODY_LIMIT = 21 * 1024 * 1024;
const REGISTRATION_FILE_LIMIT = 4 * 1024 * 1024;
const REGISTRATION_FILE_COUNT_LIMIT = 5;
const REGISTRATION_FILE_TYPES = {
    '.pdf': { contentType: 'application/pdf', signature: Buffer.from('%PDF-') },
    '.jpg': { contentType: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
    '.jpeg': { contentType: 'image/jpeg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
    '.png': { contentType: 'image/png', signature: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }
};
const PRIVILEGED_ROLES = ['admin', 'super_admin', 'school_admin', 'director', 'principal'];
const REGISTRATION_ROLES = [...PRIVILEGED_ROLES, 'registrar'];
const DATA_ACCESS_ROLES = [...REGISTRATION_ROLES, 'teacher', 'accountant'];

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function normalizeRole(role) {
    return String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
    if (typeof storedHash !== 'string' || !storedHash.includes(':')) {
        return false;
    }

    const [salt, savedHash] = storedHash.split(':');
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(savedHash, 'hex');
    return expected.length === candidate.length && timingSafeEqual(candidate, expected);
}

function publicUser(user) {
    return {
        id: user.id,
        fullName: user.full_name,
        username: user.username,
        email: user.email || '',
        role: user.role,
        studentId: user.student_id || null
    };
}

function makeStudent(row) {
    return {
        id: row.student_id,
        studentId: row.student_id,
        fullName: row.full_name,
        fname: row.first_name,
        lname: row.last_name,
        firstName: row.first_name,
        lastName: row.last_name,
        grade: row.grade,
        stream: row.stream || '',
        dob: row.date_of_birth || '',
        gender: row.gender || '',
        phone: row.phone || '',
        email: row.email || '',
        address: row.address || '',
        guardian: row.guardian_phone || '',
        guardianPhone: row.guardian_phone || '',
        hasDisability: row.has_disability || '',
        disabilityType: row.disability_type || '',
        createdAt: row.created_at
    };
}

function initializeDatabase(database) {
    database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            username TEXT NOT NULL COLLATE NOCASE UNIQUE,
            email TEXT COLLATE NOCASE UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            student_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS students (
            student_id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            grade TEXT NOT NULL,
            stream TEXT,
            date_of_birth TEXT,
            gender TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            guardian_phone TEXT,
            has_disability TEXT,
            disability_type TEXT,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS registrations (
            id TEXT PRIMARY KEY,
            full_name TEXT NOT NULL,
            student_id TEXT,
            grade TEXT NOT NULL,
            stream TEXT,
            gender TEXT NOT NULL,
            has_disability TEXT NOT NULL,
            disability_type TEXT,
            phone TEXT NOT NULL,
            email TEXT,
            previous_student_id TEXT,
            guardian_phone TEXT,
            address TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'Pending',
            review_reason TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            reviewed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS registration_documents (
            id TEXT PRIMARY KEY,
            registration_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            stored_name TEXT NOT NULL UNIQUE,
            content_type TEXT NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
            size INTEGER NOT NULL CHECK (size > 0),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attendance (
            id TEXT PRIMARY KEY,
            student_id TEXT NOT NULL,
            student_name TEXT NOT NULL,
            date TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('Present', 'Absent', 'Late')),
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (student_id, date),
            FOREIGN KEY (student_id) REFERENCES students(student_id)
        );

        CREATE TABLE IF NOT EXISTS fees (
            id TEXT PRIMARY KEY,
            student_id TEXT NOT NULL,
            student_name TEXT NOT NULL,
            amount REAL NOT NULL CHECK (amount > 0),
            amount_paid REAL NOT NULL CHECK (amount_paid >= 0 AND amount_paid <= amount),
            balance REAL NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('Paid', 'Partial', 'Pending', 'Overdue')),
            due_date TEXT NOT NULL,
            payment_date TEXT,
            payment_method TEXT,
            created_by TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(student_id)
        );

        CREATE TABLE IF NOT EXISTS results (
            id TEXT PRIMARY KEY,
            student_id TEXT NOT NULL,
            student_name TEXT NOT NULL,
            subject TEXT NOT NULL,
            score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
            grade TEXT NOT NULL,
            term TEXT NOT NULL,
            academic_year TEXT NOT NULL,
            exam_type TEXT NOT NULL,
            remarks TEXT,
            teacher_id TEXT,
            teacher_name TEXT,
            date TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (student_id) REFERENCES students(student_id)
        );

        CREATE TABLE IF NOT EXISTS enquiries (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_attendance_student ON attendance(student_id);
        CREATE INDEX IF NOT EXISTS idx_fees_student ON fees(student_id);
        CREATE INDEX IF NOT EXISTS idx_results_student ON results(student_id);
        CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
        CREATE INDEX IF NOT EXISTS idx_registration_documents_registration
            ON registration_documents(registration_id);
    `);
}

function ensureBootstrapAdmin(database, admin) {
    if (!admin) {
        return;
    }

    const fullName = String(admin.fullName || '').trim();
    const username = String(admin.username || '').trim();
    const email = String(admin.email || '').trim().toLowerCase();
    const password = String(admin.password || '');

    if (!fullName || !username || !email || password.length < 12) {
        throw new Error('Bootstrap admin requires a name, username, email, and password of at least 12 characters.');
    }

    const exists = database.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (!exists) {
        database.prepare(`
            INSERT INTO users (id, full_name, username, email, password_hash, role)
            VALUES (?, ?, ?, ?, ?, 'admin')
        `).run(randomUUID(), fullName, username, email, hashPassword(password));
    }
}

function parseCookies(header = '') {
    return Object.fromEntries(header.split(';').map((part) => {
        const separator = part.indexOf('=');
        if (separator < 0) return ['', ''];
        const key = part.slice(0, separator).trim();
        const value = part.slice(separator + 1).trim();
        try {
            return [key, decodeURIComponent(value)];
        } catch {
            return [key, ''];
        }
    }).filter(([key]) => key));
}

function jsonResponse(response, status, data, extraHeaders = {}) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders
    });
    response.end(JSON.stringify(data));
}

function localDevelopmentOrigin(origin) {
    if (!origin) return null;
    try {
        const parsed = new URL(origin);
        if (
            !['http:', 'https:'].includes(parsed.protocol) ||
            !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
        ) {
            return null;
        }
        return parsed.origin;
    } catch {
        return null;
    }
}

async function readBody(request, limit) {
    const chunks = [];
    let size = 0;

    for await (const chunk of request) {
        size += chunk.length;
        if (size > limit) {
            throw new HttpError(413, 'Request body is too large.');
        }
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

async function readJson(request) {
    const contentType = request.headers['content-type'] || '';
    if (!contentType.toLowerCase().includes('application/json')) {
        throw new HttpError(415, 'Content-Type must be application/json.');
    }

    const body = await readBody(request, JSON_BODY_LIMIT);
    try {
        const parsed = JSON.parse(body.toString('utf8'));
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            throw new Error('Expected a JSON object.');
        }
        return parsed;
    } catch {
        throw new HttpError(400, 'Request body must be a valid JSON object.');
    }
}

async function readRegistration(request) {
    const contentType = request.headers['content-type'] || '';
    const body = await readBody(request, MULTIPART_BODY_LIMIT);

    if (contentType.toLowerCase().includes('multipart/form-data')) {
        try {
            const form = await new Request(`http://${request.headers.host || 'localhost'}/`, {
                method: 'POST',
                headers: { 'content-type': contentType },
                body
            }).formData();
            const values = {};
            const documents = [];
            for (const [key, value] of form.entries()) {
                if (typeof value === 'string') {
                    values[key] = value;
                    continue;
                }

                if (key !== 'documents') {
                    throw new HttpError(400, 'Unexpected file field in the registration form.');
                }

                if (!value.name && value.size === 0) continue;
                if (documents.length >= REGISTRATION_FILE_COUNT_LIMIT) {
                    throw new HttpError(413, `Upload no more than ${REGISTRATION_FILE_COUNT_LIMIT} documents.`);
                }
                if (value.size === 0) {
                    throw new HttpError(400, 'Selected documents cannot be empty.');
                }
                if (value.size > REGISTRATION_FILE_LIMIT) {
                    throw new HttpError(413, 'Each document must be 4 MB or smaller.');
                }

                const fileName = value.name.replace(/\\/g, '/').split('/').pop();
                const extension = path.extname(fileName).toLowerCase();
                const fileType = REGISTRATION_FILE_TYPES[extension];
                if (!fileType) {
                    throw new HttpError(415, 'Documents must be PDF, JPG, JPEG, or PNG files.');
                }

                const content = Buffer.from(await value.arrayBuffer());
                if (
                    content.length < fileType.signature.length ||
                    !content.subarray(0, fileType.signature.length).equals(fileType.signature)
                ) {
                    throw new HttpError(415, `The selected ${extension.slice(1).toUpperCase()} file is invalid or damaged.`);
                }

                documents.push({
                    displayName: fileName.slice(0, 255),
                    extension,
                    contentType: fileType.contentType,
                    content
                });
            }
            return { ...values, documents };
        } catch (error) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(400, 'The registration form could not be read.');
        }
    }

    if (contentType.toLowerCase().includes('application/json')) {
        try {
            const values = JSON.parse(body.toString('utf8'));
            return { ...values, documents: [] };
        } catch {
            throw new HttpError(400, 'Request body must be valid JSON.');
        }
    }

    throw new HttpError(415, 'Registration must be submitted as form data.');
}

function text(value, label, { required = false, max = 255 } = {}) {
    if (typeof value !== 'string') {
        if (required) throw new HttpError(400, `${label} is required.`);
        return '';
    }
    const result = value.trim();
    if (required && !result) throw new HttpError(400, `${label} is required.`);
    if (result.length > max) throw new HttpError(400, `${label} must be ${max} characters or fewer.`);
    return result;
}

function validEmail(email) {
    return !email || (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function studentFromDatabase(database, studentId) {
    return database.prepare('SELECT * FROM students WHERE student_id = ? AND active = 1').get(studentId);
}

function createSchoolServer(options = {}) {
    const databasePath = path.resolve(options.dbPath || process.env.DB_PATH || path.join(ROOT, 'data', 'school.sqlite'));
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const documentDirectory = path.join(path.dirname(databasePath), 'registration-documents');
    fs.mkdirSync(documentDirectory, { recursive: true });

    const database = new DatabaseSync(databasePath);
    initializeDatabase(database);
    ensureBootstrapAdmin(database, options.bootstrapAdmin);

    const getAuthenticatedUser = (request) => {
        const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
        if (!token) return null;
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const row = database.prepare(`
            SELECT users.* FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
        `).get(tokenHash, Date.now());
        return row || null;
    };

    const requireUser = (request, roles) => {
        const user = getAuthenticatedUser(request);
        if (!user) throw new HttpError(401, 'Please log in to continue.');
        if (roles && !roles.includes(normalizeRole(user.role))) {
            throw new HttpError(403, 'You do not have permission to perform this action.');
        }
        return user;
    };

    const studentScope = (request, user, roles = DATA_ACCESS_ROLES) => {
        if (roles.includes(normalizeRole(user.role))) return null;
        if (normalizeRole(user.role) !== 'student' || !user.student_id) {
            throw new HttpError(403, 'You do not have permission to view these records.');
        }
        return user.student_id;
    };

    const server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
            const pathname = decodeURIComponent(url.pathname);

            if (pathname.startsWith('/api/')) {
                const origin = localDevelopmentOrigin(request.headers.origin);
                if (origin) {
                    response.setHeader('Access-Control-Allow-Origin', origin);
                    response.setHeader('Access-Control-Allow-Credentials', 'true');
                    response.setHeader('Vary', 'Origin');
                }

                if (request.method === 'OPTIONS') {
                    if (!origin) throw new HttpError(403, 'Cross-origin requests are not allowed.');
                    response.writeHead(204, {
                        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type',
                        'Access-Control-Max-Age': '600'
                    });
                    return response.end();
                }
            }

            if (pathname === '/api/health' && request.method === 'GET') {
                database.prepare('SELECT 1').get();
                return jsonResponse(response, 200, { status: 'ok', database: 'connected' });
            }

            if (pathname === '/api/auth/login' && request.method === 'POST') {
                const body = await readJson(request);
                const identifier = text(body.identifier, 'Username or email', { required: true, max: 254 });
                const password = typeof body.password === 'string' ? body.password : '';
                if (password.length > 128) throw new HttpError(401, 'Invalid username/email or password.');
                const user = database.prepare(`
                    SELECT * FROM users
                    WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
                `).get(identifier, identifier);

                if (!user || !verifyPassword(password, user.password_hash)) {
                    throw new HttpError(401, 'Invalid username/email or password.');
                }

                const token = randomBytes(32).toString('base64url');
                const tokenHash = createHash('sha256').update(token).digest('hex');
                const expiresAt = Date.now() + SESSION_DURATION_MS;
                database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
                database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
                    .run(tokenHash, user.id, expiresAt);
                const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
                return jsonResponse(response, 200, {
                    success: true,
                    message: 'Login successful.',
                    user: publicUser(user)
                }, {
                    'Set-Cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_DURATION_MS / 1000)}${secure}`
                });
            }

            if (pathname === '/api/auth/logout' && request.method === 'POST') {
                const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
                if (token) {
                    const tokenHash = createHash('sha256').update(token).digest('hex');
                    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
                }
                return jsonResponse(response, 200, { success: true, message: 'Logged out.' }, {
                    'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
                });
            }

            if (pathname === '/api/auth/signup' && request.method === 'POST') {
                throw new HttpError(403, 'Student accounts are created by the school after an admission application is approved.');
            }

            if (pathname === '/api/enquiries' && request.method === 'POST') {
                const body = await readJson(request);
                const name = text(body.name, 'Full name', { required: true, max: 100 });
                const email = text(body.email, 'Email address', { required: true, max: 254 }).toLowerCase();
                const subject = text(body.subject, 'Subject', { required: true, max: 120 });
                const message = text(body.message, 'Message', { required: true, max: 2000 });
                if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
                const id = randomUUID();
                database.prepare('INSERT INTO enquiries (id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)')
                    .run(id, name, email, subject, message);
                return jsonResponse(response, 201, { success: true, message: 'Your enquiry has been sent.', id });
            }

            if (pathname === '/api/registrations' && request.method === 'POST') {
                const body = await readRegistration(request);
                const fullName = text(body.fullName, 'Full name', { required: true, max: 120 });
                const grade = text(body.grade, 'Grade', { required: true, max: 30 });
                if (!['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'].includes(grade)) {
                    throw new HttpError(400, 'Select a valid grade.');
                }
                const gender = text(body.gender, 'Gender', { required: true, max: 20 });
                const disability = text(body.hasDisability, 'Disability response', { required: true, max: 10 });
                const phone = text(body.phone, 'Phone number', { required: true, max: 32 });
                const email = text(body.email, 'Email address', { max: 254 }).toLowerCase();
                const stream = text(body.stream, 'Stream', { max: 60 });
                const disabilityType = text(body.disabilityType, 'Disability type', { max: 60 });
                const studentId = text(body.studentId, 'Student ID', { max: 64 });
                const previousStudentId = text(body.previousStudentId, 'Previous student ID', { max: 64 });
                const guardianPhone = text(body.guardianPhone, 'Parent/guardian phone', { max: 32 });
                const address = text(body.address, 'Address', { max: 500 });

                if (!['Male', 'Female'].includes(gender)) throw new HttpError(400, 'Select a valid gender.');
                if (!['Yes', 'No'].includes(disability)) throw new HttpError(400, 'Select a valid disability response.');
                if (disability === 'Yes' && !disabilityType) throw new HttpError(400, 'Select the disability type.');
                if (['Grade 11', 'Grade 12'].includes(grade) && !['Natural Science', 'Social Science'].includes(stream)) {
                    throw new HttpError(400, 'Select a valid stream for this grade.');
                }
                if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
                if (studentId && database.prepare('SELECT student_id FROM students WHERE student_id = ?').get(studentId)) {
                    throw new HttpError(409, 'That student ID is already in use.');
                }

                const id = randomUUID();
                const savedDocuments = [];
                try {
                    for (const document of body.documents) {
                        const documentId = randomUUID();
                        const storedName = `${documentId}${document.extension}`;
                        await fs.promises.writeFile(
                            path.join(documentDirectory, storedName),
                            document.content,
                            { flag: 'wx' }
                        );
                        savedDocuments.push({
                            id: documentId,
                            storedName,
                            displayName: document.displayName,
                            contentType: document.contentType,
                            size: document.content.length
                        });
                    }

                    database.exec('BEGIN IMMEDIATE');
                    try {
                        database.prepare(`
                            INSERT INTO registrations
                            (id, full_name, student_id, grade, stream, gender, has_disability, disability_type,
                             phone, email, previous_student_id, guardian_phone, address)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(id, fullName, studentId || null, grade, stream || null, gender, disability,
                            disabilityType || null, phone, email || null, previousStudentId || null,
                            guardianPhone || null, address);

                        const insertDocument = database.prepare(`
                            INSERT INTO registration_documents
                            (id, registration_id, display_name, stored_name, content_type, size)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `);
                        for (const document of savedDocuments) {
                            insertDocument.run(
                                document.id,
                                id,
                                document.displayName,
                                document.storedName,
                                document.contentType,
                                document.size
                            );
                        }
                        database.exec('COMMIT');
                    } catch (error) {
                        database.exec('ROLLBACK');
                        throw error;
                    }
                } catch (error) {
                    await Promise.all(savedDocuments.map(async (document) => {
                        try {
                            await fs.promises.unlink(path.join(documentDirectory, document.storedName));
                        } catch (cleanupError) {
                            if (cleanupError.code !== 'ENOENT') {
                                console.error('Could not remove an uncommitted registration document:', cleanupError);
                            }
                        }
                    }));
                    throw error;
                }
                return jsonResponse(response, 201, { success: true, message: 'Application submitted for review.', id });
            }

            if (pathname === '/api/registrations' && request.method === 'GET') {
                requireUser(request, REGISTRATION_ROLES);
                const status = url.searchParams.get('status') || 'Pending';
                if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
                    throw new HttpError(400, 'Invalid application status.');
                }
                const registrations = database.prepare(`
                    SELECT id, full_name AS fullName, student_id AS studentId, grade, stream, gender,
                           has_disability AS hasDisability, disability_type AS disabilityType, phone, email,
                           previous_student_id AS previousStudentId, guardian_phone AS guardianPhone,
                           address, status, review_reason AS reason, created_at AS createdAt
                    FROM registrations WHERE status = ? ORDER BY created_at DESC
                `).all(status);
                for (const registration of registrations) {
                    registration.documents = database.prepare(`
                        SELECT id, display_name AS name, content_type AS contentType, size
                        FROM registration_documents
                        WHERE registration_id = ?
                        ORDER BY created_at, id
                    `).all(registration.id).map((document) => ({
                        ...document,
                        url: `/api/registrations/${encodeURIComponent(registration.id)}/documents/${encodeURIComponent(document.id)}`
                    }));
                }
                return jsonResponse(response, 200, registrations);
            }

            const documentMatch = pathname.match(/^\/api\/registrations\/([^/]+)\/documents\/([^/]+)$/);
            if (documentMatch && request.method === 'GET') {
                requireUser(request, REGISTRATION_ROLES);
                const [, registrationId, documentId] = documentMatch;
                const document = database.prepare(`
                    SELECT display_name, stored_name, content_type
                    FROM registration_documents
                    WHERE id = ? AND registration_id = ?
                `).get(documentId, registrationId);
                if (!document) throw new HttpError(404, 'Registration document not found.');

                const filePath = path.resolve(documentDirectory, document.stored_name);
                if (!filePath.startsWith(`${documentDirectory}${path.sep}`)) {
                    throw new HttpError(404, 'Registration document not found.');
                }
                let file;
                try {
                    file = await fs.promises.readFile(filePath);
                } catch (error) {
                    if (error.code === 'ENOENT') {
                        throw new HttpError(404, 'Registration document is no longer available.');
                    }
                    throw error;
                }
                return response.writeHead(200, {
                    'Content-Type': document.content_type,
                    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.display_name)}`,
                    'Content-Length': file.length,
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff'
                }).end(file);
            }

            const registrationMatch = pathname.match(/^\/api\/registrations\/([^/]+)(?:\/review)?$/);
            if (registrationMatch && request.method === 'PATCH') {
                const user = requireUser(request, REGISTRATION_ROLES);
                const registrationId = registrationMatch[1];
                const registration = database.prepare('SELECT * FROM registrations WHERE id = ?').get(registrationId);
                if (!registration) throw new HttpError(404, 'Application not found.');
                if (registration.status !== 'Pending') throw new HttpError(409, 'Only pending applications can be changed.');
                const body = await readJson(request);

                if (pathname.endsWith('/review')) {
                    const status = body.status;
                    if (status === 'Rejected') {
                        const reason = text(body.reason, 'Rejection reason', { required: true, max: 500 });
                        database.prepare(`UPDATE registrations SET status = 'Rejected', review_reason = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`)
                            .run(reason, registrationId);
                        return jsonResponse(response, 200, { success: true, message: 'Application rejected.' });
                    }
                    if (status !== 'Approved') throw new HttpError(400, 'Status must be Approved or Rejected.');

                    const username = text(body.username, 'Username', { required: true, max: 30 });
                    const password = typeof body.temporaryPassword === 'string' ? body.temporaryPassword : '';
                    if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
                        throw new HttpError(400, 'Username must be 3-30 characters and use letters, numbers, dots, underscores, or hyphens.');
                    }
                    if (password.length < 8 || password.length > 128) {
                        throw new HttpError(400, 'Temporary password must be between 8 and 128 characters.');
                    }
                    if (database.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)) {
                        throw new HttpError(409, 'That username is already in use.');
                    }
                    if (registration.email && database.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(registration.email)) {
                        throw new HttpError(409, 'An account already uses this email address.');
                    }

                    const studentId = registration.student_id || `STU-${new Date().getFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
                    const [firstName = '', ...lastParts] = registration.full_name.split(/\s+/);
                    const lastName = lastParts.join(' ');
                    const accountId = randomUUID();
                    database.exec('BEGIN IMMEDIATE');
                    try {
                        database.prepare(`
                            INSERT INTO students
                            (student_id, full_name, first_name, last_name, grade, stream, gender, phone,
                             email, guardian_phone, has_disability, disability_type)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(studentId, registration.full_name, firstName, lastName, registration.grade,
                            registration.stream, registration.gender, registration.phone, registration.email,
                            registration.guardian_phone, registration.has_disability, registration.disability_type);
                        database.prepare(`
                            INSERT INTO users (id, full_name, username, email, password_hash, role, student_id)
                            VALUES (?, ?, ?, ?, ?, 'student', ?)
                        `).run(accountId, registration.full_name, username, registration.email,
                            hashPassword(password), studentId);
                        database.prepare(`UPDATE registrations SET status = 'Approved', student_id = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`)
                            .run(studentId, registrationId);
                        database.exec('COMMIT');
                    } catch (error) {
                        database.exec('ROLLBACK');
                        if (String(error.message).includes('UNIQUE')) {
                            throw new HttpError(409, 'The student ID or account details are already in use.');
                        }
                        throw error;
                    }
                    return jsonResponse(response, 200, { success: true, message: 'Application approved and student account created.', studentId });
                }

                if (normalizeRole(user.role) !== 'registrar' && !PRIVILEGED_ROLES.includes(normalizeRole(user.role))) {
                    throw new HttpError(403, 'You do not have permission to edit applications.');
                }
                const changes = {
                    fullName: text(body.fullName, 'Full name', { required: true, max: 120 }),
                    grade: text(body.grade, 'Grade', { required: true, max: 30 }),
                    stream: text(body.stream, 'Stream', { max: 60 }),
                    phone: text(body.phone, 'Phone number', { required: true, max: 32 }),
                    email: text(body.email, 'Email address', { max: 254 }).toLowerCase(),
                    previousStudentId: text(body.previousStudentId, 'Previous student ID', { max: 64 }),
                    guardianPhone: text(body.guardianPhone, 'Parent/guardian phone', { max: 32 }),
                    address: text(body.address, 'Address', { required: true, max: 500 })
                };
                if (!validEmail(changes.email)) throw new HttpError(400, 'Enter a valid email address.');
                database.prepare(`
                    UPDATE registrations
                    SET full_name = ?, grade = ?, stream = ?, phone = ?, email = ?,
                        previous_student_id = ?, guardian_phone = ?, address = ?
                    WHERE id = ? AND status = 'Pending'
                `).run(changes.fullName, changes.grade, changes.stream || null, changes.phone,
                    changes.email || null, changes.previousStudentId || null, changes.guardianPhone || null,
                    changes.address, registrationId);
                return jsonResponse(response, 200, { success: true, message: 'Application updated.' });
            }

            if (pathname === '/api/users' && request.method === 'GET') {
                requireUser(request, PRIVILEGED_ROLES);
                const users = database.prepare(`
                    SELECT id, full_name AS fullName, username, email, role,
                           student_id AS studentId, created_at AS createdAt
                    FROM users ORDER BY full_name
                `).all();
                return jsonResponse(response, 200, users);
            }

            if (pathname === '/api/users' && request.method === 'POST') {
                requireUser(request, PRIVILEGED_ROLES);
                const body = await readJson(request);
                const fullName = text(body.fullName, 'Full name', { required: true, max: 100 });
                const username = text(body.username, 'Username', { required: true, max: 30 });
                const email = text(body.email, 'Email address', { required: true, max: 254 }).toLowerCase();
                const password = typeof body.password === 'string' ? body.password : '';

                if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
                    throw new HttpError(400, 'Username must be 3-30 characters and use letters, numbers, dots, underscores, or hyphens.');
                }
                if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
                if (password.length < 8 || password.length > 128) {
                    throw new HttpError(400, 'Password must be between 8 and 128 characters.');
                }

                const userId = randomUUID();
                try {
                    database.prepare(`
                        INSERT INTO users (id, full_name, username, email, password_hash, role)
                        VALUES (?, ?, ?, ?, ?, 'teacher')
                    `).run(userId, fullName, username, email, hashPassword(password));
                } catch (error) {
                    if (String(error.message).includes('UNIQUE')) {
                        throw new HttpError(409, 'That username or email address is already in use.');
                    }
                    throw error;
                }

                const user = database.prepare(`
                    SELECT id, full_name AS fullName, username, email, role,
                           student_id AS studentId, created_at AS createdAt
                    FROM users WHERE id = ?
                `).get(userId);
                return jsonResponse(response, 201, {
                    success: true,
                    message: 'Teacher account created.',
                    user
                });
            }

            if (pathname === '/api/students' && request.method === 'GET') {
                const user = requireUser(request, [...DATA_ACCESS_ROLES, 'student']);
                const scope = studentScope(request, user, [...REGISTRATION_ROLES, 'teacher', 'accountant']);
                const rows = scope
                    ? database.prepare('SELECT * FROM students WHERE active = 1 AND student_id = ?').all(scope)
                    : database.prepare('SELECT * FROM students WHERE active = 1 ORDER BY full_name').all();
                return jsonResponse(response, 200, rows.map(makeStudent));
            }

            if (pathname === '/api/students' && request.method === 'POST') {
                requireUser(request, REGISTRATION_ROLES);
                const body = await readJson(request);
                const studentId = text(body.studentId, 'Student ID', { required: true, max: 64 });
                const firstNameValue = body.fname || body.firstName;
                const lastNameValue = body.lname || body.lastName;
                const fullName = text(body.fullName || [firstNameValue, lastNameValue].filter(Boolean).join(' '),
                    'Full name', { required: true, max: 120 });
                const grade = text(body.grade, 'Grade', { required: true, max: 30 });
                const email = text(body.email, 'Email address', { max: 254 }).toLowerCase();
                if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
                const firstName = text(firstNameValue || fullName.split(/\s+/)[0], 'First name', { max: 60 });
                const lastName = text(lastNameValue || fullName.split(/\s+/).slice(1).join(' '), 'Last name', { max: 60 });
                try {
                    database.prepare(`
                        INSERT INTO students
                        (student_id, full_name, first_name, last_name, grade, stream, date_of_birth,
                         gender, phone, email, address, guardian_phone, has_disability, disability_type)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(studentId, fullName, firstName, lastName, grade,
                        text(body.stream, 'Stream', { max: 60 }) || null,
                        text(body.dob, 'Date of birth', { max: 10 }) || null,
                        text(body.gender, 'Gender', { max: 20 }) || null,
                        text(body.phone, 'Phone number', { max: 32 }) || null,
                        email || null, text(body.address, 'Address', { max: 500 }) || null,
                        text(body.guardianPhone || body.guardian, 'Guardian phone', { max: 32 }) || null,
                        text(body.hasDisability, 'Disability response', { max: 10 }) || null,
                        text(body.disabilityType, 'Disability type', { max: 60 }) || null);
                } catch (error) {
                    if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'That student ID already exists.');
                    throw error;
                }
                return jsonResponse(response, 201, { success: true, student: makeStudent(studentFromDatabase(database, studentId)) });
            }

            const studentMatch = pathname.match(/^\/api\/students\/([^/]+)$/);
            if (studentMatch && ['PUT', 'DELETE'].includes(request.method)) {
                requireUser(request, REGISTRATION_ROLES);
                const studentId = studentMatch[1];
                const existing = studentFromDatabase(database, studentId);
                if (!existing) throw new HttpError(404, 'Student not found.');
                if (request.method === 'DELETE') {
                    database.prepare('UPDATE students SET active = 0 WHERE student_id = ?').run(studentId);
                    database.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE student_id = ?)').run(studentId);
                    return jsonResponse(response, 200, { success: true, message: 'Student archived.' });
                }
                const body = await readJson(request);
                const firstNameValue = body.fname || body.firstName;
                const lastNameValue = body.lname || body.lastName;
                const fullName = text(body.fullName || [firstNameValue, lastNameValue].filter(Boolean).join(' ') || existing.full_name,
                    'Full name', { required: true, max: 120 });
                const grade = text(body.grade || existing.grade, 'Grade', { required: true, max: 30 });
                const email = text(body.email ?? existing.email ?? '', 'Email address', { max: 254 }).toLowerCase();
                if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
                database.prepare(`
                    UPDATE students SET full_name = ?, first_name = ?, last_name = ?, grade = ?,
                        stream = ?, date_of_birth = ?, gender = ?, phone = ?, email = ?, address = ?,
                        guardian_phone = ?, has_disability = ?, disability_type = ?
                    WHERE student_id = ?
                `).run(fullName, text(firstNameValue || fullName.split(/\s+/)[0], 'First name', { max: 60 }),
                    text(lastNameValue || fullName.split(/\s+/).slice(1).join(' '), 'Last name', { max: 60 }),
                    grade, text(body.stream ?? existing.stream ?? '', 'Stream', { max: 60 }) || null,
                    text(body.dob ?? existing.date_of_birth ?? '', 'Date of birth', { max: 10 }) || null,
                    text(body.gender ?? existing.gender ?? '', 'Gender', { max: 20 }) || null,
                    text(body.phone ?? existing.phone ?? '', 'Phone number', { max: 32 }) || null,
                    email || null, text(body.address ?? existing.address ?? '', 'Address', { max: 500 }) || null,
                    text(body.guardianPhone ?? body.guardian ?? existing.guardian_phone ?? '', 'Guardian phone', { max: 32 }) || null,
                    text(body.hasDisability ?? existing.has_disability ?? '', 'Disability response', { max: 10 }) || null,
                    text(body.disabilityType ?? existing.disability_type ?? '', 'Disability type', { max: 60 }) || null,
                    studentId);
                return jsonResponse(response, 200, { success: true, student: makeStudent(studentFromDatabase(database, studentId)) });
            }

            if (pathname === '/api/attendance' && request.method === 'GET') {
                const user = requireUser(request, [...REGISTRATION_ROLES, 'teacher', 'student']);
                const scope = studentScope(request, user, [...REGISTRATION_ROLES, 'teacher']);
                const records = scope
                    ? database.prepare('SELECT * FROM attendance WHERE student_id = ? ORDER BY date DESC').all(scope)
                    : database.prepare('SELECT * FROM attendance ORDER BY date DESC').all();
                return jsonResponse(response, 200, records.map((row) => ({
                    id: row.id, studentId: row.student_id, studentName: row.student_name,
                    date: row.date, status: row.status, createdAt: row.created_at
                })));
            }

            if (pathname === '/api/attendance' && request.method === 'POST') {
                const user = requireUser(request, [...PRIVILEGED_ROLES, 'registrar', 'teacher']);
                const body = await readJson(request);
                const studentId = text(body.studentId, 'Student ID', { required: true, max: 64 });
                const date = text(body.date, 'Attendance date', { required: true, max: 10 });
                const status = text(body.status, 'Attendance status', { required: true, max: 20 });
                const student = studentFromDatabase(database, studentId);
                if (!student) throw new HttpError(404, 'Student not found.');
                if (!validDate(date)) throw new HttpError(400, 'Enter a valid attendance date.');
                if (!['Present', 'Absent', 'Late'].includes(status)) throw new HttpError(400, 'Attendance status must be Present, Absent, or Late.');
                try {
                    database.prepare('INSERT INTO attendance (id, student_id, student_name, date, status, created_by) VALUES (?, ?, ?, ?, ?, ?)')
                        .run(randomUUID(), studentId, student.full_name, date, status, user.id);
                } catch (error) {
                    if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'Attendance has already been recorded for this student and date.');
                    throw error;
                }
                return jsonResponse(response, 201, { success: true, message: 'Attendance saved.' });
            }

            if (pathname === '/api/fees' && request.method === 'GET') {
                const user = requireUser(request, [...PRIVILEGED_ROLES, 'accountant', 'student']);
                const scope = studentScope(request, user, [...PRIVILEGED_ROLES, 'accountant']);
                const rows = scope
                    ? database.prepare('SELECT * FROM fees WHERE student_id = ? ORDER BY due_date DESC').all(scope)
                    : database.prepare('SELECT * FROM fees ORDER BY due_date DESC').all();
                return jsonResponse(response, 200, rows.map((row) => ({
                    id: row.id, studentId: row.student_id, studentName: row.student_name,
                    amount: row.amount, amountPaid: row.amount_paid, balance: row.balance,
                    status: row.status, dueDate: row.due_date, paymentDate: row.payment_date || '',
                    paymentMethod: row.payment_method || '', createdAt: row.created_at
                })));
            }

            if (pathname === '/api/fees' && request.method === 'POST') {
                const user = requireUser(request, [...PRIVILEGED_ROLES, 'accountant']);
                const body = await readJson(request);
                const studentId = text(body.studentId, 'Student ID', { required: true, max: 64 });
                const amount = Number(body.amount);
                const amountPaid = Number(body.amountPaid);
                const dueDate = text(body.dueDate, 'Due date', { required: true, max: 10 });
                const paymentDate = text(body.paymentDate, 'Payment date', { max: 10 });
                const paymentMethod = text(body.paymentMethod, 'Payment method', { max: 40 });
                const student = studentFromDatabase(database, studentId);
                if (!student) throw new HttpError(404, 'Student not found.');
                if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > amount) {
                    throw new HttpError(400, 'Fee and paid amounts must be valid, and the paid amount cannot exceed the fee.');
                }
                if (!validDate(dueDate) || (paymentDate && !validDate(paymentDate))) throw new HttpError(400, 'Enter valid fee dates.');
                if (amountPaid > 0 && !paymentDate) throw new HttpError(400, 'Payment date is required when a payment is recorded.');
                const balance = Number((amount - amountPaid).toFixed(2));
                const status = balance === 0 ? 'Paid' : amountPaid > 0 ? 'Partial' :
                    dueDate < new Date().toISOString().slice(0, 10) ? 'Overdue' : 'Pending';
                database.prepare(`
                    INSERT INTO fees (id, student_id, student_name, amount, amount_paid, balance, status,
                                      due_date, payment_date, payment_method, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(randomUUID(), studentId, student.full_name, amount, amountPaid, balance, status,
                    dueDate, paymentDate || null, paymentMethod || null, user.id);
                return jsonResponse(response, 201, { success: true, message: 'Fee record saved.' });
            }

            if (pathname === '/api/results' && request.method === 'GET') {
                const user = requireUser(request, [...REGISTRATION_ROLES, 'teacher', 'student']);
                const scope = studentScope(request, user, [...REGISTRATION_ROLES, 'teacher']);
                const rows = scope
                    ? database.prepare('SELECT * FROM results WHERE student_id = ? ORDER BY date DESC').all(scope)
                    : database.prepare('SELECT * FROM results ORDER BY date DESC').all();
                return jsonResponse(response, 200, rows.map((row) => ({
                    id: row.id, studentId: row.student_id, studentName: row.student_name,
                    subject: row.subject, score: row.score, grade: row.grade, term: row.term,
                    academicYear: row.academic_year, examType: row.exam_type, remarks: row.remarks || '',
                    teacherId: row.teacher_id, teacherName: row.teacher_name || '', date: row.date,
                    createdAt: row.created_at
                })));
            }

            if (pathname === '/api/results' && request.method === 'POST') {
                const user = requireUser(request, [...PRIVILEGED_ROLES, 'teacher']);
                const body = await readJson(request);
                const studentId = text(body.studentId, 'Student ID', { required: true, max: 64 });
                const subject = text(body.subject, 'Subject', { required: true, max: 100 });
                const score = Number(body.score);
                const grade = text(body.grade, 'Grade', { required: true, max: 10 });
                const term = text(body.term, 'Term', { required: true, max: 40 });
                const academicYear = text(body.academicYear, 'Academic year', { required: true, max: 30 });
                const examType = text(body.examType, 'Exam type', { required: true, max: 60 });
                const student = studentFromDatabase(database, studentId);
                if (!student) throw new HttpError(404, 'Student not found.');
                if (!Number.isFinite(score) || score < 0 || score > 100) throw new HttpError(400, 'Score must be between 0 and 100.');
                const id = randomUUID();
                database.prepare(`
                    INSERT INTO results (id, student_id, student_name, subject, score, grade, term,
                                         academic_year, exam_type, remarks, teacher_id, teacher_name, date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(id, studentId, student.full_name, subject, score, grade, term, academicYear,
                    examType, text(body.remarks, 'Remarks', { max: 500 }) || null, user.id,
                    user.full_name, new Date().toISOString());
                return jsonResponse(response, 201, { success: true, id, message: 'Result saved.' });
            }

            if (pathname.startsWith('/api/')) {
                return jsonResponse(response, 404, { message: 'API endpoint not found.' });
            }

            if (!['GET', 'HEAD'].includes(request.method)) {
                throw new HttpError(405, 'Method not allowed.');
            }

            const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
            const filePath = path.resolve(ROOT, relativePath);
            if (!filePath.startsWith(`${ROOT}${path.sep}`) || relativePath.startsWith('.')) {
                throw new HttpError(404, 'Page not found.');
            }
            const extension = path.extname(filePath).toLowerCase();
            const contentTypes = {
                '.html': 'text/html; charset=utf-8',
                '.css': 'text/css; charset=utf-8',
                '.js': 'text/javascript; charset=utf-8',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.ico': 'image/x-icon'
            };
            if (!contentTypes[extension] || path.basename(filePath) === 'server.js') {
                throw new HttpError(404, 'Page not found.');
            }
            let file;
            try {
                file = await fs.promises.readFile(filePath);
            } catch (error) {
                if (error.code === 'ENOENT' || error.code === 'EISDIR') throw new HttpError(404, 'Page not found.');
                throw error;
            }
            response.writeHead(200, {
                'Content-Type': contentTypes[extension],
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600'
            });
            response.end(request.method === 'HEAD' ? undefined : file);
        } catch (error) {
            if (!(error instanceof HttpError)) {
                console.error('Request failed:', error);
            }
            const status = error instanceof HttpError ? error.status : 500;
            const message = error instanceof HttpError ? error.message : 'An unexpected server error occurred.';
            if (!response.headersSent) {
                jsonResponse(response, status, { message });
            } else {
                response.destroy();
            }
        }
    });

    server.on('close', () => database.close());
    return { server, database };
}

if (require.main === module) {
    const bootstrapAdmin = process.env.ADMIN_NAME && process.env.ADMIN_USERNAME &&
        process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD
        ? {
            fullName: process.env.ADMIN_NAME,
            username: process.env.ADMIN_USERNAME,
            email: process.env.ADMIN_EMAIL,
            password: process.env.ADMIN_PASSWORD
        }
        : null;

    const { server } = createSchoolServer({ bootstrapAdmin });
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '127.0.0.1';
    server.listen(port, host, () => {
        console.log(`School Management System is running at http://${host}:${port}`);
        console.log(`SQLite database: ${path.resolve(process.env.DB_PATH || path.join(ROOT, 'data', 'school.sqlite'))}`);
        if (!bootstrapAdmin) {
            console.log('No admin account configured. Set ADMIN_NAME, ADMIN_USERNAME, ADMIN_EMAIL, and ADMIN_PASSWORD to provision one.');
        }
    });
}

module.exports = { createSchoolServer, hashPassword };
