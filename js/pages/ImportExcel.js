// ============================================================================
// Import Excel — 4-step wizard: Periode + Owner -> Upload ONE .xlsx ->
// Preview (per-row validation, per-category) -> Konfirmasi.
//
// One file = one sync process covering ALL categories at once:
//   Sheet JAHIT   -> kategori jahit
//   Sheet SABLON  -> kategori sablon
//   Sheet GAJI    -> dipecah berdasarkan kolom "Jenis Gaji" menjadi kategori
//                    gaji_jahit / gaji_sablon / gaji_harian / lembur (Lembur
//                    tidak lagi punya sheet sendiri — digabung ke sini)
//   Sheet KASBON  -> kategori kasbon (baru)
// Sheet yang kosong/tidak ada di file = kategori itu dilewati sepenuhnya,
// data yang sudah ada untuk kategori itu TIDAK disentuh. Baris yang datanya
// sudah ada (dicocokkan lewat identitas alami masing-masing kategori, bukan
// nomor baris Excel — lihat backend/ExcelImport.gs) akan DIPERBARUI, bukan
// diduplikat; baris yang datanya identik dengan yang sudah ada dilewati
// (tidak ditulis ulang). Lihat backend/ExcelImport.gs (runMultiValidationBatch_
// / confirmMultiImport_) untuk aturan pencocokan lengkap per kategori.
//
// Parses the workbook client-side with SheetJS (CDN, loaded lazily) into
// plain row arrays per category, computes a SHA-256 file fingerprint
// client-side, then drives checkFileFingerprintMulti -> importExcelMulti ->
// confirmImportMulti (all three new actions, added alongside the untouched
// single-module actions the app used before this change).
// ============================================================================
import { fetchData, postData } from '../api.js';
import { invalidate, invalidatePrefix } from '../cache.js';
import { formatCurrency, escapeHtml, toast, badge, formatPeriodLabel } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups } from '../state.js';
import { ownerOptions } from '../lookups.js';
import { DEDUCTION_TYPES } from '../config.js';

