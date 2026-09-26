// ============================================================================
// Kasbon & Potongan — PayrollDeductions. One table, three jenis. Hutang-
// Cicilan reveals extra fields (Total Hutang, Nominal Cicilan, Cicilan ke-)
// and the list shows Sisa Hutang = Total Hutang - Σ cicilan terpotong
// (server-computed, displayed read-only here).
// ============================================================================
import { renderCrudPage } from './_shared.js';
import { formatCurrency, formatDate, escapeHtml, badge } from '../ui.js';
import { getCurrentPeriod, getLookups } from '../state.js';
import { nameById, toOptions } from '../lookups.js';
import { DEDUCTION_TYPES } from '../config.js';

const TYPE_LABEL = Object.fromEntries(DEDUCTION_TYPES.map((t) => [t.value, t.label]));
const TYPE_TONE = { kasbon: 'warning', hutang_cicilan: 'critical', potongan_lain: 'neutral' };

export async function render(container) {
  const period = getCurrentPeriod();
  await renderCrudPage(container, {
    title: 'Kasbon & Potongan',
    subtitle: 'Kasbon, Hutang-Cicilan, dan Potongan Lain per pekerja. Tidak masuk Total Biaya Rekap — hanya potongan Slip Gaji.',
    listAction: 'getPayrollDeductions',
    listParams: () => ({ period_id: period?.id }),
    localFilters: [
      { key: 'employee_id', label: 'Pekerja', allLabel: 'Semua Pekerja', options: () => toOptions(getLookups()?.employees) },
      { key: 'jenis', label: 'Jenis', allLabel: 'Semua Jenis', options: () => DEDUCTION_TYPES.map((t) => ({ value: t.value, label: t.label })) }
    ],
    emptyTitle: 'Belum ada Kasbon/Potongan',
    emptyHint: 'Tambahkan kasbon, cicilan hutang, atau potongan lain untuk pekerja.',
    emptyIcon: '\u{1F4B8}',
    columns: [
      { key: 'employee_id', label: 'Pekerja', format: (r) => escapeHtml(nameById(getLookups()?.employees, r.employee_id)) },
      { key: 'jenis', label: 'Jenis', format: (r) => badge(TYPE_LABEL[r.jenis] || r.jenis, TYPE_TONE[r.jenis] || 'neutral') },
      { key: 'tanggal', label: 'Tanggal', format: (r) => formatDate(r.tanggal) },
      { key: 'nominal', label: 'Nominal', align: 'num', format: (r) => formatCurrency(r.nominal) },
      { key: 'cicilan_ke', label: 'Cicilan ke-', align: 'num', format: (r) => r.jenis === 'hutang_cicilan' ? (r.cicilan_ke ?? '-') : '-' },
      { key: 'sisa_hutang', label: 'Sisa Hutang', align: 'num', format: (r) => r.jenis === 'hutang_cicilan' ? `<strong>${formatCurrency(r.sisa_hutang)}</strong>` : '-' },
      { key: 'keterangan', label: 'Keterangan' }
    ],
    saveAction: 'savePayrollDeduction',
    deleteAction: 'deletePayrollDeduction',
    canDuplicate: false,
    deleteMessage: () => 'Hapus data Kasbon/Potongan ini?',
    formTitle: (mode) => mode === 'edit' ? 'Edit Kasbon/Potongan' : 'Tambah Kasbon/Potongan',
    formFields: [
      { key: 'employee_id', label: 'Pekerja', type: 'select', required: true, options: (v, lk) => toOptions(lk?.employees) },
      { key: 'jenis', label: 'Jenis', type: 'select', required: true,
        options: () => DEDUCTION_TYPES.map((t) => ({ value: t.value, label: t.label })) },
      { key: 'tanggal', label: 'Tanggal', type: 'date', required: true, default: () => new Date().toISOString().slice(0, 10) },
      { key: 'nominal', label: 'Nominal (dipotong bulan ini)', type: 'number', required: true, min: 0 },
      { key: 'total_hutang', label: 'Total Hutang', type: 'number', min: 0, required: (v) => v.jenis === 'hutang_cicilan',
        showIf: (v) => v.jenis === 'hutang_cicilan' },
      { key: 'nominal_cicilan', label: 'Nominal Cicilan', type: 'number', min: 0,
        showIf: (v) => v.jenis === 'hutang_cicilan' },
      { key: 'cicilan_ke', label: 'Cicilan ke-', type: 'number', min: 1,
        showIf: (v) => v.jenis === 'hutang_cicilan' },
      { key: 'keterangan', label: 'Keterangan', type: 'textarea', fullWidth: true }
    ],
    buildPayload: (v) => {
      const payload = {
        period_id: period?.id,
        employee_id: v.employee_id,
        jenis: v.jenis,
        tanggal: v.tanggal,
        nominal: Number(v.nominal) || 0,
        keterangan: v.keterangan || ''
      };
      if (v.jenis === 'hutang_cicilan') {
        payload.total_hutang = Number(v.total_hutang) || 0;
        payload.nominal_cicilan = Number(v.nominal_cicilan) || 0;
        payload.cicilan_ke = Number(v.cicilan_ke) || 1;
      }
      return payload;
    },
    mapRowToForm: (row) => ({ ...row, tanggal: (row.tanggal || '').slice(0, 10) })
  });
}
