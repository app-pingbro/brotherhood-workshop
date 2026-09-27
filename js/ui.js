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
}
