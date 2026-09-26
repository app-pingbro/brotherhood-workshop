// ============================================================================
// Generic list+form CRUD engine shared by the transaction/payroll pages
// (Jahit, Sablon, Gaji Jahit, Gaji Sablon, Gaji Harian, Lembur, Kasbon,
// Pengeluaran) and reused in spirit (simpler) by Master Data. Keeps every
// page module small while giving each page real, module-specific fields,
// validation, computed previews and period-lock behavior.
// ============================================================================
import { fetchData, postData } from '../api.js';
<<<<<<< HEAD
import { fetchSWR, peek, invalidate, invalidatePrefix } from '../cache.js';
=======
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
import { icon } from '../icons.js';
import {
  formatCurrency, formatDate, skeletonTable, emptyState, escapeHtml,
  openModal, closeModal, confirmDialog, toast
} from '../ui.js';
import { getState, getCurrentPeriod, getOwnerFilter, getLookups } from '../state.js';

/**
 * @param {HTMLElement} container
 * @param {object} opts
 *   title, subtitle, icon
 *   listAction, listParams(): object
 *   columns: [{key,label,align,format(row)}]
 *   canAdd/canEdit/canDelete/canDuplicate (default true)
 *   saveAction, deleteAction
 *   formTitle(mode), formFields: [Field]
 *   buildPayload(values, editingRow)
 *   mapRowToForm(row)
 *   emptyTitle, emptyHint, emptyIcon
 *   localFilters: [{key,label,type:'select',options(),allLabel}]
 *   periodRequired (default true) — blocks writes when the selected period is CLOSED
 *   onRowsLoaded(rows) — optional post-processing hook (e.g. compute summary)
 *   renderExtra(container, rows) — optional extra block under the table (e.g. totals)
 */
export async function renderCrudPage(container, opts) {
  const localFilterValues = {};
  (opts.localFilters || []).forEach((f) => { localFilterValues[f.key] = ''; });

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${escapeHtml(opts.title)}</h1>
        <div class="subtitle">${escapeHtml(opts.subtitle || '')}</div>
      </div>
      <div class="page-header__actions" id="crud-actions"></div>
    </div>
    <div id="crud-lock" class="notice notice-warning mb-12" style="display:none"></div>
    <div class="card mb-12" id="crud-filters" style="${(opts.localFilters || []).length ? '' : 'display:none'}"></div>
    <div id="crud-list">${skeletonTable((opts.columns || []).length + 1, 5)}</div>
    <div id="crud-extra"></div>
  `;

  const period = getCurrentPeriod();
  const isClosed = period && String(period.status || '').toLowerCase() === 'closed';
  const canWrite = opts.periodRequired === false ? true : Boolean(period) && !isClosed;

  if (!period) {
    document.getElementById('crud-lock').style.display = 'flex';
    document.getElementById('crud-lock').innerHTML = `${icon('alert')} Pilih periode terlebih dahulu di bagian atas untuk melihat dan menambah data.`;
  } else if (isClosed && opts.periodRequired !== false) {
    document.getElementById('crud-lock').style.display = 'flex';
    document.getElementById('crud-lock').innerHTML = `${icon('lock')} Periode <strong>${escapeHtml(period.label || '')}</strong> berstatus <strong>CLOSED</strong> &mdash; data hanya bisa dilihat. Buka kembali periode ini dari Rekap Bulanan untuk mengedit.`;
  }

  // Header action(s)
  const actions = document.getElementById('crud-actions');
  if (opts.canAdd !== false) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary';
    addBtn.innerHTML = `${icon('plus')} Tambah`;
    addBtn.disabled = !canWrite;
    addBtn.addEventListener('click', () => openForm('add'));
    actions.appendChild(addBtn);
  }
  if (opts.headerExtra) actions.appendChild(opts.headerExtra);

  // Local filters
  if ((opts.localFilters || []).length) {
    const filterRoot = document.getElementById('crud-filters');
    filterRoot.innerHTML = `<div class="form-grid">${opts.localFilters.map((f) => `
      <div class="field">
        <label>${escapeHtml(f.label)}</label>
        <select class="input select-control" data-filter="${f.key}">
          <option value="">${escapeHtml(f.allLabel || 'Semua')}</option>
          ${f.options().map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>`).join('')}</div>`;
    filterRoot.querySelectorAll('[data-filter]').forEach((sel) => {
      sel.addEventListener('change', () => {
        localFilterValues[sel.dataset.filter] = sel.value;
        load();
      });
    });
  }

  let rows = [];

<<<<<<< HEAD
  // Instant UX (gas-instant-ux Prinsip 2/4): stale-while-revalidate. If this
  // exact list (action + period + owner + local filters) was already loaded
  // earlier in the session, paint it immediately — no skeleton, no wait —
  // then silently refresh in the background and re-render only if the data
  // actually changed shape. First-ever load (or right after a save/delete,
  // which forces a fresh fetch) still shows the skeleton while it waits.
  async function load({ force = false } = {}) {
    const listRoot = document.getElementById('crud-list');
=======
  async function load() {
    const listRoot = document.getElementById('crud-list');
    listRoot.innerHTML = skeletonTable((opts.columns || []).length + 1, 5);
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
    if (!period) {
      listRoot.innerHTML = emptyState('Belum ada periode dipilih', 'Gunakan selector periode di kanan atas.', '\u{1F4C5}');
      return;
    }
<<<<<<< HEAD
    const params = { ...(opts.listParams ? opts.listParams() : {}), ...localFilterValues };

    function apply(data) {
=======
    try {
      const params = { ...(opts.listParams ? opts.listParams() : {}), ...localFilterValues };
      const data = await fetchData(opts.listAction, params);
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
      rows = Array.isArray(data) ? data : (data && data.items) || [];
      if (opts.onRowsLoaded) opts.onRowsLoaded(rows);
      renderTable(rows);
      if (opts.renderExtra) opts.renderExtra(document.getElementById('crud-extra'), rows);
<<<<<<< HEAD
    }

    const cached = peek(opts.listAction, params);
    if (cached === undefined) {
      listRoot.innerHTML = skeletonTable((opts.columns || []).length + 1, 5);
    }
    try {
      await fetchSWR(opts.listAction, params, apply, { force });
    } catch (e) {
      if (cached === undefined) {
        listRoot.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat data: ${escapeHtml(e.message)}</div>`;
      }
      // if we had cached data on screen already, keep showing it and let the
      // toast (fired centrally by api.js) carry the error instead of
      // yanking working data off the page.
