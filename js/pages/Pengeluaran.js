// ============================================================================
// Pengeluaran — Expenses. Owner restricted to PINGBRO/SUNRISE only per
// BUILD-SPEC's CHECK constraint (expenses.owner_id ∈ {PINGBRO, SUNRISE});
// BROTHERHOOD has no operational Pengeluaran of its own in this schema.
//
// Jenis Pengeluaran is now a "ketik bebas" (free-type combobox) field, not a
// fixed <select> — the user can type any new value without adding it to
// Master Data first; historical values are still offered as suggestions via
// an HTML5 <datalist> (see _shared.js's renderFieldHtml `f.datalist` option).
// A brand-new typed value is auto-created in EXPENSE_TYPES by the backend
// (Expenses.gs's resolveOrCreateExpenseType_) the moment it's actually saved.
//
// Also carries "Import Excel"/"Download Template Excel" header buttons,
// reusing the exact same multi-category wizard/duplicate-detection mechanism
// every other module already uses (backend/ExcelImport.gs) — no separate
// import mechanism was built for Pengeluaran.
// ============================================================================
import { renderCrudPage, sumOf, fmtInt } from './_shared.js';
import { formatCurrency, formatDate, escapeHtml } from '../ui.js';
import { getCurrentPeriod, getOwnerFilter, getLookups } from '../state.js';
import { ownerIdByCode, ownerName, ownerOptions, ownerCodeById } from '../lookups.js';
import { EXPENSE_OWNERS } from '../config.js';
import { buildImportExcelHeaderButtons } from './ImportExcel.js';

export async function render(container) {
  const period = getCurrentPeriod();
  await renderCrudPage(container, {
    title: 'Pengeluaran',
    subtitle: 'Biaya operasional per bulan. Hanya tercatat untuk PINGBRO dan SUNRISE.',
    icon: 'receipt',
    showTrxId: true,
    listAction: 'getExpenses',
    listParams: () => {
      const code = getOwnerFilter();
      const restricted = EXPENSE_OWNERS.includes(code) ? code : undefined;
      return { period_id: period?.id, owner_id: ownerIdByCode(getLookups(), restricted) };
    },
    headerExtra: buildImportExcelHeaderButtons('pengeluaran'),
    emptyTitle: 'Belum ada Pengeluaran',
    emptyHint: 'Tambahkan biaya operasional PINGBRO/SUNRISE untuk periode ini.',
    clientFilters: [
      { key: 'expense_type_id', label: 'Jenis Pengeluaran', allLabel: 'Semua Jenis', icon: 'tag',
        options: () => (getLookups()?.expenseTypes || []).filter((x) => x.active !== false).map((x) => ({ value: x.id, label: x.name })),
        test: (r, v) => String(r.expense_type_id) === String(v) }
    ],
    search: { label: 'Keterangan', placeholder: 'Cari keterangan...', text: (r) => r.keterangan },
    kpis: (rows) => {
      const ownerTotal = (code) => sumOf(rows.filter((r) => ownerCodeById(getLookups(), r.owner_id) === code), 'nominal');
      return [
        { tone: 'info', icon: 'receipt', label: 'Total Transaksi', value: fmtInt(rows.length), unit: 'transaksi' },
        { tone: 'critical', icon: 'wallet', label: 'Total Pengeluaran', value: formatCurrency(sumOf(rows, 'nominal')) },
        { tone: 'success', icon: 'building', label: 'PINGBRO', value: formatCurrency(ownerTotal('PINGBRO')) },
        { tone: 'highlight', icon: 'building', label: 'SUNRISE', value: formatCurrency(ownerTotal('SUNRISE')) }
      ];
    },
    notes: [
      'Pengeluaran hanya dicatat untuk PINGBRO dan SUNRISE; BROTHERHOOD tidak punya Pengeluaran operasional sendiri.',
      'Jenis Pengeluaran bisa diketik bebas; jenis baru otomatis ditambahkan ke Master Data saat disimpan.',
      'Gunakan Import Excel untuk input massal. ID Transaksi bersifat permanen.'
    ],
    columns: [
      { key: 'owner_id', label: 'Owner', format: (r) => ownerTag(r) },
      { key: 'tanggal', label: 'Tanggal', format: (r) => formatDate(r.tanggal) },
      { key: 'expense_type_id', label: 'Jenis Pengeluaran', format: (r) => escapeHtml(nameOf(r)) },
      { key: 'keterangan', label: 'Keterangan' },
      { key: 'nominal', label: 'Nominal', align: 'num', format: (r) => `<strong>${formatCurrency(r.nominal)}</strong>` }
    ],
    saveAction: 'saveExpense',
    deleteAction: 'deleteExpense',
    canDuplicate: false,
    deleteMessage: (r) => `Hapus pengeluaran "${r.keterangan}"?`,
    formTitle: (mode) => mode === 'edit' ? 'Edit Pengeluaran' : 'Tambah Pengeluaran',
    formFields: [
      { key: 'owner_id', label: 'Owner', type: 'select', required: true,
        options: (v, lk) => ownerOptions(lk, EXPENSE_OWNERS),
        hint: 'Hanya PINGBRO/SUNRISE — Pengeluaran BROTHERHOOD tidak dicatat terpisah di modul ini.',
        default: () => { const c = getOwnerFilter(); return EXPENSE_OWNERS.includes(c) ? ownerIdByCode(getLookups(), c) : ''; } },
      { key: 'tanggal', label: 'Tanggal', type: 'date', required: true, default: () => new Date().toISOString().slice(0, 10) },
      { key: 'expense_type_name', label: 'Jenis Pengeluaran', required: true,
        datalist: (v, lk) => Array.from(new Set((lk?.expenseTypes || []).map((et) => et.name).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
        hint: 'Ketik bebas — jenis baru otomatis ditambahkan ke Master Data saat disimpan. Daftar di bawah adalah jenis yang sudah pernah dipakai.' },
      { key: 'keterangan', label: 'Keterangan', required: true, fullWidth: true },
      { key: 'nominal', label: 'Nominal', type: 'number', required: true, min: 0 }
    ],
    buildPayload: (v) => ({
      period_id: period?.id,
      owner_id: v.owner_id,
      tanggal: v.tanggal,
      expense_type_name: v.expense_type_name,
      keterangan: v.keterangan,
      nominal: Number(v.nominal) || 0
    }),
    mapRowToForm: (row) => ({ ...row, tanggal: (row.tanggal || '').slice(0, 10), expense_type_name: nameOf(row) })
  });
}

function ownerTag(row) {
  const lk = getLookups();
  const code = (lk?.owners || []).find((o) => o.id === row.owner_id)?.code || '';
  return `<span class="owner-tag"><span class="owner-dot owner-dot--${code.toLowerCase()}"></span>${escapeHtml(ownerName(lk, row.owner_id))}</span>`;
}

function nameOf(row) {
  const lk = getLookups();
  const item = (lk?.expenseTypes || []).find((x) => x.id === row.expense_type_id);
  return item ? item.name : '-';
}
