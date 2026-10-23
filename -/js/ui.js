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

// Indonesian month names — the single copy used everywhere a Period's month
// needs a name (the Periode create/edit form's Bulan dropdown, and
// formatPeriodLabel below). Previously duplicated as a module-private array
// inside pages/MasterData.js; centralized here so there is exactly one list
// to keep in sync.
export const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

/**
 * The one place a Period's display name is computed, used by every page
 * that shows a period (topbar selector, page subtitles, Periode list,
 * Import Excel wizard, closed-period banners, confirm dialogs, dashboard
 * trend labels...). Always derives "[Nama Bulan] [Tahun]" from the period's
 * `month`/`year` fields — NOT from its `label` field.
 *
 * Why: `label` is stored as clean text ("September 2026") when a period is
 * created/edited, but Google Sheets can silently re-type a text cell that
 * looks like a date into an actual Date cell even when it was written
 * through the API as a string. When that happens, reading the sheet back
 * returns a JS Date object for that cell, which serializes to an ISO
 * string like "2026-08-31T16:00:00.000Z" — exactly the corrupted value
 * this function exists to never show. `month`/`year` are plain integers
 * and are not subject to this — deriving the display from them entirely
 * sidesteps the corruption instead of trying to detect/repair it, and
 * requires no change to what's actually stored in the sheet.
 */
export function formatPeriodLabel(period) {
  if (!period) return '';
  const m = Number(period.month);
  const y = Number(period.year);
  if (m >= 1 && m <= 12 && y) return `${MONTHS_ID[m - 1]} ${y}`;
  // Only reached if month/year are themselves missing/invalid — falls back
  // to whatever label is available rather than showing nothing.
  return period.label || '-';
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
// Instant UX / data-safety: a form opened in a modal must never silently
// lose what the user typed. A mounted form registers a "dirty" check via
// setModalDirtyCheck(); an accidental dismiss (backdrop click, ✕, Escape)
// then asks for confirmation instead of closing immediately. A deliberate
// close (the form's own "Batal" button, or a successful save calling
// closeModal() directly) is unaffected — only the three accidental paths
// go through requestClose().
let modalRoot = null;
let dirtyCheck = null;

export function openModal({ title, bodyHtml, onMount, size }) {
  closeModal();
  modalRoot = el('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === modalRoot) requestClose(); } }, [
    el('div', { class: 'modal', style: size === 'lg' ? 'max-width:820px' : '' }, [
      el('div', { class: 'modal__header' }, [
        el('h3', {}, title),
        el('button', { class: 'modal__close', 'aria-label': 'Tutup', onclick: () => requestClose() }, '✕')
      ]),
      el('div', { class: 'modal__body', html: bodyHtml || '' })
    ])
  ]);
  document.body.appendChild(modalRoot);
  if (onMount) onMount(modalRoot.querySelector('.modal__body'));
  document.addEventListener('keydown', escHandler);
}

/**
 * Registered by a mounted form (see _shared.js buildForm) with a function
 * that returns true while the form has unsaved changes. Cleared whenever a
 * modal opens/closes so a stale check never leaks into the next modal.
 */
export function setModalDirtyCheck(fn) {
  dirtyCheck = typeof fn === 'function' ? fn : null;
}

function requestClose() {
  if (dirtyCheck && dirtyCheck()) {
    showModalCloseConfirm();
    return;
  }
  closeModal();
}

// A small overlay layered on top of the still-open modal (not a second
// openModal() call) so the form underneath is never removed/re-rendered —
// its DOM and in-progress values stay exactly as the user left them if they
// choose "Tetap Mengisi".
function showModalCloseConfirm() {
  if (!modalRoot || modalRoot.querySelector('.modal-close-confirm')) return;
  const overlay = el('div', { class: 'modal-close-confirm' }, [
    el('div', { class: 'modal-close-confirm__box' }, [
      el('p', {}, 'Data yang Anda masukkan belum disimpan. Yakin ingin keluar?'),
      el('div', { class: 'form-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => overlay.remove() }, 'Tetap Mengisi'),
        el('button', { class: 'btn btn-danger', onclick: () => closeModal() }, 'Keluar')
      ])
    ])
  ]);
  modalRoot.appendChild(overlay);
}

function escHandler(e) { if (e.key === 'Escape') requestClose(); }

export function closeModal() {
  dirtyCheck = null;
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
}
