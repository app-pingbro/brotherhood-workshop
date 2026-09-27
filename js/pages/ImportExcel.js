// ============================================================================
// Import Excel — 4-step wizard: Select Period+Owner+Module -> Upload .xlsx
// -> Preview (per-row validation) -> Confirm Import.
// Parses the workbook client-side with SheetJS (CDN, loaded lazily) into
// plain row arrays, computes a SHA-256 file fingerprint client-side (sent
// alongside the parsed rows — the backend expects parsed JSON rows, not raw
// bytes, per BUILD-SPEC), then drives checkFileFingerprint -> importExcel ->
// confirmImport exactly per PRD section 24.
//
// Covers two categories of modules, selected via the same "Modul" dropdown:
//   - Transaksi:  jahit, sablon (original — behavior unchanged)
//   - Penggajian: gaji_jahit, gaji_sablon, gaji_harian, lembur (added later,
//     for menu Penggajian > Import Excel / Download Template Excel). These
//     have no Owner concept (Step 1's Owner field is hidden for them) —
//     each row is matched to a worker by name in its own "Pekerja" column
//     instead. All backend pricing/validation for every module is server-
//     side and identical to manual entry; this file only drives the wizard
//     UI and shapes rows per module — see backend/ExcelImport.gs.
// ============================================================================
import { fetchData, postData } from '../api.js';
import { invalidate, invalidatePrefix } from '../cache.js';
import { formatCurrency, escapeHtml, toast, badge, formatPeriodLabel } from '../ui.js';
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

