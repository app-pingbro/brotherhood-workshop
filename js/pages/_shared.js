// ============================================================================
// Generic list+form CRUD engine shared by the transaction/payroll pages
// (Jahit, Sablon, Gaji Jahit, Gaji Sablon, Gaji Harian, Lembur, Kasbon,
// Pengeluaran) and reused in spirit (simpler) by Master Data. Keeps every
// page module small while giving each page real, module-specific fields,
// validation, computed previews and period-lock behavior.
// ============================================================================
import { fetchData, postData } from '../api.js';
import { fetchSWR, peek, invalidate, invalidatePrefix } from '../cache.js';
import { icon } from '../icons.js';
import {
  formatCurrency, formatDate, skeletonTable, emptyState, escapeHtml,
  openModal, closeModal, confirmDialog, toast, setModalDirtyCheck, formatPeriodLabel
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
    document.getElementById('crud-lock').innerHTML = `${icon('lock')} Periode <strong>${escapeHtml(formatPeriodLabel(period))}</strong> berstatus <strong>CLOSED</strong> &mdash; data hanya bisa dilihat. Buka kembali periode ini dari Rekap Bulanan untuk mengedit.`;
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

  // Instant UX (gas-instant-ux Prinsip 2/4): stale-while-revalidate. If this
  // exact list (action + period + owner + local filters) was already loaded
  // earlier in the session, paint it immediately — no skeleton, no wait —
  // then silently refresh in the background and re-render only if the data
  // actually changed shape. First-ever load (or right after a save/delete,
  // which forces a fresh fetch) still shows the skeleton while it waits.
  async function load({ force = false } = {}) {
    const listRoot = document.getElementById('crud-list');
    if (!period) {
      listRoot.innerHTML = emptyState('Belum ada periode dipilih', 'Gunakan selector periode di kanan atas.', '\u{1F4C5}');
      return;
    }
    const params = { ...(opts.listParams ? opts.listParams() : {}), ...localFilterValues };

    function apply(data) {
      rows = Array.isArray(data) ? data : (data && data.items) || [];
      if (opts.onRowsLoaded) opts.onRowsLoaded(rows);
      renderTable(rows);
      if (opts.renderExtra) opts.renderExtra(document.getElementById('crud-extra'), rows);
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
      invalidate(opts.listAction);
      invalidate('getMonthlyRecap'); // deletions change totals shown on Dashboard/Rekap Bulanan
      invalidate('getSalarySlip'); // payroll/Kasbon edits change Slip Gaji too
      invalidatePrefix('dashRecent'); // Dashboard's merged Jahit+Sablon "recent" cache
      invalidatePrefix('dashTrend'); // Dashboard's per-period trend cache
      load({ force: true });
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
            invalidate(opts.listAction);
            invalidate('getMonthlyRecap'); // saves change totals shown on Dashboard/Rekap Bulanan
            invalidate('getSalarySlip'); // payroll/Kasbon edits change Slip Gaji too
            invalidatePrefix('dashRecent');
            invalidatePrefix('dashTrend');
            load({ force: true });
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

  // Data-safety (requirement: "form tidak reset ketika klik di luar"): a
  // snapshot of the values this form started with, so the modal can ask
  // for confirmation instead of silently discarding an in-progress edit on
  // an accidental backdrop/✕/Escape dismiss. See ui.js setModalDirtyCheck.
  const initialSnapshot = JSON.stringify(values);
  function isDirty() { return JSON.stringify(values) !== initialSnapshot; }

  // Double-submit guard: lives at buildForm's scope (not inside wire()) so
  // it survives the form being re-rendered by recomputeAndMaybeRerender
  // (conditional fields) while a save is still in flight.
  let submitting = false;

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
        if (f.type === 'number') {
          // Masked numeric text input (no native spinner — see
          // renderFieldHtml): sanitize keystrokes to digits (+ optional
          // leading "-") only, strip leading zeros ("0007" -> "7"), and
          // live-format with "." thousands separators for display, while
          // `values[f.key]` keeps the plain unformatted digit string that
          // every buildPayload()/validateAll() already expects — no API
          // contract change.
          const digits = sanitizeNumberDigits(input.value);
          const display = f.noGroup ? digits : groupThousands(digits);
          const tailLen = input.value.length - (input.selectionStart ?? input.value.length);
          input.value = display;
          const caret = Math.max(0, display.length - tailLen);
          try { input.setSelectionRange(caret, caret); } catch (e) { /* not all input types support this */ }
          values[f.key] = digits;
        } else {
          values[f.key] = input.value;
        }
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
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return; // guards a double-click / double Enter-press
      if (!validateAll()) return;
      submitting = true;
      const submitBtn = form.querySelector('[type="submit"]');
      const originalLabel = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Menyimpan...'; }
      try {
        await onSubmit(values);
      } finally {
        submitting = false;
        // If onSubmit succeeded it already called closeModal() — these are
        // then harmless no-ops on a detached button.
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
      }
    });
  }

  function recomputeAndMaybeRerender(changedField) {
    const needsRerender = fields.some((f) => f.showIf) || fields.some((f) => f.type === 'preview');
    if (needsRerender) {
      // Bug fix: a form with any conditional (showIf) field rebuilds its
      // whole <form> HTML on every keystroke in ANY field — including ones
      // with nothing conditional about them (e.g. Master Harga's "Satuan",
      // or "Harga Dasar" once it's reformatting itself) — so the input the
      // user is actively typing in is destroyed and recreated each time.
      // The old code only restored *focus* by field name, which drops the
      // caret back to the start of the value; capturing and restoring the
      // actual caret offset (selectionStart) across the rebuild is what was
      // missing, and is what caused typing "7000" to land as "700|0" etc.
      const activeEl = document.activeElement;
      const activeName = activeEl && activeEl.name;
      const caretPos = activeEl && typeof activeEl.selectionStart === 'number' ? activeEl.selectionStart : null;
      renderFields();
      if (activeName) {
        const el2 = root.querySelector(`[name="${activeName}"]`);
        if (el2) {
          el2.focus();
          if (caretPos !== null && typeof el2.setSelectionRange === 'function') {
            const pos = Math.min(caretPos, el2.value.length);
            try { el2.setSelectionRange(pos, pos); } catch (e) { /* select/date inputs don't support this — harmless */ }
          }
        }
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
  setModalDirtyCheck(isDirty);
}

// ---------------------------------------------------------------------------
// THE SINGLE SHARED NUMERIC/CURRENCY INPUT MECHANISM — "CurrencyInput".
// ---------------------------------------------------------------------------
// There is exactly ONE place in the whole frontend that renders a numeric
// field and exactly ONE place that wires its typing behavior:
//   - renderFieldHtml() below (the `f.type === 'number'` branch) renders the
//     control — always `<input type="text" inputmode="decimal">`, never
//     `<input type="number">`, so there is no browser spinner anywhere.
//   - wire()'s per-field `input` listener (above) is the only place that
//     reacts to keystrokes on a number field.
// Every price/nominal/quantity field in the app — Master Harga (Harga Dasar,
// Tambahan per Warna), Jahit/Sablon/GajiJahit/GajiSablon's Jumlah/Jumlah
// Warna, GajiHarian's Jumlah Hari/Jam and Tarif fields, Kasbon's
// Nominal/Total Hutang/Nominal Cicilan/Cicilan ke-, Pengeluaran's Nominal,
// Period's Tahun, RekapBulanan's Nominal Koreksi, and any future
// `{ type: 'number' }` field — is declared as data (a field-config object)
// and rendered/wired through this single code path. There is no per-page
// copy of this logic; a page that wants a numeric field just writes
// `{ type: 'number' }` and gets this behavior automatically. This is what
// the spec calls "satu CurrencyInput component" / "jangan ada 5 atau 10
// implementasi berbeda" — it is already structurally true, not just a goal.
//
// RAW vs DISPLAY, and why the caret never gets lost:
//   - RAW value = `values[f.key]`: a plain digit string (optional leading
//     "-"), no separators. This is exactly what buildPayload()/
//     validateAll()/the API contract already expect — Number(raw) always
//     works, and the backend/DB never sees anything but a real number
//     ({"basePrice": 7000}, never {"basePrice": "7.000"}).
//   - DISPLAY value = the same digits with "." thousands grouping inserted
//     (parseCurrencyDigits / formatCurrencyDisplay below), shown as the
//     input's visible `value`.
//   - Caret math is done by counting characters from the END of the string
//     (`tailLen`), not from the start: whatever the browser's native
//     Backspace/Delete/typing/Paste already did to `input.value` and
//     `input.selectionStart` is trusted as ground truth, then the digits are
//     re-derived and re-grouped, and the caret is placed so the same number
//     of characters remain AFTER it as before the reformat. This is why
//     typing "7000" digit-by-digit, deleting/inserting in the middle of
//     "100|.000", Backspace, and Delete all keep the caret in the logically
//     correct place — the browser's own caret placement for the raw
//     keystroke is never overridden, only re-expressed after reformatting.
//   - Paste is not special-cased: pasting "7000", "1.500.000", or the
//     comma-grouped "1,500,000" all fire the same native `input` event, and
//     `parseCurrencyDigits` strips every non-digit character (dot AND
//     comma) before re-grouping with ".", so any of those pasted forms
//     normalize to this app's Rupiah convention automatically.
//   - Home/End/ArrowLeft/ArrowRight are NEVER intercepted (no keydown
//     handler on these fields) — the browser's native caret movement is
//     left completely alone, which is correct as-is.
//   - The OTHER, deeper caret bug (typing in ANY field of a form that also
//     has a conditional/preview field) is not in this section at all — see
//     recomputeAndMaybeRerender() above, which is where that was fixed.
//
// `noGroup: true` opts a field OUT of the "." grouping only — the
// sanitizing (no spinner, no stray leading zero) still applies. Used for
// values that are numbers but not money: MasterData.js's Tahun (year, where
// "2.026" would be wrong) and every quantity field app-wide (Jumlah, Jumlah
// Warna, Jumlah Hari Biasa/Minggu, Jumlah Jam, Cicilan ke-) — a quantity of
// 1500 pcs must display as "1500", never "1.500", since that would read as
// a different quantity, not a formatting nicety.
// ---------------------------------------------------------------------------
function sanitizeNumberDigits(raw) {
  const str = String(raw ?? '');
  const negative = str.trim().charAt(0) === '-';
  let digits = str.replace(/[^\d]/g, '');
  digits = digits.replace(/^0+(?=\d)/, ''); // "0007" -> "7", but a lone "0" stays "0"
  return negative && digits ? '-' + digits : digits;
}

function groupThousands(signed) {
  if (!signed) return '';
  const negative = signed.charAt(0) === '-';
  const digits = negative ? signed.slice(1) : signed;
  if (!digits) return negative ? '-' : '';
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return negative ? '-' + grouped : grouped;
}

function formatNumberDisplay(rawValue, noGroup) {
  const digits = sanitizeNumberDigits(rawValue);
  return noGroup ? digits : groupThousands(digits);
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
  } else if (f.type === 'number') {
    // Rendered as a masked text input, not <input type="number"> — removes
    // the native up/down spinner and lets us fully control formatting
    // (Indonesian "." thousands grouping, no leading zeros) while keeping
    // `values[f.key]` a plain digit string underneath (wire() below).
    // f.min is still enforced in validateAll(); it's just not a native
    // HTML attribute anymore since this isn't a number input.
    control = `<input class="input" type="text" inputmode="decimal" name="${f.key}" value="${escapeHtml(formatNumberDisplay(val, f.noGroup))}" placeholder="${escapeHtml(f.placeholder || '')}" />`;
  } else {
    control = `<input class="input" type="${f.type || 'text'}" name="${f.key}" value="${escapeHtml(val ?? '')}" placeholder="${escapeHtml(f.placeholder || '')}" />`;
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

// Clear, spec-facing names for the same single masking mechanism described
// above — exported so any future page can reuse it directly instead of
// reimplementing it, without changing the internal names already used
// throughout this file.
export { sanitizeNumberDigits as parseCurrencyDigits, formatNumberDisplay as formatCurrencyDisplay };
export { formatCurrency, formatDate, icon };
