// ============================================================================
// Import Excel — 4-step wizard: Periode -> Upload ONE .xlsx -> Preview
// (per-row validation, per-category) -> Konfirmasi.
//
// Template mengikuti PERSIS struktur file acuan yang diberikan pengguna
// (Template-Import-Brotherhood.xlsx) — sheet-sheet TERPISAH, bukan satu sheet
// "GAJI" dengan kolom diskriminator seperti versi sebelumnya:
//   Sheet JAHIT        -> kategori jahit        (Owner kini kolom PER BARIS)
//   Sheet SABLON       -> kategori sablon       (Owner kini kolom PER BARIS)
//   Sheet GAJI JAHIT   -> kategori gaji_jahit   (sheet sendiri, tidak digabung)
//   Sheet GAJI SABLON  -> kategori gaji_sablon  (sheet sendiri, tidak digabung)
//   Sheet GAJI HARIAN  -> kategori gaji_harian; kolom "Jumlah Jam Lembur" di
//                         sheet yang SAMA dipecah otomatis menjadi kategori
//                         lembur bila > 0 (Lembur tidak punya sheet sendiri)
//   Sheet KASBON       -> kategori kasbon. Setiap baris pekerja punya sampai
//                         3 kolom nominal (Kasbon (PINGBRO), Kasbon (SUNRISE),
//                         Hutang Cicilan) yang masing-masing dipecah menjadi
//                         baris tersendiri (>0 saja) sebelum dikirim ke server.
//   Sheet PENGELUARAN  -> kategori pengeluaran (BARU — lihat requirement #3/#4)
// Sheet yang kosong/tidak ada di file = kategori itu dilewati sepenuhnya,
// data yang sudah ada untuk kategori itu TIDAK disentuh. Baris yang datanya
// sudah ada (dicocokkan lewat identitas alami masing-masing kategori, bukan
// nomor baris Excel — lihat backend/ExcelImport.gs) akan DIPERBARUI, bukan
// diduplikat; baris yang datanya identik dengan yang sudah ada dilewati
// (tidak ditulis ulang). Lihat backend/ExcelImport.gs (runMultiValidationBatch_
// / confirmMultiImport_) untuk aturan pencocokan lengkap per kategori.
//
// Owner untuk JAHIT/SABLON/PENGELUARAN kini kolom PER BARIS (bukan satu
// Owner untuk seluruh file seperti versi sebelumnya) — satu file bisa berisi
// campuran PINGBRO/SUNRISE/BROTHERHOOD (BROTHERHOOD ditolak khusus untuk
// PENGELUARAN, sama seperti input manual).
//
// Parses the workbook client-side with SheetJS (CDN, loaded lazily) into
// plain row arrays per category, computes a SHA-256 file fingerprint
// client-side, then drives checkFileFingerprintMulti -> importExcelMulti ->
// confirmImportMulti (all three actions already generic over an arbitrary
// `categories` map — no backend action was added for Pengeluaran).
// ============================================================================
import { fetchData, postData, newRequestId } from '../api.js';
import { fetchSWR, invalidate, invalidatePrefix } from '../cache.js';
import { formatCurrency, escapeHtml, toast, badge, formatPeriodLabel, openModal, closeModal } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups, setLookups } from '../state.js';
import { DEDUCTION_TYPES } from '../config.js';
import { buildForm } from './_shared.js';

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
// category is PREVIEWED/RESULT-linked lives here. jahit/sablon now show an
// Owner column (per-row, no longer a single wizard-level selection);
// gaji_jahit/gaji_sablon/gaji_harian/lembur are unchanged from before;
// pengeluaran is new.
// ---------------------------------------------------------------------------
const CATEGORY_DEFS = {
  jahit: {
    label: 'Jahit', needsOwner: false,
    previewCols: [
      { key: 'owner', label: 'Owner' }, { key: 'jenis', label: 'Jenis' }, { key: 'name', label: 'Order' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ owner: r.computed.owner_name, jenis: r.computed.jenis_label, name: r.computed.nama_order, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
    resultLink: '#/jahit', resultLabel: 'Lihat Transaksi Jahit', listAction: 'getSewingTransactions', extraInvalidate: []
  },
  sablon: {
    label: 'Sablon', needsOwner: false,
    previewCols: [
      { key: 'owner', label: 'Owner' }, { key: 'jenis', label: 'Jenis' }, { key: 'name', label: 'Design' },
      { key: 'warna', label: 'Warna', align: 'num' }, { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', money: true },
      { key: 'total', label: 'Total', align: 'num', money: true }
    ],
    mapValid: (r) => ({ owner: r.computed.owner_name, jenis: r.computed.jenis_label, name: r.computed.nama_desain, warna: r.computed.jumlah_warna, jumlah: r.computed.jumlah, harga: r.computed.harga, total: r.computed.total }),
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
      { key: 'pekerja', label: 'Pekerja' }, { key: 'jenis', label: 'Jenis' },
      { key: 'keterangan', label: 'Keterangan' },
      { key: 'nominal', label: 'Nominal', align: 'num', money: true }
    ],
    mapValid: (r) => ({
      pekerja: r.computed.employee_name, jenis: DEDUCTION_LABEL[r.computed.jenis] || r.computed.jenis,
      keterangan: r.computed.keterangan, nominal: r.computed.nominal
    }),
    resultLink: '#/kasbon', resultLabel: 'Lihat Kasbon & Potongan', listAction: 'getPayrollDeductions', extraInvalidate: []
  },
  pengeluaran: {
    label: 'Pengeluaran', needsOwner: false,
    previewCols: [
      { key: 'owner', label: 'Owner' }, { key: 'tanggal', label: 'Tanggal' },
      { key: 'jenis', label: 'Jenis Pengeluaran' }, { key: 'keterangan', label: 'Keterangan' },
      { key: 'nominal', label: 'Nominal', align: 'num', money: true }
    ],
    mapValid: (r) => ({
      owner: r.computed.owner_name, tanggal: r.computed.tanggal,
      jenis: r.computed.expense_type_name + (r.computed.isNewExpenseType ? ' (baru)' : ''),
      keterangan: r.computed.keterangan, nominal: r.computed.nominal
    }),
    resultLink: '#/pengeluaran', resultLabel: 'Lihat Pengeluaran', listAction: 'getExpenses', extraInvalidate: []
  }
};

// ---------------------------------------------------------------------------
// CATEGORY_EDIT_FIELDS — Preview "Edit" button (requirement #2): one
// buildForm-compatible field array per category, keyed EXACTLY to the raw
// field names each category's row objects use in wiz.categories (see
// handleWorkbook above), so a saved edit can be merged straight back into
// that same raw row and re-sent through the normal preview/validate flow —
// no separate edit-specific backend endpoint needed. Dropdown options are
// sourced from Master Data (getLookups()) wherever the raw field is
// name-matched server-side (Pekerja/Jenis/Owner/etc.), so a corrected value
// is guaranteed to exist in Master Data before the user can even submit it.
// ---------------------------------------------------------------------------
function activeOptions(list) {
  return (list || []).filter((x) => x.active !== false).map((x) => ({ value: x.name, label: x.name }));
}

const CATEGORY_EDIT_FIELDS = {
  jahit: (lk) => [
    { key: 'owner', label: 'Owner', type: 'select', required: true, options: () => activeOptions(lk?.owners) },
    { key: 'jenis', label: 'Jenis', type: 'select', required: true, options: () => activeOptions(lk?.productTypes) },
    { key: 'order', label: 'Order Jahit', required: true },
    { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1, noGroup: true }
  ],
  sablon: (lk) => [
    { key: 'owner', label: 'Owner', type: 'select', required: true, options: () => activeOptions(lk?.owners) },
    { key: 'jenis', label: 'Jenis', type: 'select', required: true, options: () => activeOptions(lk?.inkTypes) },
    { key: 'design', label: 'Design Sablon', required: true },
    { key: 'warna', label: 'Warna', type: 'number', required: true, min: 1, noGroup: true },
    { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1, noGroup: true }
  ],
  gaji_jahit: (lk) => [
    { key: 'pekerja', label: 'Pekerja', type: 'select', required: true, options: () => activeOptions(lk?.employees) },
    { key: 'jenis_pekerjaan', label: 'Jenis Pekerjaan', type: 'select', required: true, options: () => activeOptions(lk?.sewingJobTypes) },
    { key: 'order', label: 'Nama Order', required: true },
    { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1, noGroup: true }
  ],
  gaji_sablon: (lk) => [
    { key: 'pekerja', label: 'Pekerja', type: 'select', required: true, options: () => activeOptions(lk?.employees) },
    { key: 'jenis_tinta', label: 'Jenis Tinta', type: 'select', required: true, options: () => activeOptions(lk?.inkTypes) },
    { key: 'design', label: 'Nama Desain', required: true },
    { key: 'warna', label: 'Warna', type: 'number', required: true, min: 1, noGroup: true },
    { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1, noGroup: true }
  ],
  gaji_harian: (lk) => [
    { key: 'pekerja', label: 'Pekerja', type: 'select', required: true, options: () => activeOptions(lk?.employees) },
    { key: 'hari_biasa', label: 'Jumlah Hari Biasa', type: 'number', required: true, min: 0, noGroup: true },
    { key: 'hari_minggu', label: 'Jumlah Hari Minggu', type: 'number', required: true, min: 0, noGroup: true }
  ],
  lembur: (lk) => [
    { key: 'pekerja', label: 'Pekerja', type: 'select', required: true, options: () => activeOptions(lk?.employees) },
    { key: 'jam', label: 'Jumlah Jam', type: 'number', required: true, min: 1, noGroup: true }
  ],
  kasbon: (lk) => [
    { key: 'pekerja', label: 'Pekerja', type: 'select', required: true, options: () => activeOptions(lk?.employees) },
    { key: 'jenis', label: 'Jenis', type: 'select', required: true,
      options: () => [{ value: 'Kasbon', label: 'Kasbon' }, { value: 'Potongan Lain', label: 'Potongan Lain' }] },
    { key: 'keterangan', label: 'Keterangan', required: false },
    { key: 'nominal', label: 'Nominal', type: 'number', required: true, min: 0 }
  ],
  pengeluaran: (lk) => [
    { key: 'owner', label: 'Owner', type: 'select', required: true,
      options: () => (lk?.owners || []).filter((o) => o.active !== false && String(o.code || '').toUpperCase() !== 'BROTHERHOOD').map((o) => ({ value: o.name, label: o.name })) },
    { key: 'tanggal', label: 'Tanggal', type: 'date', required: true },
    { key: 'jenis', label: 'Jenis Pengeluaran', required: true, datalist: () => (lk?.expenseTypes || []).map((e) => e.name) },
    { key: 'keterangan', label: 'Keterangan', required: false },
    { key: 'nominal', label: 'Nominal', type: 'number', required: true, min: 1 }
  ]
};

/**
 * Opens the "Edit" modal for one failed preview row (requirement #2): looks
 * up the raw row this preview row came from (wiz.categories[module][rowNum-1]
 * — the same 1-based `row` numbering validateAndPriceRow_ already uses
 * throughout), lets the user correct it via the shared buildForm engine, then
 * merges the corrected fields back into wiz.categories and re-runs the FULL
 * server preview (runPreview) so the fix is revalidated exactly the same way
 * as every other row — no separate "single row" validation path to trust.
 */
function openEditRowModal(module, rowNum) {
  const rawList = wiz.categories && wiz.categories[module];
  const editFieldsFn = CATEGORY_EDIT_FIELDS[module];
  if (!rawList || !rawList[rowNum - 1] || !editFieldsFn) return;
  const raw = rawList[rowNum - 1];
  const def = CATEGORY_DEFS[module];
  const lk = getLookups();
  const errRow = ((wiz.preview && wiz.preview.categories[module] && wiz.preview.categories[module].errors) || [])
    .find((e) => e.row === rowNum);

  openModal({
    title: `Edit Baris ${rowNum} — ${def.label}`,
    bodyHtml: `${errRow ? `<div class="notice notice-critical mb-12">${icon('alert', 15)} ${escapeHtml(errRow.error)}</div>` : ''}<div id="edit-row-form-root"></div>`,
    onMount: (body) => {
      buildForm(body.querySelector('#edit-row-form-root'), editFieldsFn(lk), { ...raw }, lk, async (finalValues) => {
        rawList[rowNum - 1] = { ...raw, ...finalValues };
        closeModal();
        toast('Baris diperbarui, memvalidasi ulang...', 'success');
        wiz.step = 2;
        renderStepBody();
        runPreview();
      }, { submitLabel: 'Simpan & Validasi Ulang' });
    }
  });
}

// Physical sheet names, in the exact order/labels the user's required
// preview-summary format uses (requirement #5 — "JAHIT : 25 data", dst).
// This is intentionally per PHYSICAL SHEET, not per backend category: GAJI
// HARIAN's "Jumlah Jam Lembur" column and KASBON's 3 nominal columns each
// expand into more than one backend row/category, but the user only wants
// one line per sheet they actually filled in.
const SHEET_LABEL_ORDER = ['JAHIT', 'SABLON', 'GAJI JAHIT', 'GAJI SABLON', 'GAJI HARIAN', 'KASBON', 'PENGELUARAN'];

// Which category a page's "Import Excel" button should hint the user toward
// filling in — used only for the one-line contextual notice on Step 1.
const MODULE_SHEET_HINT = {
  gaji_jahit: 'GAJI JAHIT',
  gaji_sablon: 'GAJI SABLON',
  gaji_harian: 'GAJI HARIAN (kolom "Jumlah Jam Lembur" untuk Lembur)',
  lembur: 'GAJI HARIAN (kolom "Jumlah Jam Lembur")',
  kasbon: 'KASBON',
  pengeluaran: 'PENGELUARAN'
};

function samplePekerja(lk) {
  const rows = (lk?.employees || []).filter((e) => e.active !== false);
  return rows[0] ? rows[0].name : 'Nama Pekerja';
}
function sampleName(lk, key) {
  const rows = (lk?.[key] || []).filter((e) => e.active !== false);
  return rows[0] ? rows[0].name : 'Contoh';
}
function sampleOwnerName(lk) {
  const rows = (lk?.owners || []).filter((o) => o.active !== false && String(o.code || '').toUpperCase() !== 'BROTHERHOOD');
  return rows[0] ? rows[0].name : 'PINGBRO';
}

function isBlankRow(r) {
  return Object.values(r).every((v) => v === '' || v === null || v === undefined);
}

// Defensive fallback for the PENGELUARAN sheet's column headers only (part
// of Issue #1's "perbaiki mapping ... nominal" fix): SheetJS's
// sheet_to_json() keys each row object by the EXACT header cell text, so a
// real-world file whose header has different case/extra spaces ("NOMINAL",
// "Nominal ", "nominal (Rp)") would silently read as undefined -> '' with a
// plain `r['Nominal']` lookup, which is indistinguishable downstream from a
// genuinely empty cell. This only adds a case/whitespace-tolerant fallback
// AFTER an exact match fails — it never changes behavior for a file whose
// headers already match exactly (the common case).
//
// Also used by the KASBON sheet's 4 column reads (Feature E, Issue #2
// lanjutan — "KASBON TIDAK MASUK" persisting after the toNum() fix), where
// headers like "Kasbon (PINGBRO)" commonly show up in a real user's own
// file as "KASBON (PINGBRO)", "Kasbon(PINGBRO)" with NO space before the
// parenthesis, "Kasbon  (PINGBRO)" with extra spaces, etc. The normalize()
// step below collapses any run of whitespace to a single space AND strips
// whitespace immediately touching "(" / ")", so all of the variants above
// compare equal to the canonical header — not just a case-insensitive trim.
function pickCell(row, name) {
  if (row[name] !== undefined) return row[name];
  const normalize = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ').replace(/\s*([()])\s*/g, '$1');
  const target = normalize(name);
  const key = Object.keys(row).find((k) => normalize(k) === target);
  return key !== undefined ? row[key] : '';
}

// Root cause of Issue #2 ("KASBON TIDAK MASUK"): toNum() used to be a plain
// Number(v), which reads Indonesian dot-grouped currency text wrong for any
// amount with 2+ thousand-separator dots — Number('500.000') -> 500 (the
// dot is misread as a decimal point) and Number('1.500.000') -> NaN -> 0
// (more than one dot is simply not a valid JS number literal at all). Since
// the KASBON sheet's Kasbon (PINGBRO)/Kasbon (SUNRISE)/Hutang Cicilan
// columns are only pushed into categories.kasbon when their value is > 0,
// a genuine Kasbon amount like "1.500.000" silently became 0 and the whole
// row was dropped with no error shown anywhere — exactly the reported
// symptom. This mirrors backend/ExcelImport.gs's parseExcelCurrency_ (same
// Indonesian/European "." thousands vs US "," thousands disambiguation,
// same actual-decimal-vs-thousands-group heuristic) so both sides agree on
// every value, ported to plain client-side JS. The name/signature is kept
// identical so every existing call site (Kasbon's 3 amount columns, Gaji
// Harian's Jumlah Jam Lembur spin-off check) benefits with no other change.
function toNum(v) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;

  let s = String(v).trim();
  if (!s) return 0;
  // Strip everything except digits, '.', ',', '-' (drops "Rp", "IDR", spaces, etc).
  s = s.replace(/[^\d,.\-]/g, '');
  if (!s) return 0;

  const negative = s.charAt(0) === '-';
  if (negative) s = s.slice(1);
  if (!s) return 0;

  const hasDot = s.indexOf('.') !== -1;
  const hasComma = s.indexOf(',') !== -1;
  let n;

  if (hasDot && hasComma) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Indonesian/European: '.' thousands, ',' decimal -> "1.500.000,50"
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US: ',' thousands, '.' decimal -> "1,500,000.50"
      s = s.replace(/,/g, '');
    }
    n = parseFloat(s);
  } else if (hasDot) {
    const dotParts = s.split('.');
    const allGroupsOf3 = dotParts.length > 1 && dotParts.slice(1).every((p) => p.length === 3);
    n = parseFloat(allGroupsOf3 ? dotParts.join('') : s);
  } else if (hasComma) {
    const commaParts = s.split(',');
    const allGroupsOf3C = commaParts.length > 1 && commaParts.slice(1).every((p) => p.length === 3);
    n = parseFloat(allGroupsOf3C ? commaParts.join('') : s.replace(',', '.'));
  } else {
    n = parseFloat(s);
  }

  if (isNaN(n)) return 0;
  return negative ? -n : n;
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
  // Teks tanggal gaya Indonesia (hari dulu): "04/09/2026", "4-9-26", "4 September 2026".
  // new Date("04/09/2026") akan terbaca bulan-dulu (9 April) dan toISOString() menggesernya
  // ke zona UTC (tanggal bisa mundur sehari) — keduanya membuat Pengeluaran tidak cocok saat impor ulang.
  const dmy = parseDmyText(s);
  if (dmy) return dmy;
  const parsed = new Date(s);
  if (isNaN(parsed.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

const MONTHS_ID = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, agus: 8, agustus: 8, aug: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, nov: 11, november: 11, des: 12, desember: 12, dec: 12 };
function parseDmyText(s) {
  let d, m, y, mm = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(s);
  if (mm) { d = +mm[1]; m = +mm[2]; y = +mm[3]; } else {
    mm = /^(\d{1,2})[\s/\-.]+([A-Za-z]+)\.?[\s/\-.,]+(\d{2}|\d{4})$/.exec(s);
    if (!mm) return '';
    d = +mm[1]; m = MONTHS_ID[mm[2].toLowerCase()]; y = +mm[3];
    if (!m) return '';
  }
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Hash ISI file (bukan byte file): sama untuk dua file Excel yang isinya sama walau disimpan ulang /
// urutan baris berbeda. Dipakai untuk mengenali "file ini sudah pernah diimport".
async function contentHashOf(categories) {
  const norm = (v) => (typeof v === 'string' ? v.normalize('NFKC').replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() : (v === null || v === undefined ? '' : String(v)));
  const mods = Object.keys(categories || {}).filter((m) => (categories[m] || []).length).sort();
  const canon = mods.map((m) => [m, categories[m].map((r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, norm(r[k])]))).sort()]);
  const bytes = new TextEncoder().encode(JSON.stringify(canon));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const STEPS = ['Periode', 'Upload File', 'Preview', 'Konfirmasi'];

const wiz = {
  step: 0,
  periodId: '',
  file: null,
  fileHash: '',
  fingerprint: null,
  categories: null,
  sheetCounts: null,
  parseWarnings: [],
  preview: null,
  confirmed: false,
  confirmKey: '',     // satu kunci per preview: konfirmasi ganda / retry memakai kunci yang sama (anti-dobel)
  rowFilter: 'all'
};

// ---- ID Transaksi -----------------------------------------------------------
// 5 sheet bertransaksi punya kolom "ID Transaksi" (identitas permanen baris). Sheet lain
// (GAJI HARIAN, KASBON) tidak memakainya.
const TRX_MODULES = ['jahit', 'sablon', 'gaji_jahit', 'gaji_sablon', 'pengeluaran'];
const ID_COL = 'ID Transaksi';
const ID_SHEETS = {
  jahit: { name: 'JAHIT', header: ['Owner', 'Jenis', 'Order Jahit', 'Jumlah'], keys: ['owner', 'jenis', 'order', 'jumlah'] },
  sablon: { name: 'SABLON', header: ['Owner', 'Jenis', 'Design Sablon', 'Warna', 'Jumlah'], keys: ['owner', 'jenis', 'design', 'warna', 'jumlah'] },
  gaji_jahit: { name: 'GAJI JAHIT', header: ['Pekerja', 'Jenis Pekerjaan', 'Nama Order', 'Jumlah'], keys: ['pekerja', 'jenis_pekerjaan', 'order', 'jumlah'] },
  gaji_sablon: { name: 'GAJI SABLON', header: ['Pekerja', 'Jenis Tinta', 'Nama Desain', 'Warna', 'Jumlah'], keys: ['pekerja', 'jenis_tinta', 'design', 'warna', 'jumlah'] },
  pengeluaran: { name: 'PENGELUARAN', header: ['Owner', 'Tanggal', 'Jenis Pengeluaran', 'Keterangan', 'Nominal'], keys: ['owner', 'tanggal', 'jenis', 'keterangan', 'nominal'] }
};
// Hanya menambahkan trx_id bila sel ID terisi — file lama (tanpa ID) menghasilkan baris mentah yang sama persis seperti dulu.
function withTrx(obj, row) {
  const id = String(pickCell(row, ID_COL) ?? '').replace(/\s+/g, '').toUpperCase();
  if (id) obj.trx_id = id;
  return obj;
}

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
  wiz.step = 0; wiz.periodId = period ? period.id : '';
  wiz.file = null; wiz.fileHash = ''; wiz.fingerprint = null; wiz.categories = null; wiz.sheetCounts = null; wiz.parseWarnings = [];
  wiz.preview = null; wiz.confirmed = false; wiz.confirmKey = ''; wiz.rowFilter = 'all';
  const cameFromKey = pendingModule && CATEGORY_DEFS[pendingModule] ? pendingModule : null;
  const cameFrom = cameFromKey ? CATEGORY_DEFS[cameFromKey].label : null;
  pendingModule = null;

  container.innerHTML = `
    <div class="page-header">
      <div><h1>Import Excel</h1><div class="subtitle">Input massal Jahit/Sablon/Penggajian/Kasbon/Pengeluaran lewat SATU file .xlsx &mdash; harga/tarif selalu dihitung server, bukan dari file. Sheet yang kosong dilewati; data yang sudah ada diperbarui otomatis, tidak diduplikat.</div></div>
      <div class="page-header__actions"><button class="btn btn-secondary" id="dl-export" title="Unduh transaksi periode ini lengkap dengan kolom ID Transaksi — dasar paling aman untuk mengedit lalu mengimpor ulang">${icon('download', 15)} Unduh Data Periode (dengan ID)</button><button class="btn btn-secondary" id="dl-template">${icon('download', 15)} Unduh Template Excel</button></div>
    </div>
    ${cameFrom ? `<div class="notice notice-info mb-12">${icon('file', 15)} Anda datang dari halaman <strong>${escapeHtml(cameFrom)}</strong> &mdash; isi sheet <strong>${escapeHtml(MODULE_SHEET_HINT[cameFromKey] || cameFrom)}</strong> di template, sheet lain boleh dikosongkan.</div>` : ''}
    <div class="wizard-steps" id="wizard-steps"></div>
    <div class="card" id="wizard-body"></div>
  `;

  document.getElementById('dl-template').addEventListener('click', downloadTemplate);
  document.getElementById('dl-export').addEventListener('click', downloadPeriodData);
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

// ---- Step 1: Period only — Owner is no longer a wizard-level selection, it
// is now a per-row column on the JAHIT/SABLON/PENGELUARAN sheets themselves. --
function renderStep1(root) {
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
    </div>
    <div class="notice notice-info mb-12">
      Satu file Excel bisa berisi sebagian atau semua sheet berikut: <strong>JAHIT, SABLON, GAJI JAHIT, GAJI SABLON, GAJI HARIAN, KASBON, PENGELUARAN</strong> &mdash; semuanya disinkronkan dalam satu kali proses.
      Kolom <strong>Owner</strong> pada sheet JAHIT/SABLON/PENGELUARAN kini diisi per baris &mdash; satu file boleh berisi campuran Owner yang berbeda.
      Sheet yang dikosongkan tidak akan diproses, dan data yang sudah ada untuk sheet itu tidak akan terhapus.
    </div>
    <div class="notice notice-info mb-12"><div>
      <strong>ID Transaksi</strong> (kolom A) adalah identitas permanen tiap transaksi: awalan jenis + nomor urut minimal 2 digit &mdash;
      Jahit <code>JHT-01</code>, Sablon <code>SBL-01</code>, Gaji Jahit <code>GJT-01</code>, Gaji Sablon <code>GSB-01</code>, Pengeluaran <code>PGL-01</code> (boleh bertambah: <code>JHT-100</code>).
      Boleh diketik sendiri atau dikosongkan (otomatis diberi nomor berikutnya). ID sama + isi sama = <em>Tidak berubah</em>, ID sama + nilai berbeda = <em>Diperbarui</em>, ID baru/kosong = <em>Baru</em>.
      ID yang sudah dipakai transaksi lain, atau formatnya salah, ditampilkan sebagai <em>Konflik</em> dan tidak menimpa data apa pun.
      Untuk mengedit data yang sudah ada, klik <strong>Unduh Data Periode (dengan ID)</strong>, ubah di file itu, lalu impor kembali. File lama tanpa kolom ID tetap bisa diimpor (dicocokkan lewat isi data).
    </div></div>
    <div class="form-actions">
      <button class="btn btn-primary" id="wiz-next" ${isClosed || !period ? 'disabled' : ''}>Lanjut</button>
    </div>
  `;
  document.getElementById('wiz-next').addEventListener('click', () => {
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
      <p class="text-low">Sheet yang dikenali: JAHIT, SABLON, GAJI JAHIT, GAJI SABLON, GAJI HARIAN, KASBON, PENGELUARAN &mdash; isi salah satu, beberapa, atau semuanya sekaligus.</p>
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
    const findSheet = (name) => wb.Sheets[name] || wb.Sheets[wb.SheetNames.find((n) => n.toUpperCase().trim() === name)];

    const categories = { jahit: [], sablon: [], gaji_jahit: [], gaji_sablon: [], gaji_harian: [], lembur: [], kasbon: [], pengeluaran: [] };
    const sheetCounts = {}; // physical-sheet row counts, drives the exact-format summary (requirement #5)
    const warnings = [];

    const jahitSheet = findSheet('JAHIT');
    if (jahitSheet) {
      let n = 0;
      XLSX.utils.sheet_to_json(jahitSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        n++;
        categories.jahit.push(withTrx({ owner: String(r['Owner'] ?? '').trim(), jenis: String(r['Jenis'] ?? '').trim(), order: String(r['Order Jahit'] ?? '').trim(), jumlah: r['Jumlah'] }, r));
      });
      if (n) sheetCounts['JAHIT'] = n;
    }
    const sablonSheet = findSheet('SABLON');
    if (sablonSheet) {
      let n = 0;
      XLSX.utils.sheet_to_json(sablonSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        n++;
        categories.sablon.push(withTrx({ owner: String(r['Owner'] ?? '').trim(), jenis: String(r['Jenis'] ?? '').trim(), design: String(r['Design Sablon'] ?? '').trim(), warna: r['Warna'], jumlah: r['Jumlah'] }, r));
      });
      if (n) sheetCounts['SABLON'] = n;
    }
    const gajiJahitSheet = findSheet('GAJI JAHIT');
    if (gajiJahitSheet) {
      let n = 0;
      XLSX.utils.sheet_to_json(gajiJahitSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        n++;
        categories.gaji_jahit.push(withTrx({ pekerja: String(r['Pekerja'] ?? '').trim(), jenis_pekerjaan: String(r['Jenis Pekerjaan'] ?? '').trim(), order: String(r['Nama Order'] ?? '').trim(), jumlah: r['Jumlah'] }, r));
      });
      if (n) sheetCounts['GAJI JAHIT'] = n;
    }
    const gajiSablonSheet = findSheet('GAJI SABLON');
    if (gajiSablonSheet) {
      let n = 0;
      XLSX.utils.sheet_to_json(gajiSablonSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        n++;
        categories.gaji_sablon.push(withTrx({ pekerja: String(r['Pekerja'] ?? '').trim(), jenis_tinta: String(r['Jenis Tinta'] ?? '').trim(), design: String(r['Nama Desain'] ?? '').trim(), warna: r['Warna'], jumlah: r['Jumlah'] }, r));
      });
      if (n) sheetCounts['GAJI SABLON'] = n;
    }
    const gajiHarianSheet = findSheet('GAJI HARIAN');
    if (gajiHarianSheet) {
      let n = 0;
      XLSX.utils.sheet_to_json(gajiHarianSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        n++;
        const pekerja = String(r['Pekerja'] ?? '').trim();
        categories.gaji_harian.push({ pekerja, hari_biasa: r['Jumlah Hari Biasa'], hari_minggu: r['Jumlah Hari Minggu'] });
        // Lembur is embedded in this same sheet (per the uploaded template) —
        // only spun off into its own category row when actually > 0, so a
        // worker with no overtime this period doesn't get a spurious
        // 0-jam Overtime row.
        const jam = toNum(r['Jumlah Jam Lembur']);
        if (jam > 0) categories.lembur.push({ pekerja, jam: r['Jumlah Jam Lembur'] });
      });
      if (n) sheetCounts['GAJI HARIAN'] = n;
    }
    const kasbonSheet = findSheet('KASBON');
    if (kasbonSheet) {
      let n = 0;
      XLSX.utils.sheet_to_json(kasbonSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        n++;
        // New per-owner KASBON template (Pekerja / Jenis / Kasbon (PINGBRO) /
        // Kasbon (SUNRISE) / Hutang Cicilan) — up to 3 backend rows per sheet
        // row, one per non-empty amount bucket. "Jenis" itself is read but
        // unused (kept in the template for the user's own reference) — each
        // bucket's own fixed Keterangan is what tells the backend which kind
        // of deduction it is (see backend/ExcelImport.gs mapDeductionJenis_).
        //
        // Root cause of Issue #2 continuing after the toNum() fix ("KASBON
        // TIDAK MASUK"): a plain `r['Kasbon (PINGBRO)']` lookup only matches
        // when the Excel header is byte-for-byte identical — a real user's
        // own file (not the downloaded template) commonly has a slightly
        // different header ("KASBON (PINGBRO)", "Kasbon(PINGBRO)" with no
        // space, a trailing space, etc). When that happens the lookup is
        // `undefined`, toNum(undefined) is 0, the `> 0` gate never fires, and
        // the row is dropped with NO error anywhere — this sheet's own
        // "Ringkasan Data per Sheet" count still shows it had N rows (that
        // count is taken before this column lookup), which is exactly the
        // "Excel sudah berisi data ... tetapi setelah import data tidak
        // masuk" symptom, with no clue as to why. pickCell (already used for
        // PENGELUARAN's Nominal column, Issue #1's fix in an earlier turn)
        // is now applied here too: it falls back to a case/whitespace-
        // tolerant header match only when the exact key is missing, so a
        // file whose headers already match exactly behaves identically.
        const pekerja = String(pickCell(r, 'Pekerja') ?? '').trim();
        const pingbro = toNum(pickCell(r, 'Kasbon (PINGBRO)'));
        const sunrise = toNum(pickCell(r, 'Kasbon (SUNRISE)'));
        const hutang = toNum(pickCell(r, 'Hutang Cicilan'));
        if (pingbro > 0) categories.kasbon.push({ pekerja, jenis: 'Kasbon', nominal: pingbro, keterangan: 'Kasbon (PINGBRO)' });
        if (sunrise > 0) categories.kasbon.push({ pekerja, jenis: 'Kasbon', nominal: sunrise, keterangan: 'Kasbon (SUNRISE)' });
        if (hutang > 0) categories.kasbon.push({ pekerja, jenis: 'Potongan Lain', nominal: hutang, keterangan: 'Hutang Cicilan' });
      });
      if (n) sheetCounts['KASBON'] = n;
    }
    const pengeluaranSheet = findSheet('PENGELUARAN');
    if (pengeluaranSheet) {
      let n = 0;
      XLSX.utils.sheet_to_json(pengeluaranSheet, { defval: '' }).forEach((r) => {
        if (isBlankRow(r)) return;
        n++;
        categories.pengeluaran.push(withTrx({
          owner: String(pickCell(r, 'Owner') ?? '').trim(), tanggal: normalizeDateCell(pickCell(r, 'Tanggal')),
          jenis: String(pickCell(r, 'Jenis Pengeluaran') ?? '').trim(), keterangan: String(pickCell(r, 'Keterangan') ?? '').trim(),
          nominal: pickCell(r, 'Nominal')
        }, r));
      });
      if (n) sheetCounts['PENGELUARAN'] = n;
    }

    if (!Object.keys(sheetCounts).length) {
      throw new Error('Tidak ada data pada sheet manapun (JAHIT/SABLON/GAJI JAHIT/GAJI SABLON/GAJI HARIAN/KASBON/PENGELUARAN) di file ini.');
    }

    wiz.categories = categories;
    wiz.contentHash = await contentHashOf(categories);
    wiz.sheetCounts = sheetCounts;
    wiz.parseWarnings = warnings;
    const presentCounts = SHEET_LABEL_ORDER.filter((label) => sheetCounts[label]).map((label) => `${label} (${sheetCounts[label]})`);
    const warningHtml = warnings.length ? `<div class="mt-8" style="color:var(--status-warning-fg)">${warnings.map(escapeHtml).join('<br>')}</div>` : '';

    statusRoot.innerHTML = `<div class="notice notice-info">${icon('file', 15)} ${escapeHtml(file.name)} &mdash; terdeteksi: ${presentCounts.map(escapeHtml).join(', ')}.${warningHtml} Memeriksa apakah file ini pernah diimport...</div>`;

    const fp = await fetchData('checkFileFingerprintMulti', { file_hash: wiz.fileHash, content_hash: wiz.contentHash }).catch(() => null);
    wiz.fingerprint = fp;
    if (fp && fp.duplicate) {
      statusRoot.innerHTML = `<div class="notice notice-warning">${icon('alert', 15)}
        File ini tampaknya sudah pernah diimport sebelumnya${fp.previousBatch ? ` (batch <code>${escapeHtml(fp.previousBatch.import_batch_id || '')}</code>${fp.previousBatch.imported_at ? ', ' + escapeHtml(fp.previousBatch.imported_at) : ''})` : ''}.
        Data yang sama akan dikenali dan dilewati (tidak diduplikat); hanya data yang berubah yang akan diperbarui. Lanjutkan jika memang ingin memeriksa ulang/mengoreksi.
        <div class="form-actions" style="margin-top:8px">
          <button class="btn btn-secondary btn-sm" id="fp-cancel">Batal</button>
          <button class="btn btn-primary btn-sm" id="fp-again">Lanjutkan</button>
        </div>
      </div>`;
      document.getElementById('fp-cancel').addEventListener('click', () => { wiz.file = null; wiz.categories = null; wiz.sheetCounts = null; renderStepBody(); });
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

// Status baris di Preview. "Konflik" = baris yang ditahan (ID bermasalah / tidak bisa dicocokkan dengan pasti /
// dobel dalam file) — tidak ditulis sampai diperbaiki, baris lain tetap diproses.
const STATUS_FILTERS = [
  { key: 'all', label: 'Semua' }, { key: 'new', label: 'Baru' }, { key: 'update', label: 'Diperbarui' },
  { key: 'skip', label: 'Tidak berubah' }, { key: 'conflict', label: 'Konflik' }, { key: 'error', label: 'Gagal' }
];
const filterKeyOf = (status) => (status === 'duplicate_in_file' ? 'conflict' : status);

function statusBadge(r) {
  if (r.status === 'error') return badge(r.error || 'Gagal', 'critical');
  if (r.status === 'new') return badge('Baru', 'success');
  if (r.status === 'update') return badge('Diperbarui', 'warning');
  if (r.status === 'skip') return badge('Tidak berubah', 'neutral');
  if (r.status === 'conflict') return badge('Konflik', 'critical');
  if (r.status === 'duplicate_in_file') return badge('Konflik · duplikat dalam file', 'critical');
  return badge(String(r.status), 'neutral');
}

function idCell(r) {
  if (r.status === 'error') return r.trxId ? `<code class="trx-id">${escapeHtml(r.trxId)}</code>` : '<span class="text-low">-</span>';
  if (r.trxId) return `<code class="trx-id">${escapeHtml(r.trxId)}</code>`;
  if (r.status === 'skip' || r.status === 'update') return '<span class="text-low" title="Data lama belum punya ID — diberi ID otomatis saat Confirm">ID diberikan saat simpan</span>';
  if (r.status === 'conflict' || r.status === 'duplicate_in_file') return '<span class="text-low">-</span>';
  return '<span class="text-low" title="ID dibuat otomatis saat disimpan">dibuat otomatis</span>';
}

// Requirement #5's exact per-category count summary, e.g.:
//   JAHIT        : 25 data
//   SABLON       : 18 data
//   ...
// One line per physical sheet that actually had data — label padded to a
// fixed width so the colons line up, exactly as specified.
function renderSheetCountSummary(sheetCounts) {
  const present = SHEET_LABEL_ORDER.filter((label) => sheetCounts && sheetCounts[label]);
  if (!present.length) return '';
  const lines = present.map((label) => `${label.padEnd(13, ' ')}: ${sheetCounts[label]} data`);
  // Dark Mode fix (scoped to this block only, per the user's explicit
  // request): the old inline style used `var(--surface-2, #f4f4f5)`, but
  // `--surface-2` is not a real token anywhere in theme.css — every browser
  // always falls through to the hardcoded light-gray fallback regardless of
  // theme, while the text color was left unset and inherited the ambient
  // near-white `--color-text-high` in dark mode, producing illegible white-
  // on-light-gray text. Fixed by using the real theme tokens (already used
  // this way throughout style.css) with an explicit paired text color, so
  // both the background AND the text correctly swap between Light
  // ("Brotherhood") and Dark ("Sovereign Slate") themes.
  return `
    <div class="card mb-16">
      <h3 class="mb-8">Ringkasan Data per Sheet</h3>
      <pre style="background:var(--color-surface-muted);color:var(--color-text-high);padding:12px 16px;border-radius:8px;font-family:inherit;line-height:1.6;margin:0">${escapeHtml(lines.join('\n'))}</pre>
    </div>
  `;
}

function renderCategoryPreviewTable(module, cat) {
  const def = CATEGORY_DEFS[module];
  const hasTrx = TRX_MODULES.includes(module);
  const rows = cat.validRows.map((r) => ({ row: r.row, status: r.matchStatus, warning: r.warning, changes: r.changes, conflictCode: r.conflictCode, trxRaw: r.trxRaw, trxId: r.trxId || r.forcedTrxId || r.trxRaw || '', ...def.mapValid(r) }))
    .concat(cat.errors.map((e) => ({ row: e.row, status: 'error', error: e.error, trxId: e.trx_id || '' })))
    .sort((a, b) => a.row - b.row);
  const sm = cat.summary;
  const conflictN = (sm.conflictCount || 0) + (sm.duplicateInFileCount || 0);
  const CLEARABLE = ['format', 'sheet', 'dobel', 'periode', 'id_terpakai'];
  return `
    <div class="card mb-16" data-cat-card="${module}">
      <h3 class="mb-8">${escapeHtml(def.label)}
        <span class="text-low" style="font-weight:400;font-size:.85em">
          (Baru ${sm.newCount} &middot; Diperbarui ${sm.updateCount} &middot; Tidak berubah ${sm.skipCount}${conflictN ? ` &middot; Konflik ${conflictN}` : ''} &middot; Gagal ${sm.errorCount})
        </span>
      </h3>
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>#</th>
          ${def.previewCols.map((c) => `<th class="${c.align === 'num' ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('')}
          ${hasTrx ? '<th>ID Transaksi</th>' : ''}
          <th>Status</th>
        </tr></thead>
        <tbody>${rows.map((r) => `
          <tr data-st="${filterKeyOf(r.status)}">
            <td>${r.row}</td>
            ${def.previewCols.map((c) => {
              if (r.status === 'error') return `<td class="${c.align === 'num' ? 'num' : ''}">-</td>`;
              const v = r[c.key];
              const text = c.money ? formatCurrency(v) : escapeHtml(v ?? '-');
              return `<td class="${c.align === 'num' ? 'num' : ''}">${text}</td>`;
            }).join('')}
            ${hasTrx ? `<td>${idCell(r)}</td>` : ''}
            <td>${statusBadge(r)}${r.status === 'update' && r.changes && r.changes.length ? `<div class="hint">${escapeHtml(r.changes.join('; '))}</div>` : ''}${r.warning ? `<div class="hint" style="color:var(--status-${r.status === 'conflict' || r.status === 'duplicate_in_file' ? 'critical' : 'warning'}-fg)">${escapeHtml(r.warning)}</div>` : ''}${r.status === 'error' && CATEGORY_EDIT_FIELDS[module] ? `<div class="mt-4"><button type="button" class="btn btn-outline btn-sm" data-edit-row="${module}::${r.row}">${icon('edit', 13)} Edit</button></div>` : ''}${r.status === 'conflict' && r.trxRaw && CLEARABLE.includes(r.conflictCode) ? `<div class="mt-4"><button type="button" class="btn btn-outline btn-sm" data-clear-id="${module}::${r.row}" title="Kosongkan kolom ID baris ini sehingga diperlakukan sebagai transaksi baru">Kosongkan ID (jadikan transaksi baru)</button></div>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
  `;
}

// Filter status (Semua / Baru / Diperbarui / Tidak berubah / Konflik / Gagal): hanya menyembunyikan baris di
// layar — tidak memanggil server dan tidak mengubah apa yang akan diimport.
function applyRowFilter(root) {
  const f = wiz.rowFilter || 'all';
  root.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === f));
  root.querySelectorAll('tr[data-st]').forEach((tr) => { tr.hidden = !(f === 'all' || tr.dataset.st === f); });
  root.querySelectorAll('[data-cat-card]').forEach((card) => {
    card.hidden = f !== 'all' && !card.querySelector('tr[data-st]:not([hidden])');
  });
}

async function runPreview() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  wiz.confirmKey = newRequestId(); // kunci konfirmasi baru untuk setiap preview
  wiz.rowFilter = 'all';
  const res = await postData('importExcelMulti', {
    period_id: period.id, categories: wiz.categories, file_hash: wiz.fileHash, content_hash: wiz.contentHash
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
  const conflictN = (totals.conflictCount || 0) + (totals.duplicateInFileCount || 0);
  const canImport = (totals.newCount || 0) + (totals.updateCount || 0) + (totals.skipCount || 0) > 0;
  const trxMods = moduleKeys.filter((m) => TRX_MODULES.includes(m));
  const anyId = trxMods.some((m) => wiz.preview.categories[m].summary.hasId);
  const counts = { all: (totals.newCount || 0) + (totals.updateCount || 0) + (totals.skipCount || 0) + conflictN + (totals.errorCount || 0), new: totals.newCount || 0, update: totals.updateCount || 0, skip: totals.skipCount || 0, conflict: conflictN, error: totals.errorCount || 0 };

  root.innerHTML = `
    ${renderSheetCountSummary(wiz.sheetCounts || {})}
    <div class="stat-strip mb-16">
      <div class="stat-strip__item"><div class="label">Data Baru</div><div class="value" style="color:var(--status-success-fg)">${counts.new}</div></div>
      <div class="stat-strip__item"><div class="label">Data Diperbarui</div><div class="value" style="color:var(--status-warning-fg)">${counts.update}</div></div>
      <div class="stat-strip__item"><div class="label">Tidak Berubah</div><div class="value text-low">${counts.skip}</div></div>
      <div class="stat-strip__item"><div class="label">Konflik</div><div class="value" style="color:var(--status-critical-fg)">${counts.conflict}</div></div>
      <div class="stat-strip__item"><div class="label">Gagal</div><div class="value" style="color:var(--status-critical-fg)">${counts.error}</div></div>
    </div>
    ${trxMods.length && !anyId ? `<div class="notice notice-info mb-16">${icon('file', 15)}<div>
      <strong>File ini tidak memuat kolom ID Transaksi</strong> (file lama). Baris dicocokkan lewat isi data (Owner/Jenis/Order + nilai) &mdash; aman untuk mengimpor ulang file yang sama. Untuk mengedit data yang sudah ada dengan pasti (termasuk mengganti Owner atau nama order), klik <strong>Unduh Data Periode (dengan ID)</strong>, ubah di file itu, lalu impor kembali.
    </div></div>` : ''}
    ${counts.new + counts.update + counts.error + conflictN === 0 && counts.skip > 0 ? `<div class="notice notice-info mb-16">${icon('check', 15)}<div>
      <strong>Tidak ada perubahan.</strong> Semua ${counts.skip} data di file ini sama persis dengan data yang sudah tersimpan, jadi tidak ada yang ditambah, diperbarui, atau digandakan.
    </div></div>` : ''}
    ${conflictN ? `<div class="notice notice-critical mb-16">${icon('alert', 15)}<div>
      Ditemukan ${conflictN} baris <strong>Konflik</strong>. Baris ini <strong>tidak akan diimport</strong> sampai diperbaiki (alasan dan caranya tertera pada tiap baris); baris lain tetap diproses seperti biasa. Tidak ada data yang digabung atau dihapus otomatis.
    </div></div>` : ''}
    ${totals.legacyDuplicateCount ? `<div class="notice notice-warning mb-16">${icon('alert', 15)}
      Ditemukan ${totals.legacyDuplicateCount} kelompok data lama yang identik di database. Bisa jadi transaksi berulang yang sah, bisa juga sisa import berulang sebelumnya. Data tersebut TIDAK digabung atau dihapus otomatis &mdash; masing-masing diberi ID sendiri; hapus manual hanya bila memang dobel.
    </div>` : ''}
    ${counts.update ? `<div class="notice notice-warning mb-16">${icon('alert', 15)}
      Ditemukan ${counts.update} data yang sudah ada.<br>Data tersebut akan diperbarui menggunakan data terbaru dari Excel (ID tetap sama), bukan diduplikat.
    </div>` : ''}
    <div class="seg mb-12" role="group" aria-label="Filter status baris">
      ${STATUS_FILTERS.map((f) => `<button type="button" class="seg__btn" data-filter="${f.key}">${f.label} (${counts[f.key]})</button>`).join('')}
    </div>
    ${moduleKeys.map((m) => renderCategoryPreviewTable(m, wiz.preview.categories[m])).join('')}
    <div class="form-actions">
      <button class="btn btn-secondary" id="wiz-back">Batal</button>
      <button class="btn btn-primary" id="wiz-confirm" ${canImport ? '' : 'disabled'}>Confirm Import${conflictN ? ` (${conflictN} konflik ditahan)` : ''}</button>
    </div>
  `;
  document.getElementById('wiz-back').addEventListener('click', () => { wiz.step = 1; renderStepBody(); });
  // Moving to Step 4 immediately (before runConfirm even starts) removes
  // this button from the DOM right away — same double-submit guard the
  // single-module wizard already relied on (a second/double click has
  // nothing left to click).
  document.getElementById('wiz-confirm').addEventListener('click', () => { wiz.step = 3; renderStepBody(); runConfirm(); });
  root.querySelectorAll('[data-edit-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [m, rowNumStr] = btn.dataset.editRow.split('::');
      openEditRowModal(m, Number(rowNumStr));
    });
  });
  root.querySelectorAll('[data-clear-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [m, rowNumStr] = btn.dataset.clearId.split('::');
      const raw = wiz.categories[m] && wiz.categories[m][Number(rowNumStr) - 1];
      if (!raw) return;
      delete raw.trx_id;
      toast('ID dikosongkan, memvalidasi ulang...', 'success');
      wiz.step = 2; renderStepBody(); runPreview();
    });
  });
  root.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => { wiz.rowFilter = btn.dataset.filter; applyRowFilter(root); });
  });
  applyRowFilter(root);
}

// ---- Step 4: Confirm --------------------------------------------------------
async function renderStep4(root) {
  root.innerHTML = '<div class="notice notice-info">Menyimpan data...</div>';
}

async function runConfirm() {
  const root = document.getElementById('wizard-body');
  const period = getCurrentPeriod();
  // confirm_key + reqId yang SAMA untuk preview ini: klik ganda / retry otomatis / timeout lalu coba lagi
  // dijawab server dengan hasil yang sama, tanpa menulis dua kali.
  if (!wiz.confirmKey) wiz.confirmKey = newRequestId();
  const res = await postData('confirmImportMulti', {
    period_id: period.id, categories: wiz.categories, file_hash: wiz.fileHash, content_hash: wiz.contentHash, confirm_key: wiz.confirmKey
  }, { reqId: wiz.confirmKey });
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
  // — same reasoning as before: rows land via direct writes / the Payroll.gs
  // /Expenses.gs save handlers, bypassing renderCrudPage's own post-save
  // invalidation, so it has to happen here.
  Object.keys(wiz.categories || {}).forEach((m) => {
    if (!wiz.categories[m].length) return;
    const def = CATEGORY_DEFS[m];
    invalidate(def.listAction);
    def.extraInvalidate.forEach((a) => invalidate(a));
  });
  invalidate('getMonthlyRecap');
  invalidatePrefix('dashRecent');
  invalidatePrefix('dashTrend');

  // Bug #3 fix (Pengeluaran: kolom Jenis masih "-" setelah import): kalau
  // kategori pengeluaran punya baris yang diimpor, backend
  // (resolveOrCreateExpenseType_ di Expenses.gs) mungkin BARU SAJA membuat
  // baris EXPENSE_TYPES untuk Jenis Pengeluaran ketik-bebas yang belum
  // pernah ada sebelumnya. Snapshot getLookups() di client (TTL 30 menit,
  // lihat state.js/router.js) belum tahu soal baris baru itu — akibatnya
  // halaman Pengeluaran (nameOf() di Pengeluaran.js, cari expense_type_id
  // di lookups.expenseTypes) jatuh ke fallback "-" untuk baris yang baru
  // saja diimpor, walau datanya sudah benar tersimpan di server. Refresh
  // paksa lookups di sini (pola sama seperti MasterData.js) supaya cache
  // client langsung sinkron begitu import selesai — tidak bisa import
  // refreshLookups() dari router.js langsung karena router.js sendiri
  // meng-import ImportExcel.js (circular import), jadi pola
  // fetchSWR+setLookups-nya direplikasi di sini. Hanya dijalankan kalau
  // kategori pengeluaran benar-benar ada baris yang diimpor, supaya import
  // yang tidak menyentuh Pengeluaran tidak melakukan refetch lookups yang
  // tidak perlu.
  if (wiz.categories && wiz.categories.pengeluaran && wiz.categories.pengeluaran.length) {
    try {
      await fetchSWR('getLookups', {}, (fresh) => setLookups(fresh || {}), { force: true });
    } catch (e) { /* non-fatal — lookups tetap akan ter-refresh otomatis lewat TTL/reload berikutnya */ }
  }

  const touchedDefs = Object.keys(data.saved || {}).map((m) => CATEGORY_DEFS[m]).filter(Boolean);
  // De-duplicate result links (gaji_harian and lembur point at the same page).
  const seenLinks = new Set();
  const links = touchedDefs.filter((def) => {
    if (seenLinks.has(def.resultLink)) return false;
    seenLinks.add(def.resultLink);
    return true;
  });

  const conflictCount = s.conflictCount || 0;
  const hasIdFile = TRX_MODULES.some((m) => (wiz.categories[m] || []).length);
  root.innerHTML = `
    <div class="notice" style="background:var(--status-success-bg);color:var(--status-success-fg)">${icon('check')} ${((s.newCount || 0) + (s.updateCount || 0)) === 0 && !(s.errorCount || 0) && !conflictCount ? 'Tidak ada perubahan &mdash; semua data sudah sama dengan yang tersimpan.' : `Import selesai${data.import_batch_id ? ` &mdash; Batch <code>${escapeHtml(data.import_batch_id)}</code>` : ''}.`}${data.replayed ? ' (hasil permintaan yang sama sebelumnya &mdash; tidak ditulis ulang)' : ''}</div>
    <pre class="mt-12" style="background:var(--color-surface-muted);color:var(--color-text-high);padding:12px 16px;border-radius:8px;font-family:inherit;line-height:1.6">Data baru       : ${s.newCount || 0}
Data diperbarui : ${s.updateCount || 0}
Tidak berubah   : ${s.skipCount || 0}
Konflik (ditahan): ${conflictCount + (s.duplicateInFileCount || 0)}
Gagal           : ${s.errorCount || 0}</pre>
    ${(data.warnings && data.warnings.length) ? `<div class="notice notice-warning mt-8">${icon('alert', 15)} ${data.warnings.map((w) => escapeHtml(w.message)).join('<br>')}</div>` : ''}
    ${(conflictCount + (s.duplicateInFileCount || 0)) ? `<div class="notice notice-critical mt-8">${icon('alert', 15)} <div>${conflictCount + (s.duplicateInFileCount || 0)} baris konflik <strong>tidak diimport</strong> (alasan di atas). Perbaiki di file lalu impor ulang &mdash; baris yang sudah masuk akan dikenali lewat ID dan tidak terduplikasi.</div></div>` : ''}
    ${(data.errors && data.errors.length) ? `<div class="notice notice-critical mt-8">${icon('alert', 15)} ${data.errors.length} baris gagal disimpan &mdash; lihat detail status di langkah Preview sebelumnya. Data lain yang sudah benar tetap tersimpan.</div>` : ''}
    <div class="form-actions">
      ${links.map((def) => `<a class="btn btn-primary" href="${def.resultLink}">${escapeHtml(def.resultLabel)}</a>`).join('')}
      ${hasIdFile ? `<button class="btn btn-secondary" id="wiz-dl-result" title="File Anda lengkap dengan kolom ID Transaksi yang baru terbentuk — pakai file ini untuk impor berikutnya">${icon('download', 15)} Unduh file hasil import (dengan ID)</button>` : ''}
      <button class="btn btn-secondary" id="wiz-new">Import File Lain</button>
    </div>
    ${hasIdFile ? '<div class="hint mt-8">File hasil import hanya memuat sheet bertransaksi (JAHIT, SABLON, GAJI JAHIT, GAJI SABLON, PENGELUARAN); GAJI HARIAN dan KASBON tidak memakai ID.</div>' : ''}
  `;
  const dlRes = document.getElementById('wiz-dl-result');
  if (dlRes) dlRes.addEventListener('click', () => downloadResultFile(data));
  document.getElementById('wiz-new').addEventListener('click', () => render(document.getElementById('view')));
}

// ---- Unduh data ber-ID --------------------------------------------------------
function writeIdWorkbook(XLSX, sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((sh) => {
    const ws = XLSX.utils.aoa_to_sheet([sh.header].concat(sh.rows));
    ws['!cols'] = sh.header.map((h) => ({ wch: h === ID_COL ? 16 : Math.max(10, Math.min(36, String(h).length + 6)) }));
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  });
  XLSX.writeFile(wb, filename);
}

// "Unduh Data Periode (dengan ID)": isi database periode terpilih dalam tata letak template + kolom ID Transaksi.
// Baris lama yang belum punya ID diberi ID sekali (hanya mengisi kolom ID; data lain tidak diubah).
async function downloadPeriodData() {
  const btn = document.getElementById('dl-export');
  const period = getCurrentPeriod();
  if (!period) { toast('Pilih periode terlebih dahulu.', 'error'); return; }
  if (btn) btn.disabled = true;
  try {
    const res = await postData('exportTransactionData', { period_id: period.id });
    if (!res.success) { toast(res.message || 'Gagal mengambil data periode (pastikan backend sudah diperbarui).', 'error'); return; }
    const XLSX = await loadXlsx();
    const d = res.data;
    const label = String(d.period_label || period.id).replace(/[^\w\-]+/g, '-');
    writeIdWorkbook(XLSX, d.sheets, `Data-${label}-dengan-ID.xlsx`);
    // Kolom ID baru bisa terbentuk di server -> daftar transaksi di layar perlu dimuat ulang.
    if (d.idsAssigned) Object.values(CATEGORY_DEFS).forEach((def) => invalidate(def.listAction));
    toast(d.idsAssigned ? `Data diunduh. ${d.idsAssigned} transaksi lama diberi ID.` : 'Data periode diunduh.', 'success');
  } catch (err) {
    toast('Gagal mengunduh: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Hasil import = file yang baru saja diimpor, ditambah ID setiap baris (baru / lama / diperbarui) — siap dipakai impor berikutnya.
async function downloadResultFile(data) {
  try {
    const XLSX = await loadXlsx();
    const rowIds = data.rowIds || {};
    const sheets = TRX_MODULES.filter((m) => (wiz.categories[m] || []).length).map((m) => {
      const def = ID_SHEETS[m];
      const idByRow = new Map((rowIds[m] || []).map((x) => [x.row, x.trx_id]));
      return {
        name: def.name, header: [ID_COL].concat(def.header),
        rows: wiz.categories[m].map((raw, i) => [idByRow.get(i + 1) || raw.trx_id || ''].concat(def.keys.map((k) => (raw[k] === undefined ? '' : raw[k]))))
      };
    });
    writeIdWorkbook(XLSX, sheets, `Hasil-Import-dengan-ID-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (err) {
    toast('Gagal membuat file: ' + err.message, 'error');
  }
}

// ---- Template download ------------------------------------------------------
// Sheets built EXACTLY per the user-supplied Template-Import-Brotherhood.xlsx
// (JAHIT/SABLON with a per-row Owner column, GAJI JAHIT/GAJI SABLON as their
// own separate sheets, GAJI HARIAN with an embedded "Jumlah Jam Lembur"
// column, KASBON with the per-owner Kasbon (PINGBRO)/Kasbon (SUNRISE)/Hutang
// Cicilan columns) plus one new PENGELUARAN sheet (requirement #4). Same file
// whether downloaded from this page or from a Penggajian/Pengeluaran page's
// "Download Template Excel" button.
async function downloadTemplate() {
  try {
    const lk = getLookups();
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    const pekerja = samplePekerja(lk);
    const ownerA = sampleOwnerName(lk);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [ID_COL, 'Owner', 'Jenis', 'Order Jahit', 'Jumlah'],
      ['JHT-01', ownerA, 'Kaos', 'Order A', 20], ['JHT-02', ownerA, 'Longsleeve', 'Order B', 15]
    ]), 'JAHIT');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [ID_COL, 'Owner', 'Jenis', 'Design Sablon', 'Warna', 'Jumlah'],
      ['SBL-01', ownerA, 'WATERBASE', 'Logo PINGBRO', 2, 20], ['SBL-02', ownerA, 'PLASTISOL', 'Design A', 3, 15]
    ]), 'SABLON');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [ID_COL, 'Pekerja', 'Jenis Pekerjaan', 'Nama Order', 'Jumlah'],
      ['GJT-01', pekerja, sampleName(lk, 'sewingJobTypes'), 'Order A', 20]
    ]), 'GAJI JAHIT');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [ID_COL, 'Pekerja', 'Jenis Tinta', 'Nama Desain', 'Warna', 'Jumlah'],
      ['GSB-01', pekerja, sampleName(lk, 'inkTypes'), 'Design A', 2, 20]
    ]), 'GAJI SABLON');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Pekerja', 'Jumlah Hari Biasa', 'Jumlah Hari Minggu', 'Jumlah Jam Lembur'],
      [pekerja, 20, 4, 3]
    ]), 'GAJI HARIAN');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Pekerja', 'Jenis', 'Kasbon (PINGBRO)', 'Kasbon (SUNRISE)', 'Hutang Cicilan'],
      [pekerja, 'KASBON', 300000, 500000, 1000000]
    ]), 'KASBON');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      [ID_COL, 'Owner', 'Tanggal', 'Jenis Pengeluaran', 'Keterangan', 'Nominal'],
      ['PGL-01', ownerA, '2026-09-05', 'Listrik', 'Tagihan bulanan', 250000]
    ]), 'PENGELUARAN');

    XLSX.writeFile(wb, 'Template-Import-Brotherhood.xlsx');
  } catch (err) {
    toast('Gagal membuat template: ' + err.message, 'error');
  }
}

/**
 * Small header-button factory reused by the Penggajian pages (Gaji Jahit,
 * Gaji Sablon, Gaji Harian & Lembur) and now Pengeluaran too — unchanged
 * signature, one place to keep the labels/behavior consistent. Both buttons
 * lead into the single multi-category wizard/template rather than a
 * per-module one.
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
