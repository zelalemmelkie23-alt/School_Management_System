```javascript
(function () {
  'use strict';

  // =========================================================
  // CONFIGURATION
  // =========================================================

  const API_BASE = '/api';
  const SESSION_KEY = 'current_user';

  // Only keep data in localStorage that actually belongs there.
  // Students, fees, attendance, and results are stored on the backend.
  const STORAGE_KEYS = {
    currentUser: SESSION_KEY
  };

  // =========================================================
  // API REQUEST HELPER
  // =========================================================

  async function request(path, options = {}) {
    const controller = new AbortController();

    // Stop waiting after 10 seconds
    const timeout = setTimeout(() => {
      controller.abort();
    }, 10000);

    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: options.method || 'GET',

        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },

        body: options.body,

        signal: controller.signal

      if (!user) {
        return null;
      }

      return JSON.parse(user);

    } catch (error) {
      console.error('Unable to read current user:', error);

      // Remove corrupted session data
      localStorage.removeItem(STORAGE_KEYS.currentUser);

      return null;
    }
  }

  function setCurrentUser(user) {
    if (!user) {
      return false;
    }

    try {
      localStorage.setItem(
        STORAGE_KEYS.currentUser,
        JSON.stringify(user)
      );

      return true;

    } catch (error) {
      console.error('Unable to save current user:', error);
      return false;
    }
  }

  function clearCurrentUser() {
    localStorage.removeItem(STORAGE_KEYS.currentUser);
  }

  // =========================================================
  // LOGIN
  // =========================================================

  async function loginUser(identifier, password) {
    // Basic frontend validation
    if (!identifier || !password) {
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
          message: 'Invalid response from the server.'
        };
      }

      setCurrentUser(result.user);

      return {
        success: true,
        user: result.user
      };

    } catch (error) {
      console.error('Login error:', error);

      return {
        success: false,
        message: error.message
      };
    }
  }

  // =========================================================
  // SIGN UP
  // =========================================================

  async function signupUser(data) {
    if (!data || typeof data !== 'object') {
      return {
        success: false,
        message: 'Invalid registration data.'
      };
    }

    try {
      const result = await request('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(data)
      });

      if (!result || !result.user) {
        return {
          success: false,
          message: 'Invalid response from the server.'
        };
      }

      setCurrentUser(result.user);

      return {
        success: true,
        user: result.user
      };

    } catch (error) {
      console.error('Signup error:', error);

      return {
        success: false,
        message: error.message
      };
    }
  }

  // =========================================================
  // AUTHENTICATION CHECK
  // =========================================================

  function requireAuth(expectedRole) {
    const user = getCurrentUser();

    // User is not logged in
    if (!user) {
      window.location.href = 'login.html';
      return null;
    }

    // Check specific role if requested
    if (expectedRole && user.role !== expectedRole) {
      redirectByRole();
      return null;
    }

    return user;
  }

  // =========================================================
  // ROLE-BASED REDIRECTION
  // =========================================================

  function redirectByRole() {
    const user = getCurrentUser();

    if (!user) {
      window.location.href = 'login.html';
      return;
    }

    switch (user.role) {
      case 'admin':
        window.location.href = 'dashboard.html';
        break;

      case 'teacher':
        window.location.href = 'teacher-portal.html';
        break;

      case 'student':
        window.location.href = 'student-portal.html';
        break;

      default:
        console.error('Unknown user role:', user.role);

        clearCurrentUser();

        window.location.href = 'login.html';
    }
  }

  // =========================================================
  // LOGOUT
  // =========================================================

  function logoutUser() {
    clearCurrentUser();
    window.location.href = 'login.html';
  }

  // =========================================================
  // ROLE CHECK HELPER
  // =========================================================

  function hasRole(role) {
    const user = getCurrentUser();

    return Boolean(user && user.role === role);
  }

  // =========================================================
  // EXPORT FUNCTIONS
  // =========================================================

  window.SchoolApp = {
    // Configuration
    API_BASE,
    STORAGE_KEYS,

    // Users
    getUsers,

    // Students
    getStudents,
    addStudent,
    updateStudent,
    deleteStudent,

    // Attendance
    getAttendance,
    addAttendance,

    // Fees
    getFees,
    addFee,

    // Results
    getResults,
    addResult,

    // Authentication
    loginUser,
    signupUser,
    logoutUser,

    // Current user
    getCurrentUser,
    setCurrentUser,
    clearCurrentUser,

    // Authorization
    requireAuth,
    redirectByRole,
    hasRole
  };

})();
```

### What I improved

**1. Better login errors**

Your old code:

```js
catch (error) {
  return null;
}
```

hid the actual problem.

Now it returns:

```js
{
  success: false,
  message: error.message
}
```

So your login page can show the user what went wrong.

**2. Server timeout**

The new code stops waiting after **10 seconds**.

If your Node.js server is not running, the user gets a useful message instead of waiting indefinitely.

**3. Removed unnecessary localStorage keys**

Your old code had:

```js
users
students
attendance
fees
results
```

inside `STORAGE_KEYS`.

But those records are supposed to come from your backend.

Now only the logged-in user is stored:

```js
const STORAGE_KEYS = {
  currentUser: 'current_user'
};
```

**4. Added logout**

You can now use:

```js
SchoolApp.logoutUser();
```

from your logout button.

For example:

```html
<button onclick="SchoolApp.logoutUser()">
  Logout
</button>
```

**5. Added `hasRole()`**

You can check:

```js
if (SchoolApp.hasRole('admin')) {
  console.log('This user is an admin');
}
```

**6. Better role handling**

Instead of several `if/else` statements, I used:

```js
switch (user.role)
```

and added handling for an unknown role.

**7. Student ID validation**

These functions now check that an ID exists:

```js
updateStudent(id, student)
deleteStudent(id)
```

This prevents accidental requests such as:

```text
/api/students/undefined
```

### Important

This improved `app.js` is the **frontend side**. It does **not** replace your Node.js backend.

Your backend still needs to provide these routes:

```text
POST   /api/auth/login
POST   /api/auth/signup

GET    /api/users

GET    /api/students
POST   /api/students
PUT    /api/students/:id
DELETE /api/students/:id

GET    /api/attendance
POST   /api/attendance

GET    /api/fees
POST   /api/fees

GET    /api/results
POST   /api/results
```

Also, **do not consider `localStorage` role checking as real security**. Your Express backend must check authentication and authorization before allowing sensitive operations such as deleting students or modifying fees/results.

If you send me your **`index.js` / `server.js` backend code**, I can rewrite that next so it matches this improved `app.js` exactly.