const DEDUCTION_LABEL = Object.fromEntries(DEDUCTION_TYPES.map((t) => [t.value, t.label]));

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
// CATEGORY_DEFS — one entry per importable category. Everything about how a
// category is PREVIEWED/RESULT-linked lives here; the SHEET_DEFS below (one
// per physical Excel sheet) is where a raw workbook row becomes a category
// row. previewCols/mapValid for jahit/sablon/gaji_jahit/gaji_sablon/
// gaji_harian/lembur are copied verbatim from the single-module wizard this
// replaces — the backend's `computed` shape for those six categories did not
// change, only kasbon is new.
// ---------------------------------------------------------------------------
const CATEGORY_DEFS = {
  jahit: {
    label: 'Jahit', needsOwner: true,
    previewCols: [
      { key: 'jenis', label: 'Jenis' }, { key: 'name', label: 'Order' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ jenis: r.computed.jenis_label, name: r.computed.nama_order, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/jahit', resultLabel: 'Lihat Transaksi Jahit', listAction: 'getSewingTransactions', extraInvalidate: []
  },
  sablon: {
    label: 'Sablon', needsOwner: true,
    previewCols: [
      { key: 'jenis', label: 'Jenis' }, { key: 'name', label: 'Design' },
      { key: 'warna', label: 'Warna', align: 'num' }, { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ jenis: r.computed.jenis_label, name: r.computed.nama_desain, warna: r.computed.jumlah_warna, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/sablon', resultLabel: 'Lihat Transaksi Sablon', listAction: 'getPrintingTransactions', extraInvalidate: []
  },
  gaji_jahit: {
    label: 'Gaji Jahit (Borongan)', needsOwner: false,
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' }, { key: 'jenis', label: 'Jenis Pekerjaan' }, { key: 'name', label: 'Order' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga Borongan', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, jenis: r.computed.jenis_label, name: r.computed.nama_order, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/gaji-jahit', resultLabel: 'Lihat Gaji Jahit', listAction: 'getSewingWorkerPayments', extraInvalidate: ['getSalarySlip']
  },
  gaji_sablon: {
    label: 'Gaji Sablon (Borongan)', needsOwner: false,
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' }, { key: 'jenis', label: 'Jenis Tinta' }, { key: 'name', label: 'Desain' },
      { key: 'warna', label: 'Warna', align: 'num' }, { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga Borongan', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, jenis: r.computed.jenis_label, name: r.computed.nama_desain, warna: r.computed.jumlah_warna, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/gaji-sablon', resultLabel: 'Lihat Gaji Sablon', listAction: 'getPrintingWorkerPayments', extraInvalidate: ['getSalarySlip']
  },
  gaji_harian: {
    label: 'Gaji Harian', needsOwner: false,
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' }, { key: 'hariBiasa', label: 'Hari Biasa', align: 'num' },
      { key: 'tarifHarian', label: 'Tarif Harian', align: 'num', money: true },
      { key: 'hariMinggu', label: 'Hari Minggu', align: 'num' },
      { key: 'tarifMinggu', label: 'Tarif Minggu', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, hariBiasa: r.computed.jumlah_hari_biasa, tarifHarian: r.computed.tarif_harian, hariMinggu: r.computed.jumlah_hari_minggu, tarifMinggu: r.computed.tarif_minggu, total: r.computed.total }),
    resultLink: '#/gaji-harian', resultLabel: 'Lihat Gaji Harian & Lembur', listAction: 'getDailyWorkerPayments', extraInvalidate: ['getSalarySlip']
  },
  lembur: {
    label: 'Lembur', needsOwner: false,
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' }, { key: 'jam', label: 'Jam', align: 'num' },
      { key: 'tarif', label: 'Tarif/Jam', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ pekerja: r.computed.employee_name, jam: r.computed.jumlah_jam, tarif: r.computed.tarif_per_jam, total: r.computed.total }),
    resultLink: '#/gaji-harian', resultLabel: 'Lihat Gaji Harian & Lembur', listAction: 'getOvertime', extraInvalidate: ['getSalarySlip']
  },
  kasbon: {
    label: 'Kasbon & Potongan', needsOwner: false,
    previewCols: [
      { key: 'pekerja', label: 'Pekerja' }, { key: 'jenis', label: 'Jenis' }, { key: 'tanggal', label: 'Tanggal' },
      { key: 'nominal', label: 'Nominal', align: 'num', money: true },
      { key: 'totalHutang', label: 'Total Hutang', align: 'num', money: true },
      { key: 'cicilanKe', label: 'Cicilan ke-', align: 'num' }
    ],
    mapValid: (r) => ({
      pekerja: r.computed.employee_name, jenis: DEDUCTION_LABEL[r.computed.jenis] || r.computed.jenis,
      tanggal: r.computed.tanggal, nominal: r.computed.nominal,
      totalHutang: r.computed.total_hutang || 0, cicilanKe: r.computed.cicilan_ke || '-'
    }),
    resultLink: '#/kasbon', resultLabel: 'Lihat Kasbon & Potongan', listAction: 'getPayrollDeductions', extraInvalidate: []
  }
};

const GAJI_JENIS_MAP = { jahit: 'gaji_jahit', sablon: 'gaji_sablon', harian: 'gaji_harian', lembur: 'lembur' };

function samplePekerja(lk) {
  const rows = (lk?.employees || []).filter((e) => e.active !== false);
  return rows[0] ? rows[0].name : 'Nama Pekerja';
}
function sampleName(lk, key) {
  const rows = (lk?.[key] || []).filter((e) => e.active !== false);
  return rows[0] ? rows[0].name : 'Contoh';
}

function isBlankRow(r) {
  return Object.values(r).every((v) => v === '' || v === null || v === undefined);
}

// Accepts a JS Date (if SheetJS ever returns one), an Excel serial date
// number (SheetJS's default for date-formatted cells), or a plain string —
// always normalizes to "YYYY-MM-DD" before sending to the backend. Mirrors
// backend/ExcelImport.gs's normalizeExcelDate_ so both sides agree on the
// same value regardless of how Excel/Sheets happened to store the cell —
// the same lesson Turn C's Periode display fix already established.
function normalizeDateCell(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && isFinite(v)) {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? s : parsed.toISOString().slice(0, 10);
}

const STEPS = ['Periode & Owner', 'Upload File', 'Preview', 'Konfirmasi'];

const wiz = {
  step: 0,
  periodId: '',
  ownerId: '',
  file: null,
  fileHash: '',
  fingerprint: null,
  categories: null,
  parseWarnings: [],
  preview: null,
  confirmed: false
};

// Set by goToImportExcel() below (called from the Penggajian pages' "Import
// Excel" button) — no longer preselects a module (the wizard now always
// handles every category from one file), but still gives Step 1 a one-line
// contextual hint about where the user came from.
let pendingModule = null;

export function goToImportExcel(moduleKey) {
  pendingModule = moduleKey;
  location.hash = '#/import-excel';
}

export async function render(container) {
  const period = getCurrentPeriod();
  wiz.step = 0; wiz.periodId = period ? period.id : ''; wiz.ownerId = '';
  wiz.file = null; wiz.fileHash = ''; wiz.fingerprint = null; wiz.categories = null; wiz.parseWarnings = [];
  wiz.preview = null; wiz.confirmed = false;
  const cameFrom = pendingModule && CATEGORY_DEFS[pendingModule] ? CATEGORY_DEFS[pendingModule].label : null;
  pendingModule = null;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Import Excel</h1><div class="subtitle">Input massal Jahit/Sablon/Penggajian/Kasbon lewat SATU file .xlsx &mdash; harga/tarif selalu dihitung server, bukan dari file. Sheet yang kosong dilewati; data yang sudah ada diperbarui otomatis, tidak diduplikat.</div></div>
      <div class="page-header__actions"><button class="btn btn-secondary" id="dl-template">${icon('download', 15)} Unduh Template Excel</button></div>
    </div>
    ${cameFrom ? `<div class="notice notice-info mb-12">${icon('file', 15)} Anda datang dari halaman <strong>${escapeHtml(cameFrom)}</strong> &mdash; isi sheet yang sesuai di template (sheet GAJI dengan kolom "Jenis Gaji", atau sheet KASBON), sheet lain boleh dikosongkan.</div>` : ''}
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

// ---- Step 1: Period + Owner (Owner only meaningful for Jahit/Sablon, but
// asked up front like before rather than deferred until after upload) ------
function renderStep1(root) {
  const lk = getLookups();
  const period = getCurrentPeriod();
  const isClosed = period && String(period.status || '').toLowerCase() === 'closed';

  root.innerHTML = `
    ${isClosed ? `<div class="notice notice-critical mb-12">${icon('alert')} Periode terpilih berstatus CLOSED &mdash; Import Excel dinonaktifkan sampai periode dibuka kembali.</div>` : ''}
    <div class="form-grid">
      <div class="field">
        <label>Periode</label>
        <div class="field-computed">${escapeHtml(period ? formatPeriodLabel(period) : 'Belum dipilih')}</div>
        <div class="hint">Gunakan selector periode di kanan atas untuk mengganti.</div>
      </div>
      <div class="field">
        <label>Owner/Subunit <span class="required-mark">*</span></label>
        <select class="input" id="wiz-owner">
          <option value="">Pilih Owner...</option>
          ${ownerOptions(lk).map((o) => `<option value="${o.value}" ${wiz.ownerId === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
        <div class="hint">Hanya dipakai untuk data pada sheet JAHIT/SABLON (jika ada di file). Satu file = satu Owner untuk kedua sheet itu.</div>
      </div>
    </div>
    <div class="notice notice-info mb-12">
      Satu file Excel bisa berisi sebagian atau semua kategori berikut: <strong>Jahit, Sablon, Gaji Jahit, Gaji Sablon, Gaji Harian, Lembur, Kasbon &amp; Potongan</strong> &mdash; semuanya disinkronkan dalam satu kali proses.
      Sheet yang dikosongkan tidak akan diproses, dan data yang sudah ada untuk kategori itu tidak akan terhapus.
    </div>
    <div class="form-actions">
      <button class="btn btn-primary" id="wiz-next" ${isClosed || !period ? 'disabled' : ''}>Lanjut</button>
    </div>
  `;
  document.getElementById('wiz-owner').addEventListener('change', (e) => { wiz.ownerId = e.target.value; });
  document.getElementById('wiz-next').addEventListener('click', () => {
    if (!wiz.ownerId) { toast('Pilih Owner/Subunit terlebih dahulu.', 'error'); return; }
    wiz.step = 1;
    renderStepBody();
  });
}

// ---- Step 2: Upload one workbook, parse every sheet, fingerprint ---------
function renderStep2(root) {
  root.innerHTML = `
    <div class="dropzone" id="dropzone">
      ${icon('upload', 28)}
      <p class="mt-8" style="font-weight:700">Seret file .xlsx ke sini, atau klik untuk memilih</p>
      <p class="text-low">Sheet yang dikenali: JAHIT, SABLON, GAJI, KASBON &mdash; isi salah satu, beberapa, atau semuanya sekaligus.</p>
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
      if (evt === 'drop' && e.dataTransfer.files[0]) handleWorkbook(e.dataTransfer.files[0]);
    });
  });
  input.addEventListener('change', () => { if (input.files[0]) handleWorkbook(input.files[0]); });
  document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 0; renderStepBody(); });
  document.getElementById('wiz-next').addEventListener('click', () => { wiz.step = 2; renderStepBody(); runPreview(); });
}

