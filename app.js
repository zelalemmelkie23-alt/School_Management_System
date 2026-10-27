(function () {
    'use strict';

    // =====================================================
    // CONFIGURATION
    // =====================================================

    const isLocalDevelopmentHost =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '[::1]';
    const API_BASE =
        isLocalDevelopmentHost && window.location.port !== '3000'
            ? window.location.protocol + '//' + window.location.hostname + ':3000/api'
            : '/api';
    const SESSION_KEY = 'current_user';

    const STORAGE_KEYS = {
        currentUser: SESSION_KEY,
        students: 'students'
    };

    // =====================================================
    // API REQUEST HELPER
    // =====================================================

    async function request(path, options = {}) {
        const controller = new AbortController();

        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 10000);

        const headers = {
            ...(options.headers || {})
        };

        const requestOptions = {
            method: options.method || 'GET',
            headers,
            signal: controller.signal,

            // Supports same-origin cookie sessions if your
            // backend has been configured to use them.
            credentials: 'include'
        };

        if (options.body !== undefined) {
            const isFormData =
                typeof FormData !== 'undefined' &&
                options.body instanceof FormData;

            if (
                !isFormData &&
                !headers['Content-Type'] &&
                !headers['content-type']
            ) {
                headers['Content-Type'] = 'application/json';
            }

            requestOptions.body = options.body;
        }

        try {
            const response = await fetch(
                API_BASE + path,
                requestOptions
            );

            const contentType =
                response.headers.get('content-type') || '';

            let result = null;

            if (contentType.includes('application/json')) {
                result = await response.json().catch(() => null);
            } else {
                const responseText =
                    await response.text().catch(() => '');

                if (responseText) {
                    result = { message: responseText };
                }
            }

            if (!response.ok) {
                const error = new Error(
                    result?.message ||
                    'Request failed (' + response.status + ').'
                );

                error.status = response.status;
                throw error;
            }

            return result;

        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(
                    'The server took too long to respond. Please try again.'
                );
            }

            if (error instanceof TypeError) {
                throw new Error(
                    'Cannot connect to the server. Check that the backend is running.'
                );
            }

            throw error;

        } finally {
            clearTimeout(timeoutId);
        }
    }

    // =====================================================
    // CURRENT USER DISPLAY INFORMATION
    // =====================================================

    // IMPORTANT:
    // localStorage can be changed by the user.
    // It is NOT proof of authentication.
    // The backend must protect every private API endpoint.

    function safeUserForStorage(user) {
        if (!user || typeof user !== 'object') {
            return null;
        }

        return {
            id: user.id ?? user.userId ?? null,

            fullName:
                typeof user.fullName === 'string'
                    ? user.fullName
                    : '',

            username:
                typeof user.username === 'string'
                    ? user.username
                    : '',

            email:
                typeof user.email === 'string'
                    ? user.email
                    : '',

            studentId:
                typeof (user.studentId ?? user.student_id) === 'string'
                    ? user.studentId ?? user.student_id
                    : null,

            role:
                typeof user.role === 'string'
                    ? user.role.trim().toLowerCase().replace(/[\s-]+/g, '_')
                    : ''
        };
    }

    function getCurrentUser() {
        const storedUser =
            localStorage.getItem(STORAGE_KEYS.currentUser);

        if (!storedUser) {
            return null;
        }

        try {
            const user = JSON.parse(storedUser);

            if (
                !user ||
                typeof user !== 'object' ||
                typeof user.role !== 'string'
            ) {
                clearCurrentUser();
                return null;
            }

            return user;

        } catch (error) {
            console.warn(
                'Unable to read current-user information:',
                error
            );

            clearCurrentUser();
            return null;
        }
    }

    function setCurrentUser(user) {
        const safeUser = safeUserForStorage(user);

        if (!safeUser || !safeUser.role) {
            return false;
        }

        try {
            localStorage.setItem(
                STORAGE_KEYS.currentUser,
                JSON.stringify(safeUser)
            );

            return true;

        } catch (error) {
            console.warn(
                'Unable to save current-user information:',
                error
            );

            return false;
        }
    }

    function clearCurrentUser() {
        localStorage.removeItem(STORAGE_KEYS.currentUser);
    }

    // =====================================================
    // USERS
    // =====================================================

    function getUsers() {
        // The backend must restrict this endpoint to authorized staff.
        return request('/users');
    }

    function createTeacherAccount(account) {
        return request('/users', {
            method: 'POST',
            body: JSON.stringify(account)
        });
    }

    // =====================================================
    // STUDENTS
    // =====================================================

    function getStudents() {
        return request('/students');
    }

    function addStudent(student) {
        return request('/students', {
            method: 'POST',
            body: JSON.stringify(student)
        });
    }

    function updateStudent(studentId, student) {
        return request(
            '/students/' + encodeURIComponent(studentId),
            {
                method: 'PUT',
                body: JSON.stringify(student)
            }
        );
    }

    function deleteStudent(studentId) {
        return request(
            '/students/' + encodeURIComponent(studentId),
            {
                method: 'DELETE'
            }
        );
    }

    // =====================================================
    // ONLINE STUDENT REGISTRATION
    // =====================================================

    // Backend contract: POST /registrations accepts multipart data and
    // creates Pending applications; GET returns pending applications;
    // PATCH /registrations/:id edits an application; PATCH
    // /registrations/:id/review applies a decision and creates an account
    // on approval. These endpoints must enforce authorization and validation.

    function submitStudentRegistration(formData) {
        if (
            typeof FormData === 'undefined' ||
            !(formData instanceof FormData)
        ) {
            throw new TypeError('Registration data must be submitted as FormData.');
        }

        return request('/registrations', {
            method: 'POST',
            body: formData
        });
    }

    async function getPendingRegistrations() {
        const result = await request('/registrations?status=Pending');
        const registrations = Array.isArray(result)
            ? result
            : result?.registrations;

        if (!Array.isArray(registrations)) {
            throw new Error(
                'The server returned an invalid registration list.'
            );
        }

        return registrations;
    }

    function updatePendingRegistration(registrationId, changes) {
        if (
            typeof registrationId !== 'string' &&
            typeof registrationId !== 'number'
        ) {
            throw new TypeError('A valid registration ID is required.');
        }

        if (!changes || typeof changes !== 'object') {
            throw new TypeError('Registration changes are required.');
        }

        return request(
            '/registrations/' + encodeURIComponent(String(registrationId)),
            {
                method: 'PATCH',
                body: JSON.stringify(changes)
            }
        );
    }

    function reviewStudentRegistration(registrationId, review) {
        if (
            typeof registrationId !== 'string' &&
            typeof registrationId !== 'number'
        ) {
            throw new TypeError('A valid registration ID is required.');
        }

        if (!review || !['Approved', 'Rejected'].includes(review.status)) {
            throw new TypeError(
                'Registration status must be Approved or Rejected.'
            );
        }

        return request(
            '/registrations/' +
                encodeURIComponent(String(registrationId)) +
                '/review',
            {
                method: 'PATCH',
                body: JSON.stringify(review)
            }
        );
    }

    // =====================================================
    // ATTENDANCE
    // =====================================================

    function getAttendance() {
        return request('/attendance');
    }

    function addAttendance(record) {
        return request('/attendance', {
            method: 'POST',
            body: JSON.stringify(record)
        });
    }

    // =====================================================
    // FEES
    // =====================================================

    function getFees() {
        return request('/fees');
    }

    function addFee(fee) {
        return request('/fees', {
            method: 'POST',
            body: JSON.stringify(fee)
        });
    }

    // =====================================================
    // RESULTS
    // =====================================================

    function getResults() {
        return request('/results');
    }

    function addResult(result) {
        return request('/results', {
            method: 'POST',
            body: JSON.stringify(result)
        });
    }

    // =====================================================
    // LOGIN
    // =====================================================

    async function loginUser(identifier, password) {
        if (
            typeof identifier !== 'string' ||
            !identifier.trim() ||
            typeof password !== 'string' ||
            !password
        ) {
            return {
                success: false,
                message: 'Username/email and password are required.'
            };
        }

        try {
            const result = await request('/auth/login', {
                method: 'POST',

                body: JSON.stringify({
                    identifier: identifier.trim(),
                    password
                })
            });

            if (!result || !result.user) {
                return {
                    success: false,
                    message:
                        result?.message ||
                        'The server returned an unexpected login response.'
                };
            }

            // The backend should create the actual session.
            // This stores only a small profile for display purposes.
            setCurrentUser(result.user);

            return {
                success: true,
                user: safeUserForStorage(result.user),
                message: result.message || 'Login successful.'
            };

        } catch (error) {
            console.error('Login request failed:', error);

            return {
                success: false,
                message:
                    error.message ||
                    'Login failed. Please try again.'
            };
        }
    }

    // =====================================================
    // STUDENT SIGNUP
    // =====================================================

    // Public registration does not send a role.
    // The backend MUST assign role="student" and reject
    // public attempts to create privileged accounts.

    async function signupUser(data) {
        if (!data || typeof data !== 'object') {
            return {
                success: false,
                message: 'Invalid registration data.'
            };
        }

        const fullName =
            typeof data.fullName === 'string'
                ? data.fullName.trim()
                : '';

        const username =
            typeof data.username === 'string'
                ? data.username.trim()
                : '';

        const email =
            typeof data.email === 'string'
                ? data.email.trim()
                : '';

        const password =
            typeof data.password === 'string'
                ? data.password
                : '';

        if (!fullName || !username || !email || !password) {
            return {
                success: false,
                message: 'Please complete all required fields.'
            };
        }

        if (fullName.length < 2 || fullName.length > 100) {
            return {
                success: false,
                message: 'Full name must be between 2 and 100 characters.'
            };
        }

        if (!/^[A-Za-z0-9._-]{3,30}$/.test(username)) {
            return {
                success: false,
                message:
                    'Username must be 3–30 characters and use only letters, numbers, dots, underscores, or hyphens.'
            };
        }

        if (
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return {
                success: false,
                message: 'Please enter a valid email address.'
            };
        }

        if (password.length < 8 || password.length > 128) {
            return {
                success: false,
                message: 'Password must be between 8 and 128 characters.'
            };
        }

        try {
            const result = await request('/auth/signup', {
                method: 'POST',

                // Do not accept or send a role from the public form.
                body: JSON.stringify({
                    fullName,
                    username,
                    email,
                    password
                })
            });

            // Expected response:
            // { "success": true, "message": "Account created." }

            if (!result || result.success !== true) {
                return {
                    success: false,
                    message:
                        result?.message ||
                        'The server did not confirm account creation.'
                };
            }

            // Registration does not automatically log the user in.
            return {
                success: true,
                message:
                    result.message ||
                    'Account created successfully. Please log in.'
            };

        } catch (error) {
            console.error('Signup request failed:', error);

            return {
                success: false,
                message:
                    error.message ||
                    'Registration failed. Please try again.'
            };
        }
    }

    // =====================================================
    // AUTHENTICATION CHECK
    // =====================================================

    function requireAuth(expectedRole) {
        const user = getCurrentUser();

        if (!user) {
            window.location.href = 'login.html';
            return null;
        }

        if (expectedRole) {
            const allowedRoles = (Array.isArray(expectedRole)
                ? expectedRole
                : [expectedRole])
                .map(function (role) {
                    return String(role).trim().toLowerCase().replace(/[\s-]+/g, '_');
                });
            const currentRole = String(user.role)
                .trim()
                .toLowerCase()
                .replace(/[\s-]+/g, '_');

            if (!allowedRoles.includes(currentRole)) {
                redirectByRole();
                return null;
            }
        }

        // This is only a frontend navigation check.
        // The backend must verify the real session too.
        return user;
    }

    // =====================================================
    // ROLE-BASED REDIRECTION
    // =====================================================

    function redirectByRole() {
        const user = getCurrentUser();

        if (!user) {
            window.location.href = 'login.html';
            return;
        }

        const rolePages = {
            admin: 'dashboard.html',
            super_admin: 'dashboard.html',
            school_admin: 'dashboard.html',
            director: 'dashboard.html',
            principal: 'dashboard.html',
            registrar: 'registration-review.html',
            teacher: 'teacher-portal.html',
            student: 'student-portal.html'
        };

        const role = String(user.role)
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
        const destination = rolePages[role];

        if (!destination) {
            clearCurrentUser();
            window.location.href = 'login.html';
            return;
        }

        window.location.href = destination;
    }

    // =====================================================
    // LOGOUT
    // =====================================================

    async function logoutUser() {
        try {
            // Your backend must implement POST /api/auth/logout
            // to destroy the server-side session.
            await request('/auth/logout', {
                method: 'POST'
            });

        } catch (error) {
            console.warn(
                'Could not confirm server logout:',
                error.message
            );

        } finally {
            clearCurrentUser();
            window.location.href = 'login.html';
        }
    }

    // =====================================================
    // ROLE CHECK
    // =====================================================

    function hasRole(role) {
        const user = getCurrentUser();
        const currentRole = user && typeof user.role === 'string'
            ? user.role.trim().toLowerCase().replace(/[\s-]+/g, '_')
            : '';
        const expectedRole = String(role)
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');

        return Boolean(currentRole && currentRole === expectedRole);
    }

    // =====================================================
    // EXPORT FUNCTIONS
    // =====================================================

    window.SchoolApp = {
        API_BASE,
        STORAGE_KEYS,

        getUsers,
        createTeacherAccount,

        getStudents,
        addStudent,
        updateStudent,
        deleteStudent,

        submitStudentRegistration,
        getPendingRegistrations,
        updatePendingRegistration,
        reviewStudentRegistration,

        getAttendance,
        addAttendance,

        getFees,
        addFee,

        getResults,
        addResult,

        loginUser,
        signupUser,
        logoutUser,

        getCurrentUser,
        setCurrentUser,
        clearCurrentUser,

        requireAuth,
        redirectByRole,
        hasRole
    };

})();
