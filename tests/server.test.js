'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSchoolServer } = require('../server');
const { resetAdminPassword } = require('../scripts/reset-admin-password');

test('server startup creates the configured database and serves the application', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'school-startup-'));
    const port = 20000 + Math.floor(Math.random() * 30000);
    const databasePath = path.join(directory, 'school.sqlite');
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.js'], {
        cwd: path.join(__dirname, '..'),
        env: {
            ...process.env,
            DB_PATH: databasePath,
            PORT: String(port),
            ADMIN_NAME: 'CLI Administrator',
            ADMIN_USERNAME: 'cliadmin',
            ADMIN_EMAIL: 'cliadmin@example.test',
            ADMIN_PASSWORD: 'cli-test-password-123'
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const exitPromise = once(child, 'exit');
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    try {
        let health;
        for (let attempt = 0; attempt < 40; attempt += 1) {
            if (child.exitCode !== null) {
                throw new Error(`Server exited before startup: ${stderr}`);
            }
            try {
                const response = await fetch(`http://127.0.0.1:${port}/api/health`);
                if (response.ok) {
                    health = await response.json();
                    break;
                }
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }

        assert.deepEqual(health, { status: 'ok', database: 'connected' });
        assert.equal(fs.existsSync(databasePath), true);

        const homepage = await fetch(`http://127.0.0.1:${port}/`);
        assert.equal(homepage.status, 200);

        const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier: 'cliadmin',
                password: 'cli-test-password-123'
            })
        });
        assert.equal(loginResponse.status, 200);
        assert.equal((await loginResponse.json()).user.role, 'admin');
    } finally {
        if (child.exitCode === null) {
            child.kill();
            await exitPromise;
        }
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

async function withServer(run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'school-api-'));
    const { server, database } = createSchoolServer({
        dbPath: path.join(directory, 'test.sqlite'),
        bootstrapAdmin: {
            fullName: 'Test Administrator',
            username: 'admin',
            email: 'admin@example.test',
            password: 'correct-horse-battery'
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        await run(baseUrl, database);
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

async function login(baseUrl, identifier = 'admin', password = 'correct-horse-battery') {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password })
    });
    const cookie = response.headers.get('set-cookie').split(';', 1)[0];
    return { response, cookie, body: await response.json() };
}