async function handleWorkbook(file) {
  const statusRoot = document.getElementById('upload-status');
  statusRoot.innerHTML = '<div class="notice notice-info">Membaca file...</div>';
  try {
    if (!/\.xlsx$/i.test(file.name)) throw new Error('File harus berformat .xlsx');
    wiz.file = file;
    const buffer = await file.arrayBuffer();

    const digest = await crypto.subtle.digest('SHA-256', buffer);
    wiz.fileHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

    const XLSX = await loadXlsx();
    const wb = XLSX.read(buffer, { type: 'array' });
    const findSheet = (name) => wb.Sheets[name] || wb.Sheets[wb.SheetNames.find((n) => n.toUpperCase() === name)];

    const categories = { jahit: [], sablon: [], gaji_jahit: [], gaji_sablon: [], gaji_harian: [], lembur: [], kasbon: [] };
    const warnings = [];

    const jahitSheet = findSheet('JAHIT');
    if (jahitSheet) {
      XLSX.utils.sheet_to_json(jahitSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        categories.jahit.push({ jenis: String(r['Jenis'] ?? '').trim(), order: String(r['Order Jahit'] ?? '').trim(), jumlah: r['Jumlah'] });
      });
    }
    const sablonSheet = findSheet('SABLON');
    if (sablonSheet) {
      XLSX.utils.sheet_to_json(sablonSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        categories.sablon.push({ jenis: String(r['Jenis'] ?? '').trim(), design: String(r['Design Sablon'] ?? '').trim(), warna: r['Warna'], jumlah: r['Jumlah'] });
      });
    }
    const gajiSheet = findSheet('GAJI');
    if (gajiSheet) {
      XLSX.utils.sheet_to_json(gajiSheet, { defval: '' }).forEach((r, idx) => {
        if (isBlankRow(r)) return;
        const target = GAJI_JENIS_MAP[String(r['Jenis Gaji'] ?? '').trim().toLowerCase()];
        if (!target) {
          warnings.push(`Sheet GAJI baris ${idx + 2}: kolom "Jenis Gaji" kosong/tidak dikenali ("${r['Jenis Gaji']}") — baris ini diabaikan. Gunakan salah satu: Jahit, Sablon, Harian, Lembur.`);
          return;
        }
        const pekerja = String(r['Pekerja'] ?? '').trim();
        if (target === 'gaji_jahit') categories.gaji_jahit.push({ pekerja, jenis_pekerjaan: String(r['Jenis Pekerjaan/Tinta'] ?? '').trim(), order: String(r['Nama Order/Desain'] ?? '').trim(), jumlah: r['Jumlah'] });
        else if (target === 'gaji_sablon') categories.gaji_sablon.push({ pekerja, jenis_tinta: String(r['Jenis Pekerjaan/Tinta'] ?? '').trim(), design: String(r['Nama Order/Desain'] ?? '').trim(), warna: r['Warna'], jumlah: r['Jumlah'] });
        else if (target === 'gaji_harian') categories.gaji_harian.push({ pekerja, hari_biasa: r['Jumlah Hari Biasa'], hari_minggu: r['Jumlah Hari Minggu'] });
        else categories.lembur.push({ pekerja, jam: r['Jumlah Jam'] });
      });
    }
    const kasbonSheet = findSheet('KASBON');
    if (kasbonSheet) {
      XLSX.utils.sheet_to_json(kasbonSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        categories.kasbon.push({
          pekerja: String(r['Pekerja'] ?? '').trim(), jenis: r['Jenis'], tanggal: normalizeDateCell(r['Tanggal']),
          nominal: r['Nominal'], total_hutang: r['Total Hutang'], nominal_cicilan: r['Nominal Cicilan'],
          cicilan_ke: r['Cicilan ke-'], keterangan: r['Keterangan']
        });
      });
    }

    const presentCounts = Object.entries(categories).filter(([, rows]) => rows.length).map(([m, rows]) => `${CATEGORY_DEFS[m].label} (${rows.length})`);
    if (!presentCounts.length) throw new Error('Tidak ada data pada sheet manapun (JAHIT/SABLON/GAJI/KASBON) di file ini.');

    if ((categories.jahit.length || categories.sablon.length) && !wiz.ownerId) {
      throw new Error('File ini berisi data Jahit/Sablon &mdash; kembali ke Langkah 1 dan pilih Owner/Subunit terlebih dahulu.');
    }

    wiz.categories = categories;
    wiz.parseWarnings = warnings;
    const warningHtml = warnings.length ? `<div class="mt-8" style="color:var(--status-warning-fg)">${warnings.map(escapeHtml).join('<br>')}</div>` : '';

    statusRoot.innerHTML = `<div class="notice notice-info">${icon('file', 15)} ${escapeHtml(file.name)} &mdash; terdeteksi: ${presentCounts.map(escapeHtml).join(', ')}.${warningHtml} Memeriksa apakah file ini pernah diimport...</div>`;

    const fp = await fetchData('checkFileFingerprintMulti', { file_hash: wiz.fileHash }).catch(() => null);
    wiz.fingerprint = fp;
    if (fp && fp.duplicate) {
      statusRoot.innerHTML = `<div class="notice notice-warning">${icon('alert', 15)}
        File ini tampaknya sudah pernah diimport sebelumnya${fp.previousBatch ? ` (batch <code>${escapeHtml(fp.previousBatch.import_batch_id || '')}</code>${fp.previousBatch.imported_at ? ', ' + escapeHtml(fp.previousBatch.imported_at) : ''})` : ''}.
        Data yang sama akan otomatis diperbarui (bukan diduplikat) pada langkah Preview berikutnya &mdash; lanjutkan jika memang ingin mengimport ulang/mengoreksi.
        <div class="form-actions" style="margin-top:8px">
          <button class="btn btn-secondary btn-sm" id="fp-cancel">Batal</button>
          <button class="btn btn-primary btn-sm" id="fp-again">Lanjutkan</button>
        </div>
      </div>`;
      document.getElementById('fp-cancel').addEventListener('click', () => { wiz.file = null; wiz.categories = null; renderStepBody(); });
      document.getElementById('fp-again').addEventListener('click', () => {
        statusRoot.innerHTML = `<div class="notice notice-info">${icon('check', 15)} Siap diperiksa: ${presentCounts.map(escapeHtml).join(', ')}.</div>${warningHtml}`;
        document.getElementById('wiz-next').disabled = false;
      });
      document.getElementById('wiz-next').disabled = true;
    } else {
      statusRoot.innerHTML = `<div class="notice notice-info">${icon('check', 15)} ${escapeHtml(file.name)} siap diperiksa: ${presentCounts.map(escapeHtml).join(', ')}.</div>${warningHtml}`;
      document.getElementById('wiz-next').disabled = false;
    }
  } catch (err) {
    statusRoot.innerHTML = `<div class="notice notice-critical">${icon('alert', 15)} ${escapeHtml(err.message)}</div>`;
    document.getElementById('wiz-next').disabled = true;
  }
}

