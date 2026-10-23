// ============================================================================
// fetch() helpers — the ONLY place that talks to the GAS backend.
// Follows gas-pro-api CRITICAL RULES:
//   - GET reads:  ?action=X&token=...&...params   (query string, cached lookups)
//   - POST writes: JSON body {action, token, data}, header text/plain;charset=utf-8
//                  (avoids a CORS preflight against Apps Script, which cannot
//                  answer OPTIONS requests).
//   - Never google.script.run — this frontend is hosted off-origin (GitHub Pages).
//   - Every failure surfaces a toast; callers still get the raw envelope back
//     so pages can show inline field errors when the backend sends one.
//
// Resilience (gas-instant-ux-pro, Prinsip 8) — fix for the login error
// "Unexpected token '<' ... is not valid JSON": when Google serves an HTML page
// instead of our JSON (sign-in page, error/quota page, script not found, cold
// instance hiccup) the old code called res.json() blindly and showed the raw
// SyntaxError. Now every response is read as TEXT first and then parsed:
//   - HTML is recognised, classified and turned into a clear Indonesian
//     message (with the HTTP status; a short snippet goes to the console);
//   - transient failures (network, timeout, HTML error page, HTTP 5xx) are
//     retried automatically — reads up to 3x, writes only because every write
//     carries a reqId the server uses to de-duplicate (so a retry can never
//     save twice);
//   - every request has a timeout (AbortController), so nothing hangs forever;
//   - the app never crashes: fetchData throws a normal Error, postData always
//     resolves with {success:false, message, code}.
// Response shape/URL/actions are unchanged; the server's extra fields (ms, v,
// renew, code, replayed) are optional and ignored by an older server.
// ============================================================================
import { GAS_URL } from './config.js';
import { getToken, clearSession, setRenewedToken } from './state.js';
import { toast } from './ui.js';

const READ_TIMEOUTS_MS = [25000, 40000, 40000];   // first try short: recovers fast from a cold start
const READ_BACKOFF_MS = [700, 1800];
const WRITE_TIMEOUT_MS = 180000;                    // Import Excel confirm can legitimately take a while
const WRITE_BACKOFF_MS = [1200];

// ---- tiny perf recorder (console: Perf.table() / Perf.summary()) ----------
const perfRows = [];
function recordPerf(action, total, server, attempts, ok) {
  perfRows.push({ action, total: Math.round(total), server: server == null ? null : Math.round(server), net: server == null ? null : Math.round(total - server), attempts, ok });
  if (perfRows.length > 200) perfRows.shift();
}
if (typeof window !== 'undefined') {
  window.Perf = {
    rows: perfRows,
    table() { console.table(perfRows.slice(-30)); },
    summary() {
      const by = {};
      perfRows.forEach((r) => { const a = (by[r.action] = by[r.action] || { n: 0, total: 0, server: 0 }); a.n++; a.total += r.total; a.server += r.server || 0; });
      console.table(Object.entries(by).map(([action, a]) => ({ action, n: a.n, avgTotal: Math.round(a.total / a.n), avgServer: Math.round(a.server / a.n) })));
    }
  };
}

// ---- error type ------------------------------------------------------------
export class ApiError extends Error {
  constructor(message, { code = 'ERROR', status = 0, retryable = false, raw = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (raw) this.raw = raw;
  }
}

// ---- toast de-duplication (a burst of parallel failures shows ONE toast) ----
const recentToasts = new Map();
function toastOnce(message, type = 'error', timeout) {
  const now = Date.now();
  const last = recentToasts.get(message);
  if (last && now - last < 4000) return;
  recentToasts.set(message, now);
  if (recentToasts.size > 20) recentToasts.clear();
  toast(message, type, timeout);
}

function buildQuery(params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
  return qs.toString();
}

function isConfigured() {
  if (!GAS_URL || GAS_URL.indexOf('PASTE_YOUR_GAS_WEB_APP_URL_HERE') !== -1) {
    toastOnce('GAS_URL belum diisi di js/config.js — hubungkan ke backend terlebih dahulu.', 'error', 6000);
    return false;
  }
  return true;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function newRequestId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fall through */ }
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// If the device is offline, give it a few seconds to come back before failing.
function waitOnline(maxMs = 6000) {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (v) => { window.removeEventListener('online', onOnline); clearTimeout(t); resolve(v); };
    const onOnline = () => done(true);
    const t = setTimeout(() => done(false), maxMs);
    window.addEventListener('online', onOnline);
  });
}

