// ============================================================================
// Login/logout logic, token storage (memory + sessionStorage) and the
// route guard used by router.js.
// Token lives in memory (state.js) and is mirrored to sessionStorage so a
// page refresh keeps the session, but closing the tab/browser clears it
// (sessionStorage, not localStorage) — matches the 12h server-side TTL,
// which slides: the server swaps in a fresh token (envelope `renew`) once the
// current one is a few hours old (api.js hands it to state.js).
//
// Login never throws and never leaves the form stuck: every failure comes back
// as {success:false, message} with a clear Indonesian message.
// ============================================================================
import { postData } from './api.js';
import { getToken, getUser, setSession, clearSession } from './state.js';
import { invalidateAll, invalidateAllExcept, seed } from './cache.js';

// Backend error strings are English; the login form shows Indonesian.
function localizeLoginMessage(message) {
  const m = String(message || '');
  if (/invalid email or password/i.test(m)) return 'Email atau password salah.';
  if (/inactive/i.test(m)) return 'Akun ini dinonaktifkan. Hubungi admin.';
  if (/email and password are required/i.test(m)) return 'Email dan password wajib diisi.';
  return m || 'Login gagal. Silakan coba lagi.';
}

export async function login(email, password) {
  try {
    // silent: the login form shows the message inline (no duplicate toast).
    // retry: a login is safe to repeat (stateless token), so a cold-start
    // hiccup or HTML error page is retried automatically before giving up.
    const res = await postData('login', { email, password }, { silent: true, retry: 2, timeoutMs: 45000 });
    if (res.success && res.data && res.data.token) {
      // A different person may have used this tab before: never show their cached data.
      invalidateAll();
      setSession(res.data.token, res.data.user || null);
      // The login response already carries the first screen's reference data
      // (getLookups) — seed the cache so the app needs no second round trip.
      const lookups = res.data.boot && res.data.boot.lookups;
      if (lookups && typeof lookups === 'object') seed('getLookups', {}, lookups);
      return { success: true, user: res.data.user };
    }
    return { success: false, message: localizeLoginMessage(res.message) };
  } catch (err) {
    return { success: false, message: localizeLoginMessage(err && err.message) };
  }
}

export async function logout() {
  // Fire the server-side revoke WITHOUT making the user wait for it (postData
  // reads the token synchronously, before we clear it below).
  const revoke = postData('logout', {}, { silent: true, retry: 0 }).catch(() => {});
  clearSession();
  invalidateAllExcept(['getLookups::']); // keep only reference data (company logo on the login screen)
  location.hash = '#/login';
  await revoke;
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