// ---- Step 3: Preview (server-computed, per category) ----------------------
async function renderStep3(root) {
  root.innerHTML = '<div class="notice notice-info">Menghitung pratinjau harga/tarif di server untuk semua kategori...</div>';
}

function statusBadge(r) {
  if (r.status === 'error') return badge(r.error || 'Error', 'critical');
  if (r.status === 'new') return badge('Baru', 'success');
  if (r.status === 'update') return badge('Diperbarui', 'warning');
  if (r.status === 'skip') return badge('Dilewati (sama)', 'neutral');
  return badge(String(r.status), 'neutral');
}

function renderCategoryPreviewTable(module, cat) {
  const def = CATEGORY_DEFS[module];
  const rows = cat.validRows.map((r) => ({ row: r.row, status: r.matchStatus, warning: r.warning, ...def.mapValid(r) }))
    .concat(cat.errors.map((e) => ({ row: e.row, status: 'error', error: e.error })))
    .sort((a, b) => a.row - b.row);
  return `
    <div class="card mb-16">
      <h3 class="mb-8">${escapeHtml(def.label)}
        <span class="text-low" style="font-weight:400;font-size:.85em">
          (Baru ${cat.summary.newCount} &middot; Diperbarui ${cat.summary.updateCount} &middot; Dilewati ${cat.summary.skipCount} &middot; Gagal ${cat.summary.errorCount})
        </span>
      </h3>
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
            <td>${statusBadge(r)}${r.warning ? `<div class="hint" style="color:var(--status-warning-fg)">${escapeHtml(r.warning)}</div>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
  `;
}

async function runPreview() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  const res = await postData('importExcelMulti', {
    period_id: period.id, owner_id: wiz.ownerId, categories: wiz.categories, file_hash: wiz.fileHash
  });
  if (!res.success) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} ${escapeHtml(res.message || 'Gagal memproses preview.')}</div>
      <div class="form-actions"><button class="btn btn-secondary" id="wiz-back">Kembali</button></div>`;
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 1; renderStepBody(); });
    return;
  }
  wiz.preview = res.data;
  const totals = wiz.preview.totals || {};
  const moduleKeys = Object.keys(wiz.preview.categories);
  const canImport = (totals.newCount || 0) + (totals.updateCount || 0) + (totals.skipCount || 0) > 0;

  root.innerHTML = `
    <div class="stat-strip mb-16">
      <div class="stat-strip__item"><div class="label">Data Baru</div><div class="value" style="color:var(--status-success-fg)">${totals.newCount || 0}</div></div>
      <div class="stat-strip__item"><div class="label">Data Diperbarui</div><div class="value" style="color:var(--status-warning-fg)">${totals.updateCount || 0}</div></div>
      <div class="stat-strip__item"><div class="label">Data Dilewati</div><div class="value text-low">${totals.skipCount || 0}</div></div>
      <div class="stat-strip__item"><div class="label">Gagal</div><div class="value" style="color:var(--status-critical-fg)">${totals.errorCount || 0}</div></div>
    </div>
    ${totals.updateCount ? `<div class="notice notice-warning mb-16">${icon('alert', 15)}
      Ditemukan ${totals.updateCount} data yang sudah ada.<br>Data tersebut akan diperbarui menggunakan data terbaru dari Excel, bukan diduplikat.
    </div>` : ''}
    ${moduleKeys.map((m) => renderCategoryPreviewTable(m, wiz.preview.categories[m])).join('')}
    <div class="form-actions">
      <button class="btn btn-secondary" id="wiz-back">Batal</button>
      <button class="btn btn-primary" id="wiz-confirm" ${canImport ? '' : 'disabled'}>Lanjutkan Import</button>
    </div>
  `;
  document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 1; renderStepBody(); });
  // Moving to Step 4 immediately (before runConfirm even starts) removes
  // this button from the DOM right away — same double-submit guard the
  // single-module wizard already relied on (a second/double click has
  // nothing left to click).
  document.getElementById('wiz-confirm').addEventListener('click', () => { wiz.step = 3; renderStepBody(); runConfirm(); });
}