// ---- turning a non-JSON body into a clear message ---------------------------
function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function describeHtmlResponse(text, status) {
  const head = String(text).slice(0, 6000);
  const plain = htmlToText(head).slice(0, 200);
  const http = status ? ` (HTTP ${status})` : '';

  if (/accounts\.google\.com|ServiceLogin|signin\/v2|Sign in to continue|Masuk untuk melanjutkan/i.test(head)) {
    return new ApiError(
      `Server mengembalikan halaman login Google, bukan data${http}. Pastikan Web App Apps Script di-deploy dengan "Execute as: Me" dan "Who has access: Anyone", dan GAS_URL di js/config.js adalah URL /exec yang benar.`,
      { code: 'HTML_LOGIN', status, retryable: false });
  }
  if (/Script function not found|doGet|doPost/i.test(head) && /not found|tidak ditemukan/i.test(head)) {
    return new ApiError(
      `Backend belum ter-deploy dengan benar${http}: fungsi doGet/doPost tidak ditemukan. Tempel Kode.gs terbaru lalu Deploy > Manage deployments > Edit > New version.`,
      { code: 'HTML_NO_SCRIPT', status, retryable: false });
  }
  if (/SyntaxError|ReferenceError|TypeError|is not defined|Unexpected token/i.test(plain) && !/^\s*<!DOCTYPE html>\s*$/i.test(plain)) {
    return new ApiError(
      `Kode backend (Apps Script) mengalami error${http}: "${plain.slice(0, 120)}". Periksa menu Executions di Apps Script dan pastikan Kode.gs terbaru sudah ditempel utuh lalu di-deploy sebagai New version.`,
      { code: 'HTML_SCRIPT_ERROR', status, retryable: false });
  }
  if (/Exceeded maximum execution time|Service invoked too many times|too many times|quota|Batas waktu/i.test(head)) {
    return new ApiError(
      `Server Google sedang kelebihan beban atau kuota tercapai${http}. Tunggu beberapa saat lalu coba lagi.`,
      { code: 'HTML_QUOTA', status, retryable: true });
  }
  if (status === 404) {
    return new ApiError(`Alamat server tidak ditemukan (HTTP 404). Periksa GAS_URL di js/config.js.`, { code: 'HTTP_404', status, retryable: false });
  }
  if (status === 403 || status === 401) {
    return new ApiError(`Akses ke server ditolak (HTTP ${status}). Pastikan deployment Web App diset "Who has access: Anyone".`, { code: 'HTML_FORBIDDEN', status, retryable: false });
  }
  return new ApiError(
    `Server Google Apps Script mengembalikan halaman error, bukan data${http}. Biasanya sementara — ${plain ? '"' + plain.slice(0, 100) + '"' : 'silakan coba lagi'}.`,
    { code: 'HTML_RESPONSE', status, retryable: true });
}

async function parseBody(res) {
  const text = await res.text();
  const trimmed = text.replace(/^﻿/, '').trim();
  const ctype = (res.headers && res.headers.get && res.headers.get('content-type')) || '';

  if (trimmed === '') {
    throw new ApiError(`Server memberi respons kosong${res.status ? ` (HTTP ${res.status})` : ''}.`, { code: 'EMPTY', status: res.status, retryable: true });
  }
  if (trimmed[0] === '<' || /text\/html/i.test(ctype)) {
    console.warn('[api] Respons HTML (bukan JSON):', res.status, trimmed.slice(0, 400));
    throw describeHtmlResponse(trimmed, res.status);
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    console.warn('[api] Respons bukan JSON valid:', res.status, trimmed.slice(0, 400));
    throw new ApiError(`Respons server tidak valid${res.status ? ` (HTTP ${res.status})` : ''}. Coba lagi; bila berulang, periksa deployment backend.`, { code: 'BAD_JSON', status: res.status, retryable: true });
  }
}

