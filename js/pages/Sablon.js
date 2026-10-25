// ============================================================================
// Sablon — PrintingTransactions. Owner, Jenis Tinta, Nama Desain, Jumlah
// Warna, Jumlah; live formula preview (HARGA_DASAR + (WARNA-1) x TAMBAHAN)
// as a client-side hint only — server value is final.
// ============================================================================
import { renderCrudPage, sumOf, fmtInt } from './_shared.js';
import { formatCurrency, escapeHtml, badge } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getOwnerFilter, getLookups } from '../state.js';
import { ownerIdByCode, ownerName, ownerOptions, activeOnly } from '../lookups.js';
import { PRICE_CATEGORY } from '../config.js';
import { previewSablon, ownerPriceGroupId } from '../pricing.js';
import { buildImportExcelHeaderButtons } from './ImportExcel.js';

export async function render(container) {
  const period = getCurrentPeriod();
  await renderCrudPage(container, {
    title: 'Sablon',
    subtitle: 'Transaksi jual produk Sablon per Owner.',
    icon: 'droplet',
    showTrxId: true,
    headerExtra: buildImportExcelHeaderButtons('sablon'),
    listAction: 'getPrintingTransactions',
    listParams: () => ({ period_id: period?.id, owner_id: ownerIdByCode(getLookups(), getOwnerFilter()) }),
    emptyTitle: 'Belum ada transaksi Sablon',
    emptyHint: 'Tambahkan transaksi baru, atau gunakan Import Excel untuk input massal.',
    clientFilters: [
      { key: 'ink_type_id', label: 'Jenis Tinta', allLabel: 'Semua Tinta', icon: 'droplet',
        options: () => activeOnly(getLookups()?.inkTypes).map((p) => ({ value: p.id, label: p.name })),
        test: (r, v) => String(r.ink_type_id) === String(v) }
    ],
    search: { label: 'Nama Desain', placeholder: 'Cari nama desain...', text: (r) => r.nama_desain },
    kpis: (rows) => [
      { tone: 'success', icon: 'receipt', label: 'Total Transaksi', value: fmtInt(rows.length), unit: 'transaksi' },
      { tone: 'info', icon: 'package', label: 'Total Jumlah', value: fmtInt(sumOf(rows, 'jumlah')), unit: 'pcs' },
      { tone: 'warning', icon: 'wallet', label: 'Total Omzet', value: formatCurrency(sumOf(rows, 'total')) },
      { tone: 'highlight', icon: 'calculator', label: 'Rata-rata per Pcs', value: formatCurrency(sumOf(rows, 'jumlah') ? sumOf(rows, 'total') / sumOf(rows, 'jumlah') : 0) }
    ],
    notes: [
      'Harga dan Total dihitung oleh server dari Master Harga (Harga Dasar + tambahan per warna); pratinjau di form hanya perkiraan.',
      'Data yang tampil mengikuti Periode dan filter Owner di bagian atas halaman.',
      'Gunakan Import Excel untuk input massal. ID Transaksi tetap permanen dan tidak berubah saat import ulang.'
    ],
    columns: [
      { key: 'owner', label: 'Owner', format: (r) => ownerTag(r) },
      { key: 'ink_type_id', label: 'Jenis Tinta', format: (r) => escapeHtml(nameOf(r, 'inkTypes', 'ink_type_id')) },
      { key: 'nama_desain', label: 'Nama Desain' },
      { key: 'jumlah_warna', label: 'Warna', align: 'num' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', format: (r) => formatCurrency(r.harga) },
      { key: 'total', label: 'Total', align: 'num', format: (r) => `<strong>${formatCurrency(r.total)}</strong>` },
      { key: 'source', label: 'Sumber', format: (r) => badge(r.source === 'excel_import' ? 'Excel' : 'Manual', r.source === 'excel_import' ? 'neutral' : 'success') }
    ],
    saveAction: 'savePrintingTransaction',
    deleteAction: 'deletePrintingTransaction',
    deleteMessage: (r) => `Hapus transaksi Sablon "${r.nama_desain}"?`,
    formTitle: (mode) => mode === 'edit' ? 'Edit Transaksi Sablon' : mode === 'duplicate' ? 'Duplikat Transaksi Sablon' : 'Tambah Transaksi Sablon',
    formFields: [
      { key: 'owner_id', label: 'Owner', type: 'select', required: true,
        options: (v, lk) => ownerOptions(lk),
        default: () => ownerIdByCode(getLookups(), getOwnerFilter()) },
      { key: 'ink_type_id', label: 'Jenis Tinta', type: 'select', required: true,
        options: (v, lk) => activeOnly(lk?.inkTypes).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'nama_desain', label: 'Nama Desain', required: true, placeholder: 'mis. Logo PINGBRO' },
      { key: 'jumlah_warna', label: 'Jumlah Warna', type: 'number', required: true, min: 1, noGroup: true },
      { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1, noGroup: true },
      { key: 'harga_preview', label: 'Harga & Total (pratinjau)', type: 'preview', render: (v) => renderPreview(v) },
      { key: 'catatan', label: 'Catatan', type: 'textarea', fullWidth: true }
    ],
    buildPayload: (v) => ({
      period_id: period?.id,
      owner_id: v.owner_id,
      ink_type_id: v.ink_type_id,
      nama_desain: v.nama_desain,
      jumlah_warna: Number(v.jumlah_warna) || 1,
      jumlah: Number(v.jumlah) || 0,
      catatan: v.catatan || ''
    }),
    mapRowToForm: (row) => ({ ...row })
  });
}

function ownerTag(row) {
  const lk = getLookups();
  const code = (lk?.owners || []).find((o) => o.id === row.owner_id)?.code || '';
  return `<span class="owner-tag"><span class="owner-dot owner-dot--${code.toLowerCase()}"></span>${escapeHtml(ownerName(lk, row.owner_id))}</span>`;
}

function nameOf(row, listKey, idKey) {
  const lk = getLookups();
  const item = (lk?.[listKey] || []).find((x) => x.id === row[idKey]);
  return item ? item.name : '-';
}

function renderPreview(values) {
  const lk = getLookups();
  if (!values.owner_id || !values.ink_type_id || !values.jumlah) {
    return '<span class="text-low">Lengkapi Owner, Jenis Tinta &amp; Jumlah untuk melihat pratinjau harga.</span>';
  }
  const priceGroupId = ownerPriceGroupId(lk, values.owner_id);
  const { harga, total, rule } = previewSablon({
    lookups: lk, category: PRICE_CATEGORY.SABLON, refId: values.ink_type_id,
    priceGroupId, jumlahWarna: values.jumlah_warna, jumlah: values.jumlah
  });
  if (!rule) return `<span class="text-low">${icon('alert', 14)} Belum ada aturan harga untuk kombinasi ini &mdash; harga final ditentukan server.</span>`;
  return `Harga = ${formatCurrency(rule.base_price)} + (${values.jumlah_warna || 1}-1) &times; ${formatCurrency(rule.increment_price)} = <strong>${formatCurrency(harga)}</strong>
    <div>Total: <strong>${formatCurrency(total)}</strong></div>
    <div class="hint">Pratinjau klien saja &mdash; server yang menghitung &amp; menyimpan nilai final.</div>`;
}
