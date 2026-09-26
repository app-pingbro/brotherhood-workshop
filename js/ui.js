<<<<<<< HEAD
// ============================================================================
// Small shared UI helpers: toasts, skeletons, empty states, modal, formatting.
// Pure DOM, no framework.
// ============================================================================

export function toast(message, type = 'success', timeout = 3600) {
  const stack = document.getElementById('toast-stack');
  if (!stack) { console.log(`[toast:${type}]`, message); return; }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s ease';
    setTimeout(() => el.remove(), 220);
  }, timeout);
}

export function formatCurrency(n) {
  const v = Number(n) || 0;
  return 'Rp' + Math.round(v).toLocaleString('id-ID');
}

export function formatNumber(n) {
  return Number(n || 0).toLocaleString('id-ID');
}

export function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

export function skeletonTable(columns = 5, rows = 5) {
  const thead = `<thead><tr>${Array.from({ length: columns }).map(() => '<th>&nbsp;</th>').join('')}</tr></thead>`;
  const tbody = `<tbody>${Array.from({ length: rows }).map(() => `
    <tr class="skeleton-row">${Array.from({ length: columns }).map(() => '<td><div class="skeleton-line" style="width:' + (50 + Math.random() * 40).toFixed(0) + '%"></div></td>').join('')}</tr>
  `).join('')}</tbody>`;
  return `<div class="table-wrap"><table class="data-table">${thead}${tbody}</table></div>`;
}

export function skeletonKpis(count = 3) {
  return `<div class="grid grid-kpi">${Array.from({ length: count }).map(() => '<div class="card skeleton-kpi"></div>').join('')}</div>`;
}

export function emptyState(title = 'Belum ada data', hint = 'Data akan muncul di sini setelah ditambahkan.', icon = '\u{1F4ED}') {
  return `<div class="empty-state"><div class="empty-state__icon">${icon}</div><div class="empty-state__title">${escapeHtml(title)}</div><div class="empty-state__hint">${escapeHtml(hint)}</div></div>`;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function ownerDotClass(ownerCode) {
  return `owner-dot--${String(ownerCode || '').toLowerCase()}`;
}

export function badge(text, tone = 'neutral') {
  return `<span class="badge badge-${tone}">${escapeHtml(text)}</span>`;
}

// ---- Modal ---------------------------------------------------------------
let modalRoot = null;
export function openModal({ title, bodyHtml, onMount, size }) {
  closeModal();
  modalRoot = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === modalRoot) closeModal(); } }, [
    el('div', { class: 'modal', style: size === 'lg' ? 'max-width:820px' : '' }, [
      el('div', { class: 'modal__header' }, [
        el('h3', {}, title),
        el('button', { class: 'modal__close', 'aria-label': 'Tutup', onclick: () => closeModal() }, '✕')
      ]),
      el('div', { class: 'modal__body', html: bodyHtml || '' })
    ])
  ]);
  document.body.appendChild(modalRoot);
  if (onMount) onMount(modalRoot.querySelector('.modal__body'));
  document.addEventListener('keydown', escHandler);
}
function escHandler(e) { if (e.key === 'Escape') closeModal(); }
export function closeModal() {
  if (modalRoot) { modalRoot.remove(); modalRoot = null; }
  document.removeEventListener('keydown', escHandler);
}

export function confirmDialog(message, { confirmLabel = 'Ya, lanjutkan', tone = 'danger' } = {}) {
  return new Promise((resolve) => {
    openModal({
      title: 'Konfirmasi',
      bodyHtml: `<p>${escapeHtml(message)}</p><div class="form-actions">
        <button class="btn btn-secondary" id="confirm-no">Batal</button>
        <button class="btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}" id="confirm-yes">${escapeHtml(confirmLabel)}</button>
      </div>`,
      onMount: (body) => {
        body.querySelector('#confirm-no').addEventListener('click', () => { closeModal(); resolve(false); });
        body.querySelector('#confirm-yes').addEventListener('click', () => { closeModal(); resolve(true); });
      }
    });
  });
}

/**
 * Reads the first present key from an object, trying several spellings.
 * BUILD-SPEC does not pin exact JSON casing for a few computed response
 * payloads (getMonthlyRecap in particular) — pages that consume it use this
 * so both camelCase and snake_case backends work without a rewrite.
 */