// One HTTP attempt -> parsed JSON envelope, or throws ApiError.
async function attempt(url, init, timeoutMs) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch(url, ctl ? { ...init, signal: ctl.signal } : init);
  } catch (err) {
    if (timer) clearTimeout(timer);
    if (err && err.name === 'AbortError') {
      throw new ApiError(`Server terlalu lama merespons (lebih dari ${Math.round(timeoutMs / 1000)} detik).`, { code: 'TIMEOUT', retryable: true });
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError('Tidak ada koneksi internet. Periksa jaringan Anda lalu coba lagi.', { code: 'OFFLINE', retryable: true });
    }
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet, lalu coba lagi.', { code: 'NETWORK', retryable: true });
  }
  try {
    const json = await parseBody(res);
    // A JSON error envelope with HTTP 5xx is still a server answer -> let the caller see it.
    return json;
  } catch (err) {
    if (err instanceof ApiError) {
      if (res.status >= 500 && !err.retryable) err.retryable = true;
      throw err;
    }
    if (err && err.name === 'AbortError') {
      throw new ApiError(`Server terlalu lama merespons (lebih dari ${Math.round(timeoutMs / 1000)} detik).`, { code: 'TIMEOUT', retryable: true });
    }
    throw new ApiError('Gagal membaca respons server. Coba lagi.', { code: 'NETWORK', retryable: true });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// attempt() with retry for transient failures.
async function requestWithRetry(url, init, { timeouts, backoff, maxAttempts }) {
  let lastErr = null;
  let attempts = 0;
  for (let i = 0; i < maxAttempts; i++) {
    attempts = i + 1;
    if (i > 0) await sleep(backoff[Math.min(i - 1, backoff.length - 1)]);
    const online = await waitOnline();
    if (!online) { lastErr = new ApiError('Tidak ada koneksi internet. Periksa jaringan Anda lalu coba lagi.', { code: 'OFFLINE', retryable: false }); break; }
    try {
      const json = await attempt(url, init, timeouts[Math.min(i, timeouts.length - 1)]);
      return { json, attempts };
    } catch (err) {
      lastErr = err;
      if (!(err instanceof ApiError) || !err.retryable) break;
    }
  }
  if (lastErr) lastErr.attempts = attempts;
  throw lastErr;
}

// ---- envelope handling -------------------------------------------------------
function adoptEnvelopeExtras(json) {
  if (json && typeof json.renew === 'string' && json.renew) {
    try { setRenewedToken(json.renew); } catch (e) { /* ignore */ }
  }
}

function isAuthFailure(json) {
  if (!json) return false;
  if (json.code === 'AUTH') return true;
  return /token|unauthor|expired|sesi/i.test(String(json.message || ''));
}

function handleEnvelopeError(json, { silent = false } = {}) {
  const message = (json && json.message) || 'Terjadi kesalahan pada server';
  if (!silent) toastOnce(message, 'error');
  if (isAuthFailure(json)) {
    clearSession();
    location.hash = '#/login';
  }
}

// Reads that are identical AND issued between the same two writes share one
// request ("write epoch"): a read started after a save never joins a read that
// was already on the wire before it.
let writeEpoch = 0;
const inflightReads = new Map();

/**
 * GET a read-only action. Resolves to `data` on success, throws on failure
 * (throw carries `.message` and `.raw` envelope) so callers can decide how
 * to render the error inline vs. rely on the toast.
 * opts.silent: no toast on failure (used by background prefetch).
 */
export async function fetchData(action, params = {}, opts = {}) {
  if (!isConfigured()) throw new Error('GAS_URL belum dikonfigurasi');
  const token = getToken();
  const url = `${GAS_URL}?${buildQuery({ action, token, ...params })}`;

  const key = `${writeEpoch}|${url}`;
  if (inflightReads.has(key)) return inflightReads.get(key);

  const p = (async () => {
    const t0 = performance.now();
    let json;
    let attempts = 1;
    try {
      const out = await requestWithRetry(url, { method: 'GET' }, { timeouts: READ_TIMEOUTS_MS, backoff: READ_BACKOFF_MS, maxAttempts: READ_TIMEOUTS_MS.length });
      json = out.json;
      attempts = out.attempts;
    } catch (err) {
      recordPerf(action, performance.now() - t0, null, err.attempts || 1, false);
      if (!opts.silent) toastOnce(err.message, 'error');
      throw err instanceof ApiError ? err : new ApiError(err && err.message ? err.message : 'Permintaan gagal', { code: 'ERROR' });
    }
    recordPerf(action, performance.now() - t0, json && json.ms, attempts, Boolean(json && json.success));
    adoptEnvelopeExtras(json);
    if (!json || json.success !== true) {
      handleEnvelopeError(json, { silent: opts.silent });
      const e = new ApiError((json && json.message) || 'Permintaan gagal', { code: (json && json.code) || 'SERVER', raw: json });
      throw e;
    }
    return json.data;
  })();

  inflightReads.set(key, p);
  const clear = () => { if (inflightReads.get(key) === p) inflightReads.delete(key); };
  p.then(clear, clear);
  return p;
}

/**
 * POST a mutating action. Always resolves (never throws) with the raw
 * envelope {success, data?, message?, code?} so forms can render field-level
 * errors without a try/catch at every call site. Fires the error toast
 * centrally on failure (opts.silent suppresses it for callers that show the
 * error inline themselves).
 *
 * Every write except login/logout carries a client-generated reqId. If the
 * response is lost (network blip, HTML error page) the request is retried with
 * the SAME reqId and the server returns the first attempt's result instead of
 * saving again — "save never duplicates".
 * opts: { silent, timeoutMs, retry (extra attempts), reqId }
 */
export async function postData(action, data = {}, opts = {}) {
  if (!isConfigured()) return { success: false, message: 'GAS_URL belum dikonfigurasi', code: 'CONFIG' };
  const token = getToken(); // read synchronously, before any await (logout relies on this)
  const isAuthCall = action === 'login' || action === 'logout';
  const body = { action, token, data };
  if (!isAuthCall) body.reqId = opts.reqId || newRequestId();

  writeEpoch += 1; // reads started from now on never join reads that predate this write
  const t0 = performance.now();
  const maxAttempts = 1 + (opts.retry !== undefined ? opts.retry : 1);
  try {
    const { json, attempts } = await requestWithRetry(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    }, { timeouts: [opts.timeoutMs || WRITE_TIMEOUT_MS], backoff: WRITE_BACKOFF_MS, maxAttempts });
    recordPerf(action, performance.now() - t0, json && json.ms, attempts, Boolean(json && json.success));
    adoptEnvelopeExtras(json);
    if (!json || json.success !== true) {
      // login failures are shown inline by the login form, and must never wipe the session
      if (action === 'login') { if (!opts.silent) toastOnce((json && json.message) || 'Login gagal', 'error'); }
      else handleEnvelopeError(json, { silent: opts.silent });
    }
    return json || { success: false, message: 'Respons kosong dari server' };
  } catch (err) {
    recordPerf(action, performance.now() - t0, null, err.attempts || 1, false);
    const message = err && err.message ? err.message : 'Tidak dapat menghubungi server';
    if (!opts.silent) toastOnce(message, 'error');
    return { success: false, message, code: (err && err.code) || 'ERROR' };
  } finally {
    writeEpoch += 1; // reads started while this write was in flight must not be reused afterwards
  }
}

// ---- warm-up ------------------------------------------------------------------
// Wakes the Apps Script instance (cold start is 1-4 s) while the user is still
// typing their password. GET ?w=1 is answered by the backend without touching
// any sheet; no-cors => the response is opaque and can never raise a parse
// error. At most once every 4 minutes per tab.
export function warmUpServer() {
  try {
    if (!GAS_URL || GAS_URL.indexOf('PASTE_YOUR_GAS_WEB_APP_URL_HERE') !== -1) return;
    const last = Number(sessionStorage.getItem('bw_warm') || 0);
    if (Date.now() - last < 4 * 60 * 1000) return;
    sessionStorage.setItem('bw_warm', String(Date.now()));
    fetch(`${GAS_URL}?w=1`, { method: 'GET', mode: 'no-cors' }).catch(() => {});
  } catch (e) { /* warm-up is best-effort */ }
}