test('health endpoint confirms SQLite is connected', async () => {
    await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/health`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
    });
});

test('administrator password reset updates only the selected admin account', async () => {
    await withServer(async (baseUrl, database) => {
        const originalHash = database.prepare(
            'SELECT password_hash FROM users WHERE username = ?'
        ).get('admin').password_hash;
        const newPassword = 'new-admin-password-123';

        resetAdminPassword(database, 'ADMIN', newPassword);

        const updatedHash = database.prepare(
            'SELECT password_hash FROM users WHERE username = ?'
        ).get('admin').password_hash;
        assert.notEqual(updatedHash, originalHash);
        assert.notEqual(updatedHash, newPassword);

        const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                identifier: 'admin',
                password: 'correct-horse-battery'
            })
        });
        assert.equal(oldLogin.status, 401);
        const newLogin = await login(baseUrl, 'admin', newPassword);
        assert.equal(newLogin.response.status, 200);
        assert.equal(newLogin.body.user.role, 'admin');
    });
});

test('administrator password reset rejects invalid passwords and non-admin accounts', async () => {
    await withServer(async (_baseUrl, database) => {
        assert.throws(
            () => resetAdminPassword(database, 'admin', 'too-short'),
            /between 12 and 128 characters/
        );
        assert.throws(
            () => resetAdminPassword(database, 'missing-admin', 'valid-admin-password'),
            /No administrator account was found/
        );
    });
});

test('login creates an authenticated session and protects student endpoints', async () => {
    await withServer(async (baseUrl) => {
        const denied = await fetch(`${baseUrl}/api/students`);
        assert.equal(denied.status, 401);

        const { response, cookie, body } = await login(baseUrl);
        assert.equal(response.status, 200);
        assert.equal(body.user.role, 'admin');
        assert.match(response.headers.get('set-cookie'), /HttpOnly/);

        const students = await fetch(`${baseUrl}/api/students`, { headers: { Cookie: cookie } });
        assert.equal(students.status, 200);
        assert.deepEqual(await students.json(), []);

        const logout = await fetch(`${baseUrl}/api/auth/logout`, {
            method: 'POST',
            headers: { Cookie: cookie }
        });
        assert.equal(logout.status, 200);
        const afterLogout = await fetch(`${baseUrl}/api/students`, { headers: { Cookie: cookie } });
        assert.equal(afterLogout.status, 401);
    });
});

test('administrators can create teacher and registrar accounts but other roles cannot', async () => {
    await withServer(async (baseUrl) => {
        const { cookie: adminCookie } = await login(baseUrl);
        const createTeacher = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: adminCookie
            },
            body: JSON.stringify({
                fullName: 'Teacher Hana Tesfaye',
                username: 'hana.teacher',
                email: 'hana.teacher@example.test',
                password: 'teacher-password-123',
                role: 'teacher'
            })
        });
        assert.equal(createTeacher.status, 201);
        const created = await createTeacher.json();
        assert.equal(created.user.role, 'teacher');
        assert.equal(created.user.username, 'hana.teacher');
        assert.equal('password' in created.user, false);

        const teacherLogin = await login(baseUrl, 'hana.teacher', 'teacher-password-123');
        assert.equal(teacherLogin.response.status, 200);
        assert.equal(teacherLogin.body.user.role, 'teacher');

        const createRegistrar = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: adminCookie
            },
            body: JSON.stringify({
                fullName: 'Registrar Almaz Bekele',
                username: 'almaz.registrar',
                email: 'almaz.registrar@example.test',
                password: 'registrar-password-123',
                role: 'registrar'
            })
        });
        assert.equal(createRegistrar.status, 201);
        const createdRegistrar = await createRegistrar.json();
        assert.equal(createdRegistrar.user.role, 'registrar');
        assert.equal('password' in createdRegistrar.user, false);

        const registrarLogin = await login(baseUrl, 'almaz.registrar', 'registrar-password-123');
        assert.equal(registrarLogin.response.status, 200);
        assert.equal(registrarLogin.body.user.role, 'registrar');

        const registrations = await fetch(`${baseUrl}/api/registrations`, {
            headers: { Cookie: registrarLogin.cookie }
        });
        assert.equal(registrations.status, 200);
        assert.deepEqual(await registrations.json(), []);

        const forbidden = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: registrarLogin.cookie
            },
            body: JSON.stringify({
                fullName: 'Unauthorized User',
                username: 'unauthorized.user',
                email: 'unauthorized@example.test',
                password: 'password-123'
            })
        });
        assert.equal(forbidden.status, 403);

        const invalidRole = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: adminCookie
            },
            body: JSON.stringify({
                fullName: 'Unauthorized Administrator',
                username: 'unauthorized.admin',
                email: 'unauthorized.admin@example.test',
                password: 'administrator-password-123',
                role: 'admin'
            })
        });
        assert.equal(invalidRole.status, 400);

        const duplicate = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: adminCookie
            },
            body: JSON.stringify({
                fullName: 'Duplicate Teacher',
                username: 'hana.teacher',
                email: 'duplicate@example.test',
                password: 'teacher-password-123'
            })
        });
        assert.equal(duplicate.status, 409);

        const invalidPassword = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: adminCookie
            },
            body: JSON.stringify({
                fullName: 'Another Teacher',
                username: 'another.teacher',
                email: 'another.teacher@example.test',
                password: 'short'
            })
        });
        assert.equal(invalidPassword.status, 400);
    });
});

test('teacher assignments scope section rosters, results, and attendance', async () => {
    await withServer(async (baseUrl) => {
        const { cookie: adminCookie } = await login(baseUrl);
        const teacherResponse = await fetch(`${baseUrl}/api/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
            body: JSON.stringify({
                fullName: 'Section Teacher',
                username: 'section.teacher',
                email: 'section.teacher@example.test',
                password: 'teacher-password-123'
            })
        });
        assert.equal(teacherResponse.status, 201);
        const { user } = await teacherResponse.json();

        for (const student of [
            { studentId: 'SEC-A-1', fullName: 'Student One', grade: 'Grade 9', stream: 'A' },
            { studentId: 'SEC-A-2', fullName: 'Student Two', grade: 'Grade 9', stream: 'A' },
            { studentId: 'SEC-B-1', fullName: 'Student Three', grade: 'Grade 9', stream: 'B' }
        ]) {
            const response = await fetch(`${baseUrl}/api/students`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
                body: JSON.stringify(student)
            });
            assert.equal(response.status, 201);
        }

        const assignmentResponse = await fetch(`${baseUrl}/api/teacher-assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
            body: JSON.stringify({
                teacherId: user.id,
                grade: 'Grade 9',
                stream: 'A',
                subject: 'Mathematics'
            })
        });
        assert.equal(assignmentResponse.status, 201);
        const assignment = (await assignmentResponse.json()).assignment;

        const duplicateAssignment = await fetch(`${baseUrl}/api/teacher-assignments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
            body: JSON.stringify({
                teacherId: user.id,
                grade: 'Grade 9',
                stream: 'A',
                subject: 'Mathematics'
            })
        });
        assert.equal(duplicateAssignment.status, 409);

        const { cookie: teacherCookie } = await login(baseUrl, 'section.teacher', 'teacher-password-123');
        const teacherStudents = await fetch(`${baseUrl}/api/students`, {
            headers: { Cookie: teacherCookie }
        });
        assert.deepEqual(
            (await teacherStudents.json()).map((student) => student.studentId).sort(),
            ['SEC-A-1', 'SEC-A-2']
        );

        const resultBody = {
            studentId: 'SEC-A-1',
            subject: 'Mathematics',
            score: 85,
            grade: 'A',
            term: 'Term 1',
            academicYear: '2026/2027',
            examType: 'Test'
        };
        const permittedResult = await fetch(`${baseUrl}/api/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: teacherCookie },
            body: JSON.stringify(resultBody)
        });
        assert.equal(permittedResult.status, 201);

        const wrongSubject = await fetch(`${baseUrl}/api/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: teacherCookie },
            body: JSON.stringify({ ...resultBody, subject: 'Biology' })
        });
        assert.equal(wrongSubject.status, 403);

        const otherSectionResult = await fetch(`${baseUrl}/api/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: teacherCookie },
            body: JSON.stringify({ ...resultBody, studentId: 'SEC-B-1' })
        });
        assert.equal(otherSectionResult.status, 403);

        const teacherResults = await fetch(`${baseUrl}/api/results`, {
            headers: { Cookie: teacherCookie }
        });
        assert.equal((await teacherResults.json()).length, 1);

        const date = '2026-10-25';
        const sectionAttendance = await fetch(`${baseUrl}/api/attendance/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: teacherCookie },
            body: JSON.stringify({
                date,
                records: [
                    { studentId: 'SEC-A-1', status: 'Present' },
                    { studentId: 'SEC-A-2', status: 'Late' }
                ]
            })
        });
        assert.equal(sectionAttendance.status, 200);
        assert.equal((await sectionAttendance.json()).count, 2);

        const forbiddenAttendance = await fetch(`${baseUrl}/api/attendance/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: teacherCookie },
            body: JSON.stringify({
                date,
                records: [{ studentId: 'SEC-B-1', status: 'Absent' }]
            })
        });
        assert.equal(forbiddenAttendance.status, 403);

        const teacherAttendance = await fetch(`${baseUrl}/api/attendance`, {
            headers: { Cookie: teacherCookie }
        });
        assert.equal((await teacherAttendance.json()).length, 2);

        const removed = await fetch(`${baseUrl}/api/teacher-assignments/${assignment.id}`, {
            method: 'DELETE',
            headers: { Cookie: adminCookie }
        });
        assert.equal(removed.status, 200);
        const noLongerAssigned = await fetch(`${baseUrl}/api/students`, {
            headers: { Cookie: teacherCookie }
        });
        assert.deepEqual(await noLongerAssigned.json(), []);
    });
});

test('local development frontend can authenticate across ports', async () => {
    await withServer(async (baseUrl) => {
        const preflight = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'http://127.0.0.1:5501',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type'
            }
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5501');
        assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

        const response = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: {
                Origin: 'http://127.0.0.1:5501',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ identifier: 'admin', password: 'correct-horse-battery' })
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5501');

        const denied = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'OPTIONS',
            headers: {
                Origin: 'https://untrusted.example',
                'Access-Control-Request-Method': 'POST'
            }
        });
        assert.equal(denied.status, 403);
        assert.equal(denied.headers.get('access-control-allow-origin'), null);
    });
});

test('admission applications persist and approval provisions a student login', async () => {
    await withServer(async (baseUrl) => {
        const application = await fetch(`${baseUrl}/api/registrations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fullName: 'Alem Tesfaye',
                grade: 'Grade 9',
                studentId: '19001',
                gender: 'Female',
                hasDisability: 'No',
                phone: '+251900000000',
                email: 'alem@example.test',
                address: 'Addis Ababa'
            })
        });
        assert.equal(application.status, 201);
        const { id } = await application.json();
        const { cookie } = await login(baseUrl);
        const unrelatedStudent = await fetch(`${baseUrl}/api/students`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                studentId: 'OTHER-1',
                fullName: 'Other Student',
                grade: 'Grade 10'
            })
        });
        assert.equal(unrelatedStudent.status, 201);
        const pending = await fetch(`${baseUrl}/api/registrations?status=Pending`, {
            headers: { Cookie: cookie }
        });
        assert.equal((await pending.json())[0].id, id);

        const approved = await fetch(`${baseUrl}/api/registrations/${id}/review`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                status: 'Approved',
                username: 'alem.tesfaye',
                temporaryPassword: 'initial-password-123'
            })
        });
        assert.equal(approved.status, 200);
        assert.equal((await approved.json()).studentId, '19001');

        const studentLogin = await login(baseUrl, 'alem.tesfaye', 'initial-password-123');
        assert.equal(studentLogin.response.status, 200);
        assert.equal(studentLogin.body.user.role, 'student');

        const ownProfile = await fetch(`${baseUrl}/api/students`, {
            headers: { Cookie: studentLogin.cookie }
        });
        assert.equal(ownProfile.status, 200);
        const students = await ownProfile.json();
        assert.equal(students.length, 1);
        assert.equal(students[0].studentId, '19001');

        const allAttendance = await fetch(`${baseUrl}/api/attendance`, {
            headers: { Cookie: studentLogin.cookie }
        });
        assert.equal(allAttendance.status, 200);
        assert.deepEqual(await allAttendance.json(), []);
    });
});

