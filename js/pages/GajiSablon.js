// ============================================================================
// Gaji Sablon — PrintingWorkerPayments (Borongan). Pekerja, Jenis Tinta,
// Nama Desain, Jumlah Warna, Jumlah — same formula as Sablon jual but using
// price_rules category sablon_borongan (global, price_group_id = null).
// ============================================================================
import { renderCrudPage } from './_shared.js';
import { formatCurrency, escapeHtml } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups } from '../state.js';
import { activeOnly, nameById, toOptions } from '../lookups.js';
import { PRICE_CATEGORY } from '../config.js';
import { previewSablon } from '../pricing.js';

export async function render(container) {
  const period = getCurrentPeriod();
  await renderCrudPage(container, {
    title: 'Gaji Sablon',
    subtitle: 'Pembayaran Borongan Sablon per pekerja. Harga selalu dari Master Harga global — tidak ada override per-pekerja.',
    listAction: 'getPrintingWorkerPayments',
    listParams: () => ({ period_id: period?.id }),
    localFilters: [
      { key: 'employee_id', label: 'Pekerja', allLabel: 'Semua Pekerja', options: () => toOptions(getLookups()?.employees) }
    ],
    emptyTitle: 'Belum ada pembayaran Gaji Sablon',
    emptyHint: 'Tambahkan pembayaran borongan per pekerja untuk periode ini.',
    emptyIcon: '\u{1F3A8}',
    columns: [
      { key: 'employee_id', label: 'Pekerja', format: (r) => escapeHtml(nameById(getLookups()?.employees, r.employee_id)) },
      { key: 'ink_type_id', label: 'Jenis Tinta', format: (r) => escapeHtml(nameById(getLookups()?.inkTypes, r.ink_type_id)) },
      { key: 'nama_desain', label: 'Nama Desain' },
      { key: 'jumlah_warna', label: 'Warna', align: 'num' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga_borongan', label: 'Harga Borongan', align: 'num', format: (r) => formatCurrency(r.harga_borongan) },
      { key: 'total', label: 'Total', align: 'num', format: (r) => `<strong>${formatCurrency(r.total)}</strong>` }
    ],
    saveAction: 'savePrintingWorkerPayment',
    deleteAction: 'deletePrintingWorkerPayment',
    deleteMessage: (r) => `Hapus pembayaran "${r.nama_desain}"?`,
    formTitle: (mode) => mode === 'edit' ? 'Edit Gaji Sablon' : mode === 'duplicate' ? 'Duplikat Gaji Sablon' : 'Tambah Gaji Sablon',
    formFields: [
      { key: 'employee_id', label: 'Pekerja', type: 'select', required: true, options: (v, lk) => toOptions(lk?.employees) },
      { key: 'ink_type_id', label: 'Jenis Tinta', type: 'select', required: true,
        options: (v, lk) => activeOnly(lk?.inkTypes).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'nama_desain', label: 'Nama Desain', required: true },
      { key: 'jumlah_warna', label: 'Jumlah Warna', type: 'number', required: true, min: 1 },
      { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1 },
      { key: 'preview', label: 'Harga Borongan & Total (pratinjau)', type: 'preview', render: (v) => renderPreview(v) }
    ],
    buildPayload: (v) => ({
      period_id: period?.id,
      employee_id: v.employee_id,
      ink_type_id: v.ink_type_id,
      nama_desain: v.nama_desain,
      jumlah_warna: Number(v.jumlah_warna) || 1,
      jumlah: Number(v.jumlah) || 0
    }),
    mapRowToForm: (row) => ({ ...row })
  });
}

function renderPreview(values) {
  const lk = getLookups();
  if (!values.ink_type_id || !values.jumlah) {
    return '<span class="text-low">Lengkapi Jenis Tinta &amp; Jumlah untuk melihat pratinjau harga.</span>';
  }
  const { harga, total, rule } = previewSablon({
    lookups: lk, category: PRICE_CATEGORY.SABLON_BORONGAN, refId: values.ink_type_id,
    priceGroupId: null, jumlahWarna: values.jumlah_warna, jumlah: values.jumlah
  });
  if (!rule) return `<span class="text-low">${icon('alert', 14)} Belum ada aturan Harga Borongan global untuk tinta ini.</span>`;
  return `Harga = ${formatCurrency(rule.base_price)} + (${values.jumlah_warna || 1}-1) &times; ${formatCurrency(rule.increment_price)} = <strong>${formatCurrency(harga)}</strong>
    <div>Total: <strong>${formatCurrency(total)}</strong></div>
    <div class="hint">Harga Borongan bersifat global (lintas Owner) &amp; tidak dapat ditimpa per-pekerja.</div>`;
}