=======
    } catch (e) {
      listRoot.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat data: ${escapeHtml(e.message)}</div>`;
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
    }
  }

  function renderTable(list) {
    const listRoot = document.getElementById('crud-list');
    if (!list.length) {
      listRoot.innerHTML = emptyState(opts.emptyTitle || 'Belum ada data', opts.emptyHint || 'Tambahkan data baru untuk periode ini.', opts.emptyIcon);
      return;
    }
    const cols = opts.columns;
    const showActions = opts.canEdit !== false || opts.canDelete !== false || opts.canDuplicate !== false;
    listRoot.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          ${cols.map((c) => `<th class="${c.align === 'num' ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('')}
          ${showActions ? '<th class="num">Aksi</th>' : ''}
        </tr></thead>
        <tbody>
          ${list.map((row, idx) => `
            <tr data-idx="${idx}">
              ${cols.map((c) => `<td class="${c.align === 'num' ? 'num' : ''}">${c.format ? c.format(row) : escapeHtml(row[c.key] ?? '-')}</td>`).join('')}
              ${showActions ? `<td class="row-actions">
                ${opts.canDuplicate !== false ? `<button class="btn btn-outline btn-sm btn-icon" data-act="dup" title="Duplikat" ${!canWrite ? 'disabled' : ''}>${icon('copy', 15)}</button>` : ''}
                ${opts.canEdit !== false ? `<button class="btn btn-outline btn-sm btn-icon" data-act="edit" title="Edit" ${!canWrite ? 'disabled' : ''}>${icon('edit', 15)}</button>` : ''}
                ${opts.canDelete !== false ? `<button class="btn btn-outline btn-sm btn-icon" data-act="del" title="Hapus" ${!canWrite ? 'disabled' : ''}>${icon('trash', 15)}</button>` : ''}
              </td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table></div>
    `;
    listRoot.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tr = btn.closest('tr');
        const row = list[Number(tr.dataset.idx)];
        const act = btn.dataset.act;
        if (act === 'edit') openForm('edit', row);
        else if (act === 'dup') openForm('duplicate', row);
        else if (act === 'del') handleDelete(row);
      });
    });
  }

  async function handleDelete(row) {
    const ok = await confirmDialog(opts.deleteMessage ? opts.deleteMessage(row) : 'Hapus data ini? Tindakan tidak dapat dibatalkan.');
    if (!ok) return;
    const res = await postData(opts.deleteAction, { id: row.id });
    if (res.success) {
      toast('Data berhasil dihapus.', 'success');
<<<<<<< HEAD
      invalidate(opts.listAction);
      invalidate('getMonthlyRecap'); // deletions change totals shown on Dashboard/Rekap Bulanan
      invalidate('getSalarySlip'); // payroll/Kasbon edits change Slip Gaji too
      invalidatePrefix('dashRecent'); // Dashboard's merged Jahit+Sablon "recent" cache
      invalidatePrefix('dashTrend'); // Dashboard's per-period trend cache
      load({ force: true });
=======
      load();
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
    }
  }

  function openForm(mode, row) {
    const lookups = getLookups();
    const values = {};
    (opts.formFields || []).forEach((f) => {
      values[f.key] = f.default ? f.default(row, { period, ownerFilter: getOwnerFilter() }) : '';
    });
    if (row && mode !== 'add') {
      Object.assign(values, opts.mapRowToForm ? opts.mapRowToForm(row) : row);
      if (mode === 'duplicate') delete values.id;
    }
    const editingId = mode === 'edit' ? row.id : null;

    openModal({
      title: opts.formTitle ? opts.formTitle(mode) : (mode === 'edit' ? 'Edit Data' : mode === 'duplicate' ? 'Duplikat Data' : 'Tambah Data'),
      bodyHtml: '<div id="crud-form-root"></div>',
      onMount: (body) => {
        const formRoot = body.querySelector('#crud-form-root');
        buildForm(formRoot, opts.formFields || [], values, lookups, async (finalValues) => {
          const payload = opts.buildPayload ? opts.buildPayload(finalValues, editingId, { period, lookups }) : finalValues;
          if (editingId) payload.id = editingId;
          const submitBtn = formRoot.querySelector('[type="submit"]');
          submitBtn.disabled = true;
          submitBtn.textContent = 'Menyimpan...';
          const res = await postData(opts.saveAction, payload);
          submitBtn.disabled = false;
          submitBtn.textContent = mode === 'edit' ? 'Simpan Perubahan' : 'Simpan';
          if (res.success) {
            toast('Data berhasil disimpan.', 'success');
            closeModal();
<<<<<<< HEAD
            invalidate(opts.listAction);
            invalidate('getMonthlyRecap'); // saves change totals shown on Dashboard/Rekap Bulanan
            invalidate('getSalarySlip'); // payroll/Kasbon edits change Slip Gaji too
            invalidatePrefix('dashRecent');
            invalidatePrefix('dashTrend');
            load({ force: true });
=======
            load();
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
          } else if (res.fieldErrors) {
            applyFieldErrors(formRoot, res.fieldErrors);
          }
        }, { mode, period, submitLabel: mode === 'edit' ? 'Simpan Perubahan' : 'Simpan' });
      }
    });
  }

  document.getElementById('crud-list');
  await load();
}

// ---------------------------------------------------------------------------
// Generic form builder — used both by renderCrudPage and directly by pages
// with non-tabular forms (e.g. Rekap Bulanan's Koreksi Saldo).
// ---------------------------------------------------------------------------
export function buildForm(root, fields, values, lookups, onSubmit, { mode = 'add', submitLabel = 'Simpan', cancelable = true } = {}) {
  function fieldVisible(f) { return f.showIf ? f.showIf(values) : true; }

  function renderFields() {
    root.innerHTML = `<form novalidate>
      <div class="form-grid">
        ${fields.filter(fieldVisible).map((f) => renderFieldHtml(f, values, lookups)).join('')}
      </div>
      <div class="form-actions">
        ${cancelable ? '<button type="button" class="btn btn-secondary" data-cancel>Batal</button>' : ''}
        <button type="submit" class="btn btn-primary">${escapeHtml(submitLabel)}</button>
      </div>
    </form>`;
    wire();
  }

  function wire() {
    const form = root.querySelector('form');
    fields.filter(fieldVisible).forEach((f) => {
      const input = form.querySelector(`[name="${f.key}"]`);
      if (!input || f.type === 'static') return;
      input.addEventListener('input', () => {
        values[f.key] = input.value;
        if (f.onChange) f.onChange(values, lookups);
        recomputeAndMaybeRerender(f);
      });
      if (f.type === 'select') {
        input.addEventListener('change', () => {
          values[f.key] = input.value;
          if (f.onChange) f.onChange(values, lookups);
          recomputeAndMaybeRerender(f);
        });
      }
    });
    if (cancelable) form.querySelector('[data-cancel]')?.addEventListener('click', () => closeModal());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validateAll()) return;
      onSubmit(values);
    });
  }

  function recomputeAndMaybeRerender(changedField) {
    const needsRerender = fields.some((f) => f.showIf) || fields.some((f) => f.type === 'preview');
    if (needsRerender) {
      const active = document.activeElement && document.activeElement.name;
      renderFields();
      if (active) {
        const el2 = root.querySelector(`[name="${active}"]`);
        if (el2) el2.focus();
      }
    }
  }

  function validateAll() {
    let ok = true;
    fields.filter(fieldVisible).forEach((f) => {
      if (f.type === 'static' || f.type === 'preview') return;
      const val = values[f.key];
      const wrap = root.querySelector(`[data-field-wrap="${f.key}"]`);
      const errEl = wrap ? wrap.querySelector('.error-msg') : null;
      let error = null;
      const isRequired = typeof f.required === 'function' ? f.required(values) : f.required;
      if (isRequired && (val === '' || val === null || val === undefined)) error = 'Wajib diisi.';
      if (!error && f.type === 'number' && val !== '' && val !== undefined && isNaN(Number(val))) error = 'Harus berupa angka.';
      if (!error && f.type === 'number' && f.min !== undefined && Number(val) < f.min) error = `Minimal ${f.min}.`;
      if (!error && f.validate) error = f.validate(val, values);
      if (wrap) wrap.classList.toggle('has-error', Boolean(error));
      if (errEl) { errEl.style.display = error ? 'block' : 'none'; errEl.textContent = error || ''; }
      if (error) ok = false;
    });
    return ok;
  }

  renderFields();
}

function renderFieldHtml(f, values, lookups) {
  const val = values[f.key];
  const isRequired = typeof f.required === 'function' ? f.required(values) : f.required;
  const required = isRequired ? '<span class="required-mark">*</span>' : '';
  let control = '';
  if (f.type === 'select') {
    const options = typeof f.options === 'function' ? f.options(values, lookups) : (f.options || []);
    control = `<select class="input" name="${f.key}">
      <option value="">${escapeHtml(f.placeholder || 'Pilih...')}</option>
      ${options.map((o) => `<option value="${escapeHtml(o.value)}"${String(o.value) === String(val) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>`;
  } else if (f.type === 'textarea') {
    control = `<textarea class="input" name="${f.key}" rows="2">${escapeHtml(val ?? '')}</textarea>`;
  } else if (f.type === 'static') {
    control = `<div class="field-computed">${f.render ? f.render(values, lookups) : escapeHtml(val ?? '-')}</div>`;
  } else if (f.type === 'preview') {
    control = `<div class="field-computed">${f.render(values, lookups)}</div>`;
  } else if (f.type === 'date') {
    control = `<input class="input" type="date" name="${f.key}" value="${escapeHtml(val ?? '')}" />`;
  } else {
    control = `<input class="input" type="${f.type || 'text'}" name="${f.key}" value="${escapeHtml(val ?? '')}" ${f.min !== undefined ? `min="${f.min}"` : ''} placeholder="${escapeHtml(f.placeholder || '')}" />`;
  }
  return `<div class="field${f.span2 ? '' : ''}" data-field-wrap="${f.key}" style="${f.fullWidth ? 'grid-column:1/-1' : ''}">
    <label>${escapeHtml(f.label)} ${required}</label>
    ${control}
    ${f.hint ? `<div class="hint">${escapeHtml(f.hint)}</div>` : ''}
    <div class="error-msg" style="display:none"></div>
  </div>`;
}

function applyFieldErrors(root, fieldErrors) {
  Object.entries(fieldErrors).forEach(([key, msg]) => {
    const wrap = root.querySelector(`[data-field-wrap="${key}"]`);
    if (!wrap) return;
    wrap.classList.add('has-error');
    const err = wrap.querySelector('.error-msg');
    if (err) { err.style.display = 'block'; err.textContent = msg; }
  });
}

export { formatCurrency, formatDate, icon };