test('student portal data is limited to the signed-in student and staff actions stay forbidden', async () => {
    await withServer(async (baseUrl) => {
        const { cookie: adminCookie } = await login(baseUrl);

        async function createStudent(studentId, fullName, username) {
            const application = await fetch(`${baseUrl}/api/registrations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fullName,
                    grade: 'Grade 10',
                    studentId,
                    gender: 'Female',
                    hasDisability: 'No',
                    phone: '+251900000000',
                    email: `${username}@example.test`,
                    address: 'Addis Ababa'
                })
            });
            assert.equal(application.status, 201);
            const { id } = await application.json();

            const approval = await fetch(`${baseUrl}/api/registrations/${id}/review`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Cookie: adminCookie
                },
                body: JSON.stringify({
                    status: 'Approved',
                    username,
                    temporaryPassword: 'student-password-123'
                })
            });
            assert.equal(approval.status, 200);

            const studentLogin = await login(baseUrl, username, 'student-password-123');
            assert.equal(studentLogin.response.status, 200);
            assert.equal(studentLogin.body.user.role, 'student');
            return studentLogin.cookie;
        }

        const firstStudentCookie = await createStudent('STU-1001', 'Sara Bekele', 'sara.student');
        await createStudent('STU-1002', 'Dawit Alemu', 'dawit.student');

        for (const studentId of ['STU-1001', 'STU-1002']) {
            const headers = {
                'Content-Type': 'application/json',
                Cookie: adminCookie
            };

            const attendance = await fetch(`${baseUrl}/api/attendance`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    studentId,
                    date: '2026-10-20',
                    status: 'Present'
                })
            });
            assert.equal(attendance.status, 201);

            const fee = await fetch(`${baseUrl}/api/fees`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    studentId,
                    amount: 5000,
                    amountPaid: 1000,
                    dueDate: '2026-11-01',
                    paymentDate: '2026-10-20',
                    paymentMethod: 'Cash'
                })
            });
            assert.equal(fee.status, 201);

            const result = await fetch(`${baseUrl}/api/results`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    studentId,
                    subject: 'Mathematics',
                    score: studentId === 'STU-1001' ? 88 : 72,
                    grade: studentId === 'STU-1001' ? 'A' : 'B',
                    term: 'Term 1',
                    academicYear: '2026/2027',
                    examType: 'Midterm'
                })
            });
            assert.equal(result.status, 201);
        }

        const profileResponse = await fetch(`${baseUrl}/api/students`, {
            headers: { Cookie: firstStudentCookie }
        });
        assert.equal(profileResponse.status, 200);
        assert.deepEqual(
            (await profileResponse.json()).map((student) => student.studentId),
            ['STU-1001']
        );

        for (const endpoint of ['results', 'attendance', 'fees']) {
            const response = await fetch(`${baseUrl}/api/${endpoint}`, {
                headers: { Cookie: firstStudentCookie }
            });
            assert.equal(response.status, 200);
            const records = await response.json();
            assert.equal(records.length, 1);
            assert.equal(records[0].studentId, 'STU-1001');
        }

        const users = await fetch(`${baseUrl}/api/users`, {
            headers: { Cookie: firstStudentCookie }
        });
        assert.equal(users.status, 403);

        const staffActions = [
            ['students', { studentId: 'STU-1002', fullName: 'Unauthorized Student', grade: 'Grade 10' }],
            ['attendance', { studentId: 'STU-1002', date: '2026-10-21', status: 'Present' }],
            ['fees', {
                studentId: 'STU-1002',
                amount: 100,
                amountPaid: 0,
                dueDate: '2026-11-01'
            }],
            ['results', {
                studentId: 'STU-1002',
                subject: 'Mathematics',
                score: 100,
                grade: 'A+',
                term: 'Term 1',
                academicYear: '2026/2027',
                examType: 'Midterm'
            }]
        ];

        for (const [endpoint, body] of staffActions) {
            const forbiddenAction = await fetch(`${baseUrl}/api/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Cookie: firstStudentCookie
                },
                body: JSON.stringify(body)
            });
            assert.equal(forbiddenAction.status, 403);
        }
    });
});

