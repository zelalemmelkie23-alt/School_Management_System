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
    currentUser: SESSION_KEY,
    students: 'students'
  };

  // =========================================================
  // API REQUEST HELPER
  // =========================================================

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(API_BASE + path, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        body: options.body,
        signal: controller.signal
      });
      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.message || 'Request failed (' + response.status + ').');
      }

      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('The server took too long to respond. Please try again.');
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function getCurrentUser() {
    const storedUser = localStorage.getItem(STORAGE_KEYS.currentUser);
    if (!storedUser) return null;

    try {
      return JSON.parse(storedUser);
    } catch (error) {
      console.error('Unable to read current user:', error);
      clearCurrentUser();
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

  function getUsers() {
    return request('/users');
  }

  function getStudents() {
    return request('/students');
  }

  function addStudent(student) {
    return request('/students', { method: 'POST', body: JSON.stringify(student) });
  }

  function updateStudent(studentId, student) {
    return request('/students/' + encodeURIComponent(studentId), {
      method: 'PUT',
      body: JSON.stringify(student)
    });
  }

  function deleteStudent(studentId) {
    return request('/students/' + encodeURIComponent(studentId), { method: 'DELETE' });
  }

  function getAttendance() {
    return request('/attendance');
  }

  function addAttendance(record) {
    return request('/attendance', { method: 'POST', body: JSON.stringify(record) });
  }

  function getFees() {
    return request('/fees');
  }

  function addFee(fee) {
    return request('/fees', { method: 'POST', body: JSON.stringify(fee) });
  }

  function getResults() {
    return request('/results');
  }

  function addResult(result) {
    return request('/results', { method: 'POST', body: JSON.stringify(result) });
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

