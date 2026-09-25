// ============================================================================
// Import Excel — 4-step wizard: Select Period+Owner+Module -> Upload .xlsx
// -> Preview (per-row validation) -> Confirm Import.
// Parses the workbook client-side with SheetJS (CDN, loaded lazily) into
// plain row arrays, computes a SHA-256 file fingerprint client-side (sent
// alongside the parsed rows — the backend expects parsed JSON rows, not raw
// bytes, per BUILD-SPEC), then drives checkFileFingerprint -> importExcel ->
// confirmImport exactly per PRD section 24.
// ============================================================================
import { fetchData, postData } from '../api.js';
import { formatCurrency, escapeHtml, toast, badge } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups } from '../state.js';
import { ownerOptions } from '../lookups.js';

const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxLoadPromise = null;

function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxLoadPromise) return xlsxLoadPromise;
  xlsxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = XLSX_CDN;
    script.onload = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('Gagal memuat pustaka pembaca Excel (SheetJS).'));
    document.head.appendChild(script);
  });
  return xlsxLoadPromise;
}

const STEPS = ['Periode & Owner', 'Upload File', 'Preview', 'Konfirmasi'];

const wiz = {
  step: 0,
  periodId: '',
  ownerId: '',
  module: 'jahit',
  file: null,
  fileHash: '',
  fingerprint: null,
  rows: [],
  preview: null,
  confirmed: false
};

export async function render(container) {
  const period = getCurrentPeriod();
  wiz.step = 0; wiz.periodId = period ? period.id : ''; wiz.ownerId = ''; wiz.module = 'jahit';
  wiz.file = null; wiz.fileHash = ''; wiz.fingerprint = null; wiz.rows = []; wiz.preview = null; wiz.confirmed = false;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Import Excel</h1><div class="subtitle">Input massal transaksi Jahit/Sablon lewat file .xlsx &mdash; harga selalu dihitung server, bukan dari file.</div></div>
      <div class="page-header__actions"><button class="btn btn-secondary" id="dl-template">${icon('download', 15)} Unduh Template Excel</button></div>
    </div>
    <div class="wizard-steps" id="wizard-steps"></div>
    <div class="card" id="wizard-body"></div>
  `;

  document.getElementById('dl-template').addEventListener('click', downloadTemplate);
  renderSteps();
  renderStepBody();
}

function renderSteps() {
  const root = document.getElementById('wizard-steps');
  root.innerHTML = STEPS.map((label, i) => `
    ${i > 0 ? '<div class="wizard-connector"></div>' : ''}
    <div class="wizard-step ${i === wiz.step ? 'is-active' : ''} ${i < wiz.step ? 'is-done' : ''}">
      <span class="num">${i < wiz.step ? icon('check', 12) : i + 1}</span>${escapeHtml(label)}
    </div>
  `).join('');
}

function renderStepBody() {
  renderSteps();
  const root = document.getElementById('wizard-body');
  if (wiz.step === 0) return renderStep1(root);
  if (wiz.step === 1) return renderStep2(root);
  if (wiz.step === 2) return renderStep3(root);
  return renderStep4(root);
}

// ---- Step 1: Period + Owner + Module --------------------------------------
function renderStep1(root) {
  const lk = getLookups();
  const period = getCurrentPeriod();
  const isClosed = period && String(period.status || '').toLowerCase() === 'closed';
  root.innerHTML = `
    ${isClosed ? `<div class="notice notice-critical mb-12">${icon('alert')} Periode terpilih berstatus CLOSED &mdash; Import Excel dinonaktifkan sampai periode dibuka kembali.</div>` : ''}
    <div class="form-grid">
      <div class="field">
        <label>Periode</label>
        <div class="field-computed">${escapeHtml(period ? period.label : 'Belum dipilih')}</div>
        <div class="hint">Gunakan selector periode di kanan atas untuk mengganti.</div>
      </div>
      <div class="field">
        <label>Modul <span class="required-mark">*</span></label>
        <select class="input" id="wiz-module">
          <option value="jahit" ${wiz.module === 'jahit' ? 'selected' : ''}>Jahit</option>
          <option value="sablon" ${wiz.module === 'sablon' ? 'selected' : ''}>Sablon</option>
        </select>
      </div>
      <div class="field">
        <label>Owner/Subunit <span class="required-mark">*</span></label>
        <select class="input" id="wiz-owner">
          <option value="">Pilih Owner...</option>
          ${ownerOptions(lk).map((o) => `<option value="${o.value}" ${wiz.ownerId === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
        <div class="hint">Satu file = satu Owner. Seluruh baris pada file berlaku untuk Owner ini.</div>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="wiz-next" ${isClosed || !period ? 'disabled' : ''}>Lanjut</button>
    </div>
  `;
  document.getElementById('wiz-module').addEventListener('change', (e) => { wiz.module = e.target.value; });
  document.getElementById('wiz-owner').addEventListener('change', (e) => { wiz.ownerId = e.target.value; });
  document.getElementById('wiz-next').addEventListener('click', () => {
    if (!wiz.ownerId) { toast('Pilih Owner/Subunit terlebih dahulu.', 'error'); return; }
    wiz.step = 1;
    renderStepBody();
  });
}

// ---- Step 2: Upload + parse + fingerprint ---------------------------------
function renderStep2(root) {
  root.innerHTML = `
    <div class="dropzone" id="dropzone">
      ${icon('upload', 28)}
      <p class="mt-8" style="font-weight:700">Seret file .xlsx ke sini, atau klik untuk memilih</p>
      <p class="text-low">Sheet ${wiz.module === 'jahit' ? 'JAHIT (Jenis, Order Jahit, Jumlah)' : 'SABLON (Jenis, Design Sablon, Warna, Jumlah)'}</p>
      <input type="file" id="file-input" accept=".xlsx" style="display:none" />
    </div>
    <div id="upload-status" class="mt-12"></div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="wiz-back">Kembali</button>
      <button class="btn btn-primary" id="wiz-next" disabled>Lanjut ke Preview</button>
    </div>
  `;
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('file-input');
  dz.addEventListener('click', () => input.click());
  ['dragover', 'dragleave', 'drop'].forEach((evt) => {
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.toggle('is-dragover', evt === 'dragover');
      if (evt === 'drop' && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); });
  document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 0; renderStepBody(); });
  document.getElementById('wiz-next').addEventListener('click', () => { wiz.step = 2; renderStepBody(); runPreview(); });
}