test('online registration accepts the frontend multipart form', async () => {
    await withServer(async (baseUrl) => {
        const form = new FormData();
        form.set('fullName', 'Dawit Alemu');
        form.set('grade', 'Grade 11');
        form.set('stream', 'Natural Science');
        form.set('gender', 'Male');
        form.set('hasDisability', 'No');
        form.set('phone', '+251922222222');
        form.set('email', 'dawit@example.test');
        form.set('guardianPhone', '+251933333333');
        form.set('address', 'Addis Ababa');

        const response = await fetch(`${baseUrl}/api/registrations`, {
            method: 'POST',
            body: form
        });
        assert.equal(response.status, 201);
        assert.equal((await response.json()).success, true);
    });
});

test('registration documents are stored and only available to registration staff', async () => {
    await withServer(async (baseUrl) => {
        const form = new FormData();
        form.set('fullName', 'Hana Tesfaye');
        form.set('grade', 'Grade 10');
        form.set('gender', 'Female');
        form.set('hasDisability', 'No');
        form.set('phone', '+251911111111');
        form.set('address', 'Bahir Dar');
        form.append(
            'documents',
            new Blob(['%PDF-1.7\napplication document'], { type: 'application/pdf' }),
            'admission.pdf'
        );

        const submission = await fetch(`${baseUrl}/api/registrations`, {
            method: 'POST',
            body: form
        });
        assert.equal(submission.status, 201);
        const { id } = await submission.json();

        const unauthenticated = await fetch(`${baseUrl}/api/registrations`);
        assert.equal(unauthenticated.status, 401);

        const { cookie } = await login(baseUrl);
        const applications = await fetch(`${baseUrl}/api/registrations`, {
            headers: { Cookie: cookie }
        });
        assert.equal(applications.status, 200);
        const [application] = await applications.json();
        assert.equal(application.id, id);
        assert.deepEqual(application.documents.map(({ name, contentType }) => ({ name, contentType })), [
            { name: 'admission.pdf', contentType: 'application/pdf' }
        ]);

        const documentUrl = new URL(application.documents[0].url, baseUrl);
        const documentResponse = await fetch(documentUrl, {
            headers: { Cookie: cookie }
        });
        assert.equal(documentResponse.status, 200);
        assert.equal(documentResponse.headers.get('content-type'), 'application/pdf');
        assert.match(documentResponse.headers.get('content-disposition'), /admission\.pdf/);
        assert.equal(await documentResponse.text(), '%PDF-1.7\napplication document');

        const deniedDocument = await fetch(documentUrl);
        assert.equal(deniedDocument.status, 401);
    });
});