// ---------------------------------------------------------------------------
// MODULE_DEFS — one entry per importable module. This is the single place
// that knows a module's sheet name, its row shape, and how to show it in the
// Preview table; everything else in this file (steps, parsing, preview,
// confirm) reads from here instead of branching per module ad hoc. Adding a
// future module means adding one entry here, not touching the wizard logic.
//
// Row keys sent to the backend (`parseRow`'s output) MUST match one of
// backend/ExcelImport.gs's pick_() aliases exactly (verified against the
// actual backend source) — jahit/sablon are unchanged from before; the
// gaji_*/lembur keys were added alongside their pick_() aliases in the same
// change.
// ---------------------------------------------------------------------------
const MODULE_DEFS = {
  jahit: {
    label: 'Jahit', group: 'Transaksi', needsOwner: true, sheetName: 'JAHIT',
    templateHeader: ['Jenis', 'Order Jahit', 'Jumlah'],
    templateSample: () => [['Kaos', 'Order A', 20], ['Longsleeve', 'Order B', 15], ['Kaos', 'Order C', 30]],
    parseRow: (r) => ({ jenis: String(r['Jenis'] ?? '').trim(), order: String(r['Order Jahit'] ?? '').trim(), jumlah: r['Jumlah'] }),
    previewCols: [
      { key: 'jenis', label: 'Jenis' },
      { key: 'name', label: 'Order' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ jenis: r.computed.jenis_label, name: r.computed.nama_order, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/jahit', resultLabel: 'Lihat Transaksi Jahit',
    listAction: 'getSewingTransactions', extraInvalidate: []
  },
  sablon: {
    label: 'Sablon', group: 'Transaksi', needsOwner: true, sheetName: 'SABLON',
    templateHeader: ['Jenis', 'Design Sablon', 'Warna', 'Jumlah'],
    templateSample: () => [['WATERBASE', 'Logo PINGBRO', 2, 20], ['PLASTISOL', 'Design A', 3, 15], ['DISHAGER', 'Design B', 1, 30]],
    parseRow: (r) => ({ jenis: String(r['Jenis'] ?? '').trim(), design: String(r['Design Sablon'] ?? '').trim(), warna: r['Warna'], jumlah: r['Jumlah'] }),
    previewCols: [
      { key: 'jenis', label: 'Jenis' },
      { key: 'name', label: 'Design' },
      { key: 'warna', label: 'Warna', align: 'num' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ jenis: r.computed.jenis_label, name: r.computed.nama_desain, warna: r.computed.jumlah_warna, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/sablon', resultLabel: 'Lihat Transaksi Sablon',
    listAction: 'getPrintingTransactions', extraInvalidate: []
  },
  gaji_jahit: {
    label: 'Gaji Jahit (Borongan)', group: 'Penggajian', needsOwner: false, sheetName: 'GAJI JAHIT',
    templateHeader: ['Pekerja', 'Jenis Pekerjaan', 'Nama Order', 'Jumlah'],
    templateSample: (lk) => [[samplePekerja(lk), sampleName(lk, 'sewingJobTypes'), 'Order A', 20]],
    parseRow: (r) => ({ pekerja: String(r['Pekerja'] ?? '').trim(), jenis_pekerjaan: String(r['Jenis Pekerjaan'] ?? '').trim(), order: String(r['Nama Order'] ?? '').trim(), jumlah: r['Jumlah'] }),
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' },
      { key: 'jenis', label: 'Jenis Pekerjaan' },
      { key: 'name', label: 'Order' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga Borongan', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, jenis: r.computed.jenis_label, name: r.computed.nama_order, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/gaji-jahit', resultLabel: 'Lihat Gaji Jahit',
    listAction: 'getSewingWorkerPayments', extraInvalidate: ['getSalarySlip']
  },
  gaji_sablon: {
    label: 'Gaji Sablon (Borongan)', group: 'Penggajian', needsOwner: false, sheetName: 'GAJI SABLON',
    templateHeader: ['Pekerja', 'Jenis Tinta', 'Nama Desain', 'Warna', 'Jumlah'],
    templateSample: (lk) => [[samplePekerja(lk), sampleName(lk, 'inkTypes'), 'Design A', 2, 20]],
    parseRow: (r) => ({ pekerja: String(r['Pekerja'] ?? '').trim(), jenis_tinta: String(r['Jenis Tinta'] ?? '').trim(), design: String(r['Nama Desain'] ?? '').trim(), warna: r['Warna'], jumlah: r['Jumlah'] }),
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' },
      { key: 'jenis', label: 'Jenis Tinta' },
      { key: 'name', label: 'Desain' },
      { key: 'warna', label: 'Warna', align: 'num' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga Borongan', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, jenis: r.computed.jenis_label, name: r.computed.nama_desain, warna: r.computed.jumlah_warna, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/gaji-sablon', resultLabel: 'Lihat Gaji Sablon',
    listAction: 'getPrintingWorkerPayments', extraInvalidate: ['getSalarySlip']
  },
  gaji_harian: {
    label: 'Gaji Harian', group: 'Penggajian', needsOwner: false, sheetName: 'GAJI HARIAN',
    templateHeader: ['Pekerja', 'Jumlah Hari Biasa', 'Jumlah Hari Minggu'],
    templateSample: (lk) => [[samplePekerja(lk), 20, 4]],
    parseRow: (r) => ({ pekerja: String(r['Pekerja'] ?? '').trim(), hari_biasa: r['Jumlah Hari Biasa'], hari_minggu: r['Jumlah Hari Minggu'] }),
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' },
      { key: 'hariBiasa', label: 'Hari Biasa', align: 'num' },
      { key: 'tarifHarian', label: 'Tarif Harian', align: 'num', money: true },
      { key: 'hariMinggu', label: 'Hari Minggu', align: 'num' },
      { key: 'tarifMinggu', label: 'Tarif Minggu', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, hariBiasa: r.computed.jumlah_hari_biasa, tarifHarian: r.computed.tarif_harian, hariMinggu: r.computed.jumlah_hari_minggu, tarifMinggu: r.computed.tarif_minggu, total: r.computed.total }),
    resultLink: '#/gaji-harian', resultLabel: 'Lihat Gaji Harian & Lembur',
    listAction: 'getDailyWorkerPayments', extraInvalidate: ['getSalarySlip']
  },
  lembur: {
    label: 'Lembur', group: 'Penggajian', needsOwner: false, sheetName: 'LEMBUR',
    templateHeader: ['Pekerja', 'Jumlah Jam'],
    templateSample: (lk) => [[samplePekerja(lk), 3]],
    parseRow: (r) => ({ pekerja: String(r['Pekerja'] ?? '').trim(), jam: r['Jumlah Jam'] }),
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' },
      { key: 'jam', label: 'Jam', align: 'num' },
      { key: 'tarif', label: 'Tarif/Jam', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, jam: r.computed.jumlah_jam, tarif: r.computed.tarif_per_jam, total: r.computed.total }),
    resultLink: '#/gaji-harian', resultLabel: 'Lihat Gaji Harian & Lembur',
    listAction: 'getOvertime', extraInvalidate: ['getSalarySlip']
  }
};

function samplePekerja(lk) {
  const rows = (lk?.employees || []).filter((e) => e.active !== false);
  return rows[0] ? rows[0].name : 'Nama Pekerja';
}
function sampleName(lk, key) {
  const rows = (lk?.[key] || []).filter((e) => e.active !== false);
  return rows[0] ? rows[0].name : 'Contoh';
}

const STEPS = ['Periode & Owner', 'Upload File', 'Preview', 'Konfirmasi'];

const wiz = {
  step: 0,
  module: 'jahit',
  periodId: '',
  ownerId: '',
  file: null,
  fileHash: '',
  fingerprint: null,
  rows: [],
  preview: null,
  confirmed: false
};

// Set by goToImportExcel() below (called from the Penggajian pages' "Import
// Excel" button) so this page opens with the right module already selected
// — read once at the top of render() and cleared immediately after.
let pendingModule = null;

/**
 * Navigates to this page with a module pre-selected — used by the "Import
 * Excel" button on Gaji Jahit/Gaji Sablon/Gaji Harian & Lembur so the user
 * doesn't have to re-pick the module they just came from. Reuses this exact
 * page/wizard rather than a separate one for Penggajian.
 */
export function goToImportExcel(moduleKey) {
  pendingModule = moduleKey;
  location.hash = '#/import-excel';
}

export async function render(container) {
  const period = getCurrentPeriod();
  wiz.step = 0; wiz.periodId = period ? period.id : ''; wiz.ownerId = '';
  wiz.module = (pendingModule && MODULE_DEFS[pendingModule]) ? pendingModule : 'jahit';
  pendingModule = null;
  wiz.file = null; wiz.fileHash = ''; wiz.fingerprint = null; wiz.rows = []; wiz.preview = null; wiz.confirmed = false;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Import Excel</h1><div class="subtitle">Input massal transaksi Jahit/Sablon atau data Penggajian lewat file .xlsx &mdash; harga/tarif selalu dihitung server, bukan dari file.</div></div>
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

// ---- Step 1: Period + Module + (Owner only for Transaksi modules) --------
function renderStep1(root) {
  const lk = getLookups();
  const period = getCurrentPeriod();
  const isClosed = period && String(period.status || '').toLowerCase() === 'closed';
  const def = MODULE_DEFS[wiz.module];
  const groups = ['Transaksi', 'Penggajian'];

  root.innerHTML = `
    ${isClosed ? `<div class="notice notice-critical mb-12">${icon('alert')} Periode terpilih berstatus CLOSED &mdash; Import Excel dinonaktifkan sampai periode dibuka kembali.</div>` : ''}
    <div class="form-grid">
      <div class="field">
        <label>Periode</label>
        <div class="field-computed">${escapeHtml(period ? formatPeriodLabel(period) : 'Belum dipilih')}</div>
        <div class="hint">Gunakan selector periode di kanan atas untuk mengganti.</div>
      </div>
      <div class="field">
        <label>Modul <span class="required-mark">*</span></label>
        <select class="input" id="wiz-module">
          ${groups.map((g) => `
            <optgroup label="${escapeHtml(g)}">
              ${Object.entries(MODULE_DEFS).filter(([, d]) => d.group === g).map(([key, d]) => `
                <option value="${key}" ${wiz.module === key ? 'selected' : ''}>${escapeHtml(d.label)}</option>
              `).join('')}
            </optgroup>
          `).join('')}
        </select>
      </div>
      ${def.needsOwner ? `
      <div class="field">
        <label>Owner/Subunit <span class="required-mark">*</span></label>
        <select class="input" id="wiz-owner">
          <option value="">Pilih Owner...</option>
          ${ownerOptions(lk).map((o) => `<option value="${o.value}" ${wiz.ownerId === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
        <div class="hint">Satu file = satu Owner. Seluruh baris pada file berlaku untuk Owner ini.</div>
      </div>` : `
      <div class="field">
        <label>Owner/Subunit</label>
        <div class="field-computed text-low">Tidak digunakan untuk modul Penggajian</div>
        <div class="hint">Setiap baris diidentifikasi lewat kolom Pekerja di file, bukan Owner.</div>
      </div>`}
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="wiz-next" ${isClosed || !period ? 'disabled' : ''}>Lanjut</button>
    </div>
  `;
  document.getElementById('wiz-module').addEventListener('change', (e) => {
    wiz.module = e.target.value;
    // Different module = different sheet/columns, so any file already
    // picked for the previous module is no longer valid — clear it rather
    // than silently carrying over mismatched rows.
    wiz.file = null; wiz.fileHash = ''; wiz.fingerprint = null; wiz.rows = [];
    renderStep1(root);
  });
  if (def.needsOwner) {
    document.getElementById('wiz-owner').addEventListener('change', (e) => { wiz.ownerId = e.target.value; });
  }
  document.getElementById('wiz-next').addEventListener('click', () => {
    if (def.needsOwner && !wiz.ownerId) { toast('Pilih Owner/Subunit terlebih dahulu.', 'error'); return; }
    wiz.step = 1;
    renderStepBody();
  });
}

// ---- Step 2: Upload + parse + fingerprint ---------------------------------
function renderStep2(root) {
  const def = MODULE_DEFS[wiz.module];
  root.innerHTML = `
    <div class="dropzone" id="dropzone">
      ${icon('upload', 28)}
      <p class="mt-8" style="font-weight:700">Seret file .xlsx ke sini, atau klik untuk memilih</p>
      <p class="text-low">Sheet ${escapeHtml(def.sheetName)} (${def.templateHeader.map(escapeHtml).join(', ')})</p>
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
  const def = MODULE_DEFS[wiz.module];
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
    const sheet = wb.Sheets[def.sheetName] || wb.Sheets[wb.SheetNames.find((n) => n.toUpperCase() === def.sheetName)];
    if (!sheet) throw new Error(`Sheet "${def.sheetName}" tidak ditemukan di file.`);
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    wiz.rows = json.map(def.parseRow);

    if (!wiz.rows.length) throw new Error('Sheet tidak memiliki baris data.');

    statusRoot.innerHTML = `<div class="notice notice-info">${icon('file', 15)} ${escapeHtml(file.name)} &mdash; ${wiz.rows.length} baris terbaca. Memeriksa fingerprint file...</div>`;

    const fp = await fetchData('checkFileFingerprint', { file_hash: wiz.fileHash, module: wiz.module }).catch(() => null);
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
  root.innerHTML = '<div class="notice notice-info">Menghitung pratinjau harga/tarif di server...</div>';
}

// Merges backend's actual response shape — { validRows: [{row, computed:{...}}],
// errors: [{row, error}], summary: {validCount, errorCount, totalNominal} } —
// into one row list sorted by row number for display, using the active
// module's own mapValid() so every module's differently-shaped `computed`
// fields land under the same generic {row, status, ...} shape its
// previewCols expects.
function mergePreviewRows_(batch, def) {
  const valid = (batch.validRows || []).map((r) => ({ row: r.row, status: 'valid', ...def.mapValid(r) }));
  const errored = (batch.errors || []).map((r) => ({ row: r.row, status: 'error', error: r.error }));
  return valid.concat(errored).sort((a, b) => a.row - b.row);
}

async function runPreview() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  const def = MODULE_DEFS[wiz.module];
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
  const rows = mergePreviewRows_(wiz.preview, def);
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
        <th>#</th>
        ${def.previewCols.map((c) => `<th class="${c.align === 'num' ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('')}
        <th>Status</th>
      </tr></thead>
      <tbody>${rows.map((r) => `
        <tr>
          <td>${r.row}</td>
          ${def.previewCols.map((c) => {
            if (r.status === 'error') return `<td class="${c.align === 'num' ? 'num' : ''}">-</td>`;
            const v = r[c.key];
            const text = c.money ? formatCurrency(v) : escapeHtml(v ?? '-');
            return `<td class="${c.align === 'num' ? 'num' : ''}">${text}</td>`;
          }).join('')}
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
  // Moving to Step 4 immediately (before runConfirm even starts) removes
  // this button from the DOM right away — a second click (or a double
  // click) has nothing left to click, which is the same double-submit
  // guard the rest of the app already relies on (see _shared.js buildForm).
  document.getElementById('wiz-confirm').addEventListener('click', () => { wiz.step = 3; renderStepBody(); runConfirm(); });
}

// ---- Step 4: Confirm --------------------------------------------------------
async function renderStep4(root) {
  root.innerHTML = '<div class="notice notice-info">Menyimpan data...</div>';
}

async function runConfirm() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  const def = MODULE_DEFS[wiz.module];
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
  // Imported rows land straight in the target sheet via a direct write (not
  // through _shared.js's save flow, or — for Penggajian — via the same
  // Payroll.gs save handlers manual entry uses but still bypassing
  // renderCrudPage's own post-save invalidation), so the cache invalidation
  // that flow normally does has to happen here instead — otherwise the
  // relevant list/Dashboard/Rekap Bulanan/Slip Gaji would keep showing
  // stale (pre-import) cached data until their TTL expires.
  invalidate(def.listAction);
  invalidate('getMonthlyRecap');
  def.extraInvalidate.forEach((action) => invalidate(action));
  invalidatePrefix('dashRecent');
  invalidatePrefix('dashTrend');
  const batchId = (res.data && (res.data.import_batch_id || res.data.batchId)) || '';
  root.innerHTML = `
    <div class="notice" style="background:var(--status-success-bg);color:var(--status-success-fg)">${icon('check')} Import berhasil disimpan${batchId ? ` &mdash; Batch <code>${escapeHtml(batchId)}</code>` : ''}.</div>
    <div class="form-actions">
      <a class="btn btn-primary" href="${def.resultLink}">${escapeHtml(def.resultLabel)}</a>
      <button class="btn btn-secondary" id="wiz-new">Import File Lain</button>
    </div>
  `;
  document.getElementById('wiz-new').addEventListener('click', () => render(document.getElementById('view')));
}

// ---- Template download ------------------------------------------------------
// One combined workbook, one sheet per module (Transaksi + Penggajian) —
// same file whether downloaded from this page or from a Penggajian page's
// "Download Template Excel" button, so there is exactly one template to
// keep in sync, not one per entry point.
async function downloadTemplate() {
  try {
    const lk = getLookups();
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    Object.values(MODULE_DEFS).forEach((def) => {
      const sheet = XLSX.utils.aoa_to_sheet([def.templateHeader, ...def.templateSample(lk)]);
      XLSX.utils.book_append_sheet(wb, sheet, def.sheetName);
    });
    XLSX.writeFile(wb, 'Template-Import-Brotherhood.xlsx');
  } catch (err) {
    toast('Gagal membuat template: ' + err.message, 'error');
  }
}

/**
 * Small header-button factory reused by the three Penggajian pages (Gaji
 * Jahit, Gaji Sablon, Gaji Harian & Lembur) instead of each page building
 * its own "Import Excel"/"Download Template Excel" buttons — one place to
 * keep the labels/behavior consistent.
 */
export function buildImportExcelHeaderButtons(moduleKey) {
  const wrap = document.createElement('div');
  wrap.className = 'header-btn-group';
  wrap.style.display = 'flex';
  wrap.style.gap = '8px';

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'btn btn-secondary';
  importBtn.innerHTML = `${icon('upload', 15)} Import Excel`;
  importBtn.addEventListener('click', () => goToImportExcel(moduleKey));

  const templateBtn = document.createElement('button');
  templateBtn.type = 'button';
  templateBtn.className = 'btn btn-outline';
  templateBtn.innerHTML = `${icon('download', 15)} Download Template Excel`;
  templateBtn.addEventListener('click', () => downloadTemplate());

  wrap.appendChild(importBtn);
  wrap.appendChild(templateBtn);
  return wrap;
}