async function handleFile(file) {
  const statusRoot = document.getElementById('upload-status');
  statusRoot.innerHTML = '<div class="notice notice-info">Membaca file...</div>';
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('File harus berformat .xlsx');
    wiz.file = file;
    const buffer = await file.arrayBuffer();

    // File fingerprint (SHA-256 over raw bytes), independent of parsing.
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    wiz.fileHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const XLSX = await loadXlsx();
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheetName = wiz.module === 'jahit' ? 'JAHIT' : 'SABLON';
    const sheet = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames.find((n) => n.toUpperCase() === sheetName)];
    if (!sheet) throw new Error(`Sheet "${sheetName}" tidak ditemukan di file.`);
    // Key names below MUST match one of backend/ExcelImport.gs's pick_() aliases
    // exactly (verified against the actual backend source): jahit accepts
    // 'order'/'Order Jahit'/'nama_order' — NOT 'order_jahit'; sablon accepts
    // 'design'/'Design Sablon'/'nama_desain' — NOT 'design_sablon'.
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    wiz.rows = wiz.module === 'jahit'
      ? json.map((r) => ({ jenis: String(r['Jenis'] ?? '').trim(), order: String(r['Order Jahit'] ?? '').trim(), jumlah: r['Jumlah'] }))
      : json.map((r) => ({ jenis: String(r['Jenis'] ?? '').trim(), design: String(r['Design Sablon'] ?? '').trim(), warna: r['Warna'], jumlah: r['Jumlah'] }));

    if (!wiz.rows.length) throw new Error('Sheet tidak memiliki baris data.');

    statusRoot.innerHTML = `<div class="notice notice-info">${icon('file', 15)} ${escapeHtml(file.name)} &mdash; ${wiz.rows.length} baris terbaca. Memeriksa fingerprint file...</div>`;

    const fp = await fetchData('checkFileFingerprint', { file_hash: wiz.fileHash }).catch(() => null);
    wiz.fingerprint = fp;
    if (fp && fp.duplicate) {
      statusRoot.innerHTML = `<div class="notice notice-warning">${icon('alert', 15)}
        File ini pernah diimport sebelumnya${fp.previousBatch ? ` (batch <code>${escapeHtml(fp.previousBatch.import_batch_id || fp.previousBatch.id || '')}</code>${fp.previousBatch.imported_at ? ', ' + escapeHtml(fp.previousBatch.imported_at) : ''})` : ''}.
        <div class="form-actions" style="margin-top:8px">
          <button class="btn btn-secondary btn-sm" id="fp-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="fp-again">Import Again</button>
        </div>
      </div>`;
      document.getElementById('fp-cancel').addEventListener('click', () => { wiz.file = null; wiz.rows = []; renderStepBody(); });
      document.getElementById('fp-again').addEventListener('click', () => {
        statusRoot.innerHTML = `<div class="notice notice-info">${icon('check', 15)} ${wiz.rows.length} baris siap diperiksa (Import Again dikonfirmasi).</div>`;
        document.getElementById('wiz-next').disabled = false;
      });
      document.getElementById('wiz-next').disabled = true;
    } else {
      statusRoot.innerHTML = `<div class="notice notice-info">${icon('check', 15)} ${escapeHtml(file.name)} &mdash; ${wiz.rows.length} baris siap diperiksa. Belum pernah diimport sebelumnya.</div>`;
      document.getElementById('wiz-next').disabled = false;
    }
  } catch (err) {
    statusRoot.innerHTML = `<div class="notice notice-critical">${icon('alert', 15)} ${escapeHtml(err.message)}</div>`;
    document.getElementById('wiz-next').disabled = true;
  }
}