test('registration rejects document files with unsupported content', async () => {
    await withServer(async (baseUrl) => {
        const form = new FormData();
        form.set('fullName', 'Hana Tesfaye');
        form.set('grade', 'Grade 10');
        form.set('gender', 'Female');
        form.set('hasDisability', 'No');
        form.set('phone', '+251911111111');
        form.set('address', 'Bahir Dar');
        form.append('documents', new Blob(['not a PDF']), 'document.pdf');

        const response = await fetch(`${baseUrl}/api/registrations`, {
            method: 'POST',
            body: form
        });
        assert.equal(response.status, 415);
        assert.match((await response.json()).message, /invalid or damaged/);
    });
});

test('backend serves the site from the same origin and does not expose its source', async () => {
    await withServer(async (baseUrl) => {
        const home = await fetch(`${baseUrl}/`);
        assert.equal(home.status, 200);
        assert.match(home.headers.get('content-type'), /text\/html/);
        assert.match(await home.text(), /School Management System/);

        const source = await fetch(`${baseUrl}/server.js`);
        assert.equal(source.status, 404);
    });
});

test('student, attendance, fee, and result records round-trip through SQLite', async () => {
    await withServer(async (baseUrl) => {
        const { cookie } = await login(baseUrl);
        const studentResponse = await fetch(`${baseUrl}/api/students`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                studentId: 'S-1001',
                fullName: 'Sara Bekele',
                grade: 'Grade 10',
                gender: 'Female',
                phone: '+251911111111'
            })
        });
        assert.equal(studentResponse.status, 201);

        const attendanceResponse = await fetch(`${baseUrl}/api/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ studentId: 'S-1001', date: '2026-10-20', status: 'Present' })
        });
        assert.equal(attendanceResponse.status, 201);
        const attendance = await fetch(`${baseUrl}/api/attendance`, { headers: { Cookie: cookie } });
        assert.equal((await attendance.json())[0].studentId, 'S-1001');

        const feeResponse = await fetch(`${baseUrl}/api/fees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                studentId: 'S-1001', amount: 5000, amountPaid: 1000,
                dueDate: '2026-11-01', paymentDate: '2026-10-20', paymentMethod: 'Cash'
            })
        });
        assert.equal(feeResponse.status, 201);
        const fees = await fetch(`${baseUrl}/api/fees`, { headers: { Cookie: cookie } });
        const [fee] = await fees.json();
        assert.equal(fee.balance, 4000);
        assert.equal(fee.status, 'Partial');

        const resultResponse = await fetch(`${baseUrl}/api/results`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({
                studentId: 'S-1001', subject: 'Mathematics', score: 88,
                grade: 'A', term: 'Term 1', academicYear: '2026/2027', examType: 'Midterm'
            })
        });
        assert.equal(resultResponse.status, 201);
        const results = await fetch(`${baseUrl}/api/results`, { headers: { Cookie: cookie } });
        assert.equal((await results.json())[0].score, 88);

        const invalidAttendance = await fetch(`${baseUrl}/api/attendance`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: cookie },
            body: JSON.stringify({ studentId: 'S-1001', date: '2026-02-31', status: 'Present' })
        });
        assert.equal(invalidAttendance.status, 400);
    });
});

test('enquiries are saved and invalid emails are rejected', async () => {
    await withServer(async (baseUrl) => {
        const invalid = await fetch(`${baseUrl}/api/enquiries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'A Name', email: 'bad-address', subject: 'Question', message: 'Hello' })
        });
        assert.equal(invalid.status, 400);

        const valid = await fetch(`${baseUrl}/api/enquiries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'A Name', email: 'a@example.test', subject: 'Question', message: 'Hello' })
        });
        assert.equal(valid.status, 201);
        assert.equal((await valid.json()).success, true);
    });
});