export function pick(obj, keys, fallback = 0) {
  if (!obj) return fallback;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return fallback;
}

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
=======
// ============================================================
// UI — helper DOM, format, toast, modal, chip, skeleton (dipakai di seluruh pages.js)
// ============================================================

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function jsAttr(o) { return esc(JSON.stringify(o)); }
function nf(n) { return Math.round(Number(n) || 0).toLocaleString('id-ID'); }
function rp(n) { const v = Math.round(Number(n) || 0); return (v < 0 ? '-Rp ' : 'Rp ') + Math.abs(v).toLocaleString('id-ID'); }
function uid() { return 'k' + Math.random().toString(36).slice(2, 10); }
function debounce(fn, ms) { let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); }; }

function ymdToDate(s) { const p = String(s).split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function dateToYmd(d) { return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
function addD(s, n) { const d = ymdToDate(s); d.setUTCDate(d.getUTCDate() + n); return dateToYmd(d); }
function mondayOf(s) { const d = ymdToDate(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return dateToYmd(d); }
function todayYmd() { return dateToYmd(new Date()); }
function fmtTgl(s) { if (!s) return '-'; const p = String(s).split('-'); return (+p[2]) + ' ' + BULAN[+p[1] - 1] + ' ' + p[0]; }
function fmtTglPendek(s) { if (!s) return '-'; const p = String(s).split('-'); return (+p[2]) + ' ' + BULAN[+p[1] - 1]; }
function fmtPeriode(p) { if (!p) return '-'; const q = String(p).split('-'); return BULAN[+q[1] - 1] + ' ' + q[0]; }
function periodeIni() { const t = todayYmd(); return t.substr(0, 7); }

function chipUnit(idOrUnit) {
  const u = typeof idOrUnit === 'string' ? unitById(idOrUnit) : idOrUnit;
  if (!u) return '<span class="chip chip-neutral">Biaya Bersama</span>';
  return `<span class="chip chip-unit" style="background:${esc(u.warna)};color:${esc(u.warna_teks)}">${esc(u.nama)}</span>`;
}
function chipStatus(s) {
  const map = { 'Lunas': 'chip-lunas', 'DP': 'chip-dp', 'Sebagian/Cicilan': 'chip-sebagian', 'Belum Bayar': 'chip-belum', 'Perlu Konfirmasi': 'chip-konfirmasi' };
  return `<span class="chip ${map[s] || 'chip-neutral'}">${esc(s)}</span>`;
}
function chipGaji(s) {
  const map = { 'Draft': 'chip-draft', 'Terkunci': 'chip-terkunci', 'Dibayar': 'chip-dibayar', 'Belum Diproses': 'chip-neutral' };
  return `<span class="chip ${map[s] || 'chip-neutral'}">${esc(s)}</span>`;
}
function chipKasbon(s) {
  const map = { 'Lunas': 'chip-lunas', 'Sebagian': 'chip-sebagian', 'Belum Dipotong': 'chip-belum' };
  return `<span class="chip ${map[s] || 'chip-neutral'}">${esc(s)}</span>`;
}
function badgeOwner() { return '<span class="badge-owner">Owner</span>'; }

function skeletonKpi(n) { return Array(n || 3).fill('<div class="skel skel-kpi"></div>').join(''); }
function skeletonRows(n) { return Array(n || 5).fill('<div class="skel skel-row"></div>').join(''); }
function emptyState(icon, teks) { return `<div class="empty"><i class="bi ${icon}"></i>${esc(teks)}</div>`; }

function showToast(tipe, judul, pesan) {
  const ikon = { ok: 'bi-check-circle-fill', err: 'bi-x-octagon-fill', warn: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' }[tipe] || 'bi-info-circle-fill';
  const el = document.createElement('div');
  el.className = 'toast-x ' + tipe;
  el.innerHTML = `<i class="bi ${ikon}"></i><div><div class="t">${esc(judul)}</div><div class="m">${esc(pesan || '')}</div></div>`;
  $('toastWrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, tipe === 'err' ? 6500 : 3800);
}
function handleErr(e) { showToast('err', 'Gagal', (e && e.message) ? e.message : String(e)); }
function handleApiGagal(res) { showToast('err', 'Gagal', (res && res.message) || 'Terjadi kesalahan.'); }

// ── Modal (Bootstrap 5) ──
function M(id) { return bootstrap.Modal.getOrCreateInstance($(id)); }
function konfirmasi(judul, bodyHtml, labelOk, fn) {
  $('konfTitle').textContent = judul;
  $('konfBody').innerHTML = bodyHtml;
  const btn = $('konfOk');
  btn.textContent = labelOk || 'Ya, Lanjutkan';
  const baru = btn.cloneNode(true);
  btn.parentNode.replaceChild(baru, btn);
  baru.addEventListener('click', async () => {
    baru.disabled = true;
    try { await fn(); M('modalKonfirmasi').hide(); } catch (e) { handleErr(e); } finally { baru.disabled = false; }
  });
  M('modalKonfirmasi').show();
}
/** Form modal generik: title, body HTML, tombol simpan → callback async. */
function openForm(title, bodyHtml, onSimpan, labelSimpan) {
  $('formTitle').textContent = title;
  $('formBody').innerHTML = bodyHtml;
  const btn = $('formOk');
  btn.textContent = labelSimpan || 'Simpan';
  const baru = btn.cloneNode(true);
  btn.parentNode.replaceChild(baru, btn);
  baru.addEventListener('click', async () => {
    baru.disabled = true; const asal = baru.textContent; baru.textContent = 'Menyimpan...';
    try { await onSimpan(); } catch (e) { handleErr(e); } finally { baru.disabled = false; baru.textContent = asal; }
  });
  M('modalForm').show();
}

/** Bungkus tabel lebar (desktop) + daftar kartu (mobile) dari baris yang sama — supaya tidak dobel logika. */
function tableResponsive(theadHtml, rowsHtml, mobileHtml, emptyHtml) {
  if (!rowsHtml) return emptyHtml || emptyState('bi-inbox', 'Belum ada data.');
  return `
    <div class="tbl-wrap has-cards"><table class="tbl"><thead><tr>${theadHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <div class="m-list">${mobileHtml}</div>`;
}

// ============================================================
// INSTANT UX — pemuat data generik dipakai SEMUA Pages.render*/load* (prinsip 2 & 3):
//   1) Ada di cache (epoch cocok)  → render LANGSUNG, tanpa skeleton, tanpa menunggu.
//   2) Tidak ada di cache          → tampilkan skeleton SEKALI, lalu ambil data.
//   Kedua kasus lalu menyegarkan data di latar belakang (indikator kecil non-blocking di
//   pojok kanan atas), bukan reload; render ulang HANYA jika data ternyata berubah.
//   Request yang sama (key sama) yang masih berjalan tidak diulang (dedup).
// ============================================================
const _inflight = {};
let _syncCount = 0;
function _syncStart() { _syncCount++; const el = $('syncIndicator'); if (el) el.classList.add('on'); }
function _syncEnd() { _syncCount = Math.max(0, _syncCount - 1); if (_syncCount === 0) { const el = $('syncIndicator'); if (el) el.classList.remove('on'); } }

/**
 * @param {string} key - kunci cache unik untuk kombinasi data+filter ini.
 * @param {function():Promise<{success,data,message}>} fetchFn - pemanggil API (Api.get/Api.post).
 * @param {function(data, dariCache:boolean)} renderFn - render hasil ke DOM.
 * @param {function()} [skeletonFn] - render skeleton (dipanggil HANYA saat cache kosong).
 * @param {{background:boolean}} [opts] - background:false mematikan sinkron latar belakang
 *        (dipakai layar batch-input seperti Absensi/Proses Gaji agar isian yang sedang diketik
 *        pengguna tidak pernah tertimpa render ulang otomatis).
 * @returns {Promise<void>}
 */
async function loadInto(key, fetchFn, renderFn, skeletonFn, opts) {
  const background = !opts || opts.background !== false;
  const cached = Cache.get(key);
  if (cached !== null && cached !== undefined) {
    renderFn(cached, true);
    if (background) _refreshBackground(key, fetchFn, renderFn);
    return;
  }
  if (skeletonFn) skeletonFn();
  _syncStart();
  try {
    const res = await fetchFn();
    if (!res.success) { handleApiGagal(res); return; }
    Cache.set(key, res.data);
    renderFn(res.data, false);
  } catch (e) {
    handleErr(e);
  } finally {
    _syncEnd();
  }
}

/** Sinkron ulang satu key di latar belakang tanpa mengganggu tampilan — dedup otomatis. */
function _refreshBackground(key, fetchFn, renderFn) {
  if (_inflight[key]) return;
  _inflight[key] = true;
  _syncStart();
  fetchFn().then(res => {
    if (res && res.success) {
      const lama = JSON.stringify(Cache.get(key));
      const baru = JSON.stringify(res.data);
      Cache.set(key, res.data);
      if (lama !== baru) renderFn(res.data, false);
    }
  }).catch(() => { /* diamkan — data cache lama tetap ditampilkan */ }).finally(() => {
    delete _inflight[key];
    _syncEnd();
  });
}

function toggleTheme(force) {
  const html = document.documentElement;
  const now = force || (html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  html.setAttribute('data-theme', now);
  S.theme = now;
  Pref.set('theme', now);
  const icon = $('btnTheme') ? $('btnTheme').querySelector('i') : null;
  if (icon) icon.className = 'bi ' + (now === 'dark' ? 'bi-sun' : 'bi-moon-stars');
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
}