// ---- Step 3: Preview (server-computed) -------------------------------------
async function renderStep3(root) {
  root.innerHTML = '<div class="notice notice-info">Menghitung pratinjau harga di server...</div>';
}

// Merges backend's actual response shape — { validRows: [{row, computed:{...}}],
// errors: [{row, error}], summary: {validCount, errorCount, totalNominal} } —
// (verified against backend/ExcelImport.gs's runValidationBatch_, not guessed)
// into one row list sorted by row number for display.
function mergePreviewRows_(batch) {
  const valid = (batch.validRows || []).map((r) => ({
    row: r.row, status: 'valid',
    jenis: r.computed.jenis_label, name: r.computed.nama_order || r.computed.nama_desain,
    warna: r.computed.jumlah_warna, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total
  }));
  const errored = (batch.errors || []).map((r) => ({ row: r.row, status: 'error', error: r.error }));
  return valid.concat(errored).sort((a, b) => a.row - b.row);
}

async function runPreview() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  const res = await postData('importExcel', {
    period_id: period.id, owner_id: wiz.ownerId, module: wiz.module, rows: wiz.rows, file_hash: wiz.fileHash
  });
  if (!res.success) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} ${escapeHtml(res.message || 'Gagal memproses preview.')}</div>
      <div class="form-actions"><button class="btn btn-secondary" id="wiz-back">Kembali</button></div>`;
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 1; renderStepBody(); });
    return;
  }
  wiz.preview = res.data;
  const summary = wiz.preview.summary || {};
  const rows = mergePreviewRows_(wiz.preview);
  const validCount = summary.validCount ?? rows.filter((r) => r.status === 'valid').length;
  const errorCount = summary.errorCount ?? rows.filter((r) => r.status === 'error').length;
  const totalNominal = summary.totalNominal ?? 0;

  root.innerHTML = `
    <div class="stat-strip mb-16">
      <div class="stat-strip__item"><div class="label">Baris Valid</div><div class="value" style="color:var(--status-success-fg)">${validCount}</div></div>
      <div class="stat-strip__item"><div class="label">Baris Error</div><div class="value" style="color:var(--status-critical-fg)">${errorCount}</div></div>
      <div class="stat-strip__item"><div class="label">Total Nominal Tersimpan</div><div class="value">${formatCurrency(totalNominal)}</div></div>
    </div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th>#</th><th>Jenis</th><th>${wiz.module === 'jahit' ? 'Order' : 'Design'}</th>
        ${wiz.module === 'sablon' ? '<th class="num">Warna</th>' : ''}
        <th class="num">Jumlah</th><th class="num">Harga</th><th class="num">Total</th><th>Status</th>
      </tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>${r.row}</td>
          <td>${escapeHtml(r.jenis || '-')}</td>
          <td>${escapeHtml(r.name || '-')}</td>
          ${wiz.module === 'sablon' ? `<td class="num">${r.warna ?? '-'}</td>` : ''}
          <td class="num">${r.jumlah ?? '-'}</td>
          <td class="num">${r.harga !== undefined && r.status === 'valid' ? formatCurrency(r.harga) : '-'}</td>
          <td class="num">${r.total !== undefined && r.status === 'valid' ? formatCurrency(r.total) : '-'}</td>
          <td>${r.status === 'error' ? badge(r.error || 'Error', 'critical') : badge('Valid', 'success')}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div class="form-actions">
      <button class="btn btn-secondary" id="wiz-back">Kembali</button>
      <button class="btn btn-primary" id="wiz-confirm" ${validCount === 0 ? 'disabled' : ''}>Konfirmasi Import (${validCount} baris)</button>
    </div>
  `;
  document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 1; renderStepBody(); });
  document.getElementById('wiz-confirm').addEventListener('click', () => { wiz.step = 3; renderStepBody(); runConfirm(); });
}

// ---- Step 4: Confirm --------------------------------------------------------
async function renderStep4(root) {
  root.innerHTML = '<div class="notice notice-info">Menyimpan transaksi...</div>';
}

async function runConfirm() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  const res = await postData('confirmImport', {
    period_id: period.id, owner_id: wiz.ownerId, module: wiz.module, rows: wiz.rows, file_hash: wiz.fileHash
  });
  if (!res.success) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} ${escapeHtml(res.message || 'Gagal menyimpan import.')}</div>
      <div class="form-actions"><button class="btn btn-secondary" id="wiz-back">Kembali ke Preview</button></div>`;
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 2; renderStepBody(); runPreview(); });
    return;
  }
  toast('Import berhasil disimpan.', 'success');
  const batchId = (res.data && (res.data.import_batch_id || res.data.batchId)) || '';
  root.innerHTML = `
    <div class="notice" style="background:var(--status-success-bg);color:var(--status-success-fg)">${icon('check')} Import berhasil disimpan${batchId ? ` &mdash; Batch <code>${escapeHtml(batchId)}</code>` : ''}.</div>
    <div class="form-actions">
      <a class="btn btn-primary" href="${wiz.module === 'jahit' ? '#/jahit' : '#/sablon'}">Lihat Transaksi ${wiz.module === 'jahit' ? 'Jahit' : 'Sablon'}</a>
      <button class="btn btn-secondary" id="wiz-new">Import File Lain</button>
    </div>
  `;
  document.getElementById('wiz-new').addEventListener('click', () => render(document.getElementById('view')));
}

// ---- Template download ------------------------------------------------------
async function downloadTemplate() {
  try {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const jahitSheet = XLSX.utils.aoa_to_sheet([
      ['Jenis', 'Order Jahit', 'Jumlah'],
      ['Kaos', 'Order A', 20],
      ['Longsleeve', 'Order B', 15],
      ['Kaos', 'Order C', 30]
    ]);
    const sablonSheet = XLSX.utils.aoa_to_sheet([
      ['Jenis', 'Design Sablon', 'Warna', 'Jumlah'],
      ['WATERBASE', 'Logo PINGBRO', 2, 20],
      ['PLASTISOL', 'Design A', 3, 15],
      ['DISHAGER', 'Design B', 1, 30]
    ]);
    XLSX.utils.book_append_sheet(wb, jahitSheet, 'JAHIT');
    XLSX.utils.book_append_sheet(wb, sablonSheet, 'SABLON');
    XLSX.writeFile(wb, 'Template-Import-Brotherhood.xlsx');
  } catch (err) {
    toast('Gagal membuat template: ' + err.message, 'error');
  }
}
