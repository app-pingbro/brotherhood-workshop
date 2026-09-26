<<<<<<< HEAD
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
// ============================================================================
import { GAS_URL } from './config.js';
import { getToken, clearSession } from './state.js';
import { toast } from './ui.js';

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
    toast('GAS_URL belum diisi di js/config.js — hubungkan ke backend terlebih dahulu.', 'error', 6000);
    return false;
  }
  return true;
}

/**
 * GET a read-only action. Resolves to `data` on success, throws on failure
 * (throw carries `.message` and `.raw` envelope) so callers can decide how
 * to render the error inline vs. rely on the toast.
 */
export async function fetchData(action, params = {}) {
  if (!isConfigured()) throw new Error('GAS_URL belum dikonfigurasi');
  const token = getToken();
  const url = `${GAS_URL}?${buildQuery({ action, token, ...params })}`;
  let json;
  try {
    const res = await fetch(url, { method: 'GET' });
    json = await res.json();
  } catch (err) {
    toast('Tidak dapat menghubungi server: ' + err.message, 'error');
    const e = new Error('Network error: ' + err.message);
    throw e;
  }
  if (!json || json.success !== true) {
    handleEnvelopeError(json);
    const e = new Error((json && json.message) || 'Permintaan gagal');
    e.raw = json;
    throw e;
  }
  return json.data;
}

/**
 * POST a mutating action. Always resolves (never throws) with the raw
 * envelope {success, data?, message?} so forms can render field-level
 * errors without a try/catch at every call site. Fires the error toast
 * centrally on failure.
 */
export async function postData(action, data = {}) {
  if (!isConfigured()) return { success: false, message: 'GAS_URL belum dikonfigurasi' };
  const token = getToken();
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, data })
    });
    const json = await res.json();
    if (!json || json.success !== true) handleEnvelopeError(json);
    return json || { success: false, message: 'Respons kosong dari server' };
  } catch (err) {
    toast('Tidak dapat menghubungi server: ' + err.message, 'error');
    return { success: false, message: err.message };
  }
}

function handleEnvelopeError(json) {
  const message = (json && json.message) || 'Terjadi kesalahan pada server';
  toast(message, 'error');
  if (json && /token|unauthor|expired|sesi/i.test(message)) {
    clearSession();
    location.hash = '#/login';
  }
}
=======
// ============================================================
// API — komunikasi ke Google Apps Script (REST/JSON murni, fetch())
// Prinsip gas-pro-api: GET untuk baca (tanpa CORS preflight, aman di-cache),
// POST dengan Content-Type text/plain untuk aksi yang menulis data (juga menghindari preflight).
// TIDAK PERNAH memakai google.script.run — ini situs statis terpisah dari GAS.
// ============================================================

const Api = (() => {
  function getToken() { try { return localStorage.getItem('bw_token') || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem('bw_token', t); else localStorage.removeItem('bw_token'); } catch (e) { /* abaikan */ } }

  /** Aksi baca (read-only) → GET, query string ringkas, browser boleh cache. */
  async function get(action, payload) {
    const qs = new URLSearchParams();
    qs.set('action', action);
    const token = getToken();
    if (token) qs.set('token', token);
    if (payload && Object.keys(payload).length) qs.set('payload', JSON.stringify(payload));
    let res;
    try {
      res = await fetch(GAS_URL + '?' + qs.toString(), { method: 'GET' });
    } catch (e) {
      return { success: false, message: 'Tidak dapat menghubungi server. Periksa koneksi internet atau URL_GAS di js/config.js.' };
    }
    return parseRes_(res);
  }

  /** Aksi tulis (write) → POST, text/plain (hindari CORS preflight). */
  async function post(action, payload) {
    const body = JSON.stringify({ action: action, token: getToken(), payload: payload || {} });
    let res;
    try {
      res = await fetch(GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body });
    } catch (e) {
      return { success: false, message: 'Tidak dapat menghubungi server. Periksa koneksi internet atau URL_GAS di js/config.js.' };
    }
    return parseRes_(res);
  }

  async function parseRes_(res) {
    let json;
    try { json = await res.json(); } catch (e) { return { success: false, message: 'Respons server tidak valid (kemungkinan URL GAS_URL salah atau belum di-deploy sebagai "Anyone").' }; }
    if (json && json.success === false && /Sesi berakhir/i.test(json.message || '')) {
      setToken('');
      if (window.App && typeof window.App.onSessionExpired === 'function') window.App.onSessionExpired();
    }
    return json;
  }

  return { get, post, getToken, setToken };
})();
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
