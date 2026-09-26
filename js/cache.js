// ============================================================================
// Instant UX cache layer (gas-instant-ux skill, Prinsip 2-3-4 adapted for the
// gas-pro-api fetch() architecture — this app has no google.script.run, so
// "cache/state instead of a fresh request" means an in-memory Map backed by
// sessionStorage, with a stale-while-revalidate read helper for GET actions.
//
// NOT used for POST/writes — those always go straight to postData() in
// api.js, unchanged. This module only affects how *reads* are served; it
// never changes what gets saved, validated, or computed on the server.
//
// sessionStorage (not localStorage) on purpose: cached payloads are scoped
// to the logged-in session/token, and should disappear with it rather than
// leak into the next login on a shared computer.
// ============================================================================
import { fetchData } from './api.js';

const mem = new Map(); // cacheKey -> { data, ts }
const PREFIX = 'bw_cache_';

function readSession(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeSession(key, entry) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch (e) {
    // quota exceeded / private-mode — in-memory cache still works for this tab
  }
}

function removeSession(key) {
  try { sessionStorage.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
}

export function cacheKey(action, params) {
  const keys = Object.keys(params || {}).sort();
  const normalized = {};
  keys.forEach((k) => { normalized[k] = params[k]; });
  return `${action}::${JSON.stringify(normalized)}`;
}

/**
 * Read-only cache peek — never touches the network. Used to paint a page
 * instantly (no skeleton) on first mount if a previous visit already has
 * data for this exact action+params.
 */
export function peek(action, params) {
  return peekKey(cacheKey(action, params));
}

export function peekKey(key) {
  let entry = mem.get(key);
  if (!entry) {
    entry = readSession(key);
    if (entry) mem.set(key, entry);
  }
  return entry ? entry.data : undefined;
}

/**
 * Generic stale-while-revalidate primitive, keyed by an arbitrary string
 * (use this when a page needs to cache something more than one raw
 * fetchData() call — e.g. Dashboard's "recent transactions" merges two
 * endpoints into one derived list).
 *  - If cached data exists, `onData(data, false)` fires synchronously right
 *    away (before any network round-trip) so the UI paints instantly.
 *  - `fetcher()` then always runs unless the cache is still within `ttlMs`
 *    and `force` was not requested — when it resolves, `onData` fires again
 *    with `isFresh=true` (even if the value is unchanged; the page
 *    renderers here are cheap to re-run and idempotent).
 *  - Resolves/rejects with fetcher()'s result, so a first-time (no cache)
 *    caller can still `await` it directly.
 */
export async function swr(key, fetcher, onData, opts = {}) {
  const ttlMs = opts.ttlMs ?? 30000;
  let entry = mem.get(key);
  if (!entry) {
    entry = readSession(key);
    if (entry) mem.set(key, entry);
  }

  if (entry && typeof onData === 'function') {
    try { onData(entry.data, false); } catch (e) { console.error(e); }
  }

  if (entry && !opts.force && (Date.now() - entry.ts) < ttlMs) {
    return entry.data;
  }

  const data = await fetcher();
  const fresh = { data, ts: Date.now() };
  mem.set(key, fresh);
  writeSession(key, fresh);
  if (typeof onData === 'function') {
    try { onData(data, true); } catch (e) { console.error(e); }
  }
  return data;
}

/**
 * Stale-while-revalidate for a single plain fetchData(action, params) GET —
 * the common case. See swr() above for the underlying behavior.
 */
export async function fetchSWR(action, params, onData, opts = {}) {
  return swr(cacheKey(action, params), () => fetchData(action, params), onData, opts);
}

/**
 * Drop cached entries so the next read is forced to hit the network again.
 * Call this right after a successful write (save/delete/close period/etc)
 * that affects the given action. With no `params`, every cached variant of
 * that action (different filters/periods) is cleared.
 */
export function invalidate(action, params) {
  if (params === undefined) {
    [...mem.keys()].forEach((k) => { if (k.startsWith(action + '::')) mem.delete(k); });
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith(PREFIX + action + '::'))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch (e) { /* ignore */ }
    return;
  }
  removeSession(cacheKey(action, params));
  mem.delete(cacheKey(action, params));
}

export function invalidateKey(key) {
  mem.delete(key);
  removeSession(key);
}

export function invalidatePrefix(prefix) {
  [...mem.keys()].forEach((k) => { if (k.startsWith(prefix)) mem.delete(k); });
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(PREFIX + prefix))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

export function invalidateAll() {
  mem.clear();
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => sessionStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}