// ---- Step 4: Confirm --------------------------------------------------------
async function renderStep4(root) {
  root.innerHTML = '<div class="notice notice-info">Menyimpan data...</div>';
}

async function runConfirm() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  const res = await postData('confirmImportMulti', {
    period_id: period.id, owner_id: wiz.ownerId, categories: wiz.categories, file_hash: wiz.fileHash
  });
  if (!res.success) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} ${escapeHtml(res.message || 'Gagal menyimpan import.')}</div>
      <div class="form-actions"><button class="btn btn-secondary" id="wiz-back">Kembali ke Preview</button></div>`;
    document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 2; renderStepBody(); runPreview(); });
    return;
  }
  const data = res.data;
  const s = data.summary || {};
  toast('Import selesai.', 'success');

  // Invalidate caches only for the categories actually present in this file
  // — same reasoning as the single-module wizard: rows land via direct
  // writes / the Payroll.gs save handlers, bypassing renderCrudPage's own
  // post-save invalidation, so it has to happen here.
  Object.keys(wiz.categories || {}).forEach((m) => {
    if (!wiz.categories[m].length) return;
    const def = CATEGORY_DEFS[m];
    invalidate(def.listAction);
    def.extraInvalidate.forEach((a) => invalidate(a));
  });
  invalidate('getMonthlyRecap');
  invalidatePrefix('dashRecent');
  invalidatePrefix('dashTrend');

  const touchedDefs = Object.keys(data.saved || {}).map((m) => CATEGORY_DEFS[m]).filter(Boolean);
  // De-duplicate result links (gaji_harian and lembur point at the same page).
  const seenLinks = new Set();
  const links = touchedDefs.filter((def) => {
    if (seenLinks.has(def.resultLink)) return false;
    seenLinks.add(def.resultLink);
    return true;
  });

  root.innerHTML = `
    <div class="notice" style="background:var(--status-success-bg);color:var(--status-success-fg)">${icon('check')} Import selesai${data.import_batch_id ? ` &mdash; Batch <code>${escapeHtml(data.import_batch_id)}</code>` : ''}.</div>
    <pre class="mt-12" style="background:var(--surface-2, #f4f4f5);padding:12px 16px;border-radius:8px;font-family:inherit;line-height:1.6">Data baru       : ${s.newCount || 0}
