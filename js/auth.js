// ============================================================================
// Login/logout logic, token storage (memory + sessionStorage) and the
// route guard used by router.js.
// Token lives in memory (state.js) and is mirrored to sessionStorage so a
// page refresh keeps the session, but closing the tab/browser clears it
// (sessionStorage, not localStorage) — matches the 12h server-side TTL,
// which is refreshed on activity by the backend on every authenticated call.
// ============================================================================
import { postData } from './api.js';
import { getToken, getUser, setSession, clearSession } from './state.js';

export async function login(email, password) {
  const res = await postData('login', { email, password });
  if (res.success && res.data && res.data.token) {
    setSession(res.data.token, res.data.user || null);
    return { success: true, user: res.data.user };
  }
  return { success: false, message: res.message || 'Email atau password salah.' };
}

export async function logout() {
  try { await postData('logout', {}); } catch (e) { /* best-effort */ }
  clearSession();
  location.hash = '#/login';
}

export function isAuthenticated() {
  return Boolean(getToken());
}

export function currentUser() {
  return getUser();
}

/** Route guard: returns true if navigation may proceed. */
export function requireAuth() {
  if (isAuthenticated()) return true;
  location.hash = '#/login';
  return false;
}
