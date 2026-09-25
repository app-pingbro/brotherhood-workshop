// ============================================================================
// Gaji Jahit — SewingWorkerPayments (Borongan). Pekerja, Jenis Pekerjaan,
// Nama Order, Jumlah — harga always price_rules global (category
// jahit_borongan, price_group_id = null); no per-worker override in the UI.
// ============================================================================
import { renderCrudPage } from './_shared.js';
import { formatCurrency, escapeHtml } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups } from '../state.js';
import { activeOnly, nameById, toOptions } from '../lookups.js';
import { PRICE_CATEGORY } from '../config.js';
import { previewJahit } from '../pricing.js';

export async function render(container) {
  const period = getCurrentPeriod();
  await renderCrudPage(container, {
    title: 'Gaji Jahit',
    subtitle: 'Pembayaran Borongan Jahit per pekerja. Harga Borongan selalu dari Master Harga global — tidak ada override per-pekerja.',
    listAction: 'getSewingWorkerPayments',
    listParams: () => ({ period_id: period?.id }),
    localFilters: [
      { key: 'employee_id', label: 'Pekerja', allLabel: 'Semua Pekerja', options: () => toOptions(getLookups()?.employees) }
    ],
    emptyTitle: 'Belum ada pembayaran Gaji Jahit',
    emptyHint: 'Tambahkan pembayaran borongan per pekerja untuk periode ini.',
    emptyIcon: '✂️',
    columns: [
      { key: 'employee_id', label: 'Pekerja', format: (r) => escapeHtml(nameById(getLookups()?.employees, r.employee_id)) },
      { key: 'sewing_job_type_id', label: 'Jenis Pekerjaan', format: (r) => escapeHtml(nameById(getLookups()?.sewingJobTypes, r.sewing_job_type_id)) },
      { key: 'nama_order', label: 'Nama Order' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga_borongan', label: 'Harga Borongan', align: 'num', format: (r) => formatCurrency(r.harga_borongan) },
      { key: 'total', label: 'Total', align: 'num', format: (r) => `<strong>${formatCurrency(r.total)}</strong>` }
    ],
    saveAction: 'saveSewingWorkerPayment',
    deleteAction: 'deleteSewingWorkerPayment',
    deleteMessage: (r) => `Hapus pembayaran "${r.nama_order}"?`,
    formTitle: (mode) => mode === 'edit' ? 'Edit Gaji Jahit' : mode === 'duplicate' ? 'Duplikat Gaji Jahit' : 'Tambah Gaji Jahit',
    formFields: [
      { key: 'employee_id', label: 'Pekerja', type: 'select', required: true, options: (v, lk) => toOptions(lk?.employees) },
      { key: 'sewing_job_type_id', label: 'Jenis Pekerjaan Borongan', type: 'select', required: true,
        options: (v, lk) => activeOnly(lk?.sewingJobTypes).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'nama_order', label: 'Nama Order', required: true },
      { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1 },
      { key: 'preview', label: 'Harga Borongan & Total (pratinjau)', type: 'preview', render: (v) => renderPreview(v) }
    ],
    buildPayload: (v) => ({
      period_id: period?.id,
      employee_id: v.employee_id,
      sewing_job_type_id: v.sewing_job_type_id,
      nama_order: v.nama_order,
      jumlah: Number(v.jumlah) || 0
    }),
    mapRowToForm: (row) => ({ ...row })
  });
}

function renderPreview(values) {
  const lk = getLookups();
  if (!values.sewing_job_type_id || !values.jumlah) {
    return '<span class="text-low">Lengkapi Jenis Pekerjaan &amp; Jumlah untuk melihat pratinjau harga.</span>';
  }
  const { harga, total, rule } = previewJahit({
    lookups: lk, category: PRICE_CATEGORY.JAHIT_BORONGAN, refId: values.sewing_job_type_id,
    priceGroupId: null, jumlah: values.jumlah
  });
  if (!rule) return `<span class="text-low">${icon('alert', 14)} Belum ada aturan Harga Borongan global untuk jenis ini.</span>`;
  return `Harga Borongan: <strong>${formatCurrency(harga)}</strong> &middot; Total: <strong>${formatCurrency(total)}</strong>
    <div class="hint">Harga Borongan bersifat global (lintas Owner) &amp; tidak dapat ditimpa per-pekerja.</div>`;
}