Data diperbarui : ${s.updateCount || 0}
Data dilewati   : ${s.skipCount || 0}
Gagal           : ${s.errorCount || 0}</pre>
    ${(data.warnings && data.warnings.length) ? `<div class="notice notice-warning mt-8">${icon('alert', 15)} ${data.warnings.map((w) => escapeHtml(w.message)).join('<br>')}</div>` : ''}
    ${(data.errors && data.errors.length) ? `<div class="notice notice-critical mt-8">${icon('alert', 15)} ${data.errors.length} baris gagal disimpan &mdash; lihat detail status di langkah Preview sebelumnya. Data lain yang sudah benar tetap tersimpan.</div>` : ''}
    <div class="form-actions">
      ${links.map((def) => `<a class="btn btn-primary" href="${def.resultLink}">${escapeHtml(def.resultLabel)}</a>`).join('')}
      <button class="btn btn-secondary" id="wiz-new">Import File Lain</button>
    </div>
  `;
  document.getElementById('wiz-new').addEventListener('click', () => render(document.getElementById('view')));
}

// ---- Template download ------------------------------------------------------
// One combined workbook: JAHIT, SABLON, GAJI (Gaji Jahit + Gaji Sablon +
// Gaji Harian + Lembur digabung lewat kolom "Jenis Gaji"), KASBON (baru).
// Same file whether downloaded from this page or from a Penggajian page's
// "Download Template Excel" button.
async function downloadTemplate() {
  try {
    const lk = getLookups();
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const pekerja = samplePekerja(lk);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Jenis', 'Order Jahit', 'Jumlah'],
      ['Kaos', 'Order A', 20], ['Longsleeve', 'Order B', 15]
    ]), 'JAHIT');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Jenis', 'Design Sablon', 'Warna', 'Jumlah'],
      ['WATERBASE', 'Logo PINGBRO', 2, 20], ['PLASTISOL', 'Design A', 3, 15]
    ]), 'SABLON');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Jenis Gaji', 'Pekerja', 'Jenis Pekerjaan/Tinta', 'Nama Order/Desain', 'Warna', 'Jumlah', 'Jumlah Hari Biasa', 'Jumlah Hari Minggu', 'Jumlah Jam'],
      ['Jahit', pekerja, sampleName(lk, 'sewingJobTypes'), 'Order A', '', 20, '', '', ''],
      ['Sablon', pekerja, sampleName(lk, 'inkTypes'), 'Design A', 2, 20, '', '', ''],
      ['Harian', pekerja, '', '', '', '', 20, 4, ''],
      ['Lembur', pekerja, '', '', '', '', '', '', 3]
    ]), 'GAJI');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Pekerja', 'Jenis', 'Tanggal', 'Nominal', 'Total Hutang', 'Nominal Cicilan', 'Cicilan ke-', 'Keterangan'],
      [pekerja, 'Kasbon', '2026-09-05', 100000, '', '', '', 'Kasbon awal bulan'],
      [pekerja, 'Hutang - Cicilan', '2026-09-05', '', 300000, 50000, 1, 'Cicilan ke-1'],
      [pekerja, 'Potongan Lain', '2026-09-05', 25000, '', '', '', 'Potongan seragam']
    ]), 'KASBON');

    XLSX.writeFile(wb, 'Template-Import-Brotherhood.xlsx');
  } catch (err) {
    toast('Gagal membuat template: ' + err.message, 'error');
  }
}

/**
 * Small header-button factory reused by the three Penggajian pages (Gaji
 * Jahit, Gaji Sablon, Gaji Harian & Lembur) — unchanged signature, one place
 * to keep the labels/behavior consistent. Both buttons now lead into the
 * single multi-category wizard/template rather than a per-module one.
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
