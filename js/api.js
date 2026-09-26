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
