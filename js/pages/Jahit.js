// ============================================================================
// Jahit — SewingTransactions. Table filtered by global period/owner, add/edit
// form (Owner, Jenis Produk, Nama Order, Jumlah); Harga/Total are shown
// read-only because BUILD-SPEC's saveSewingTransaction payload has no harga
// field — the server always computes/snapshots it from price_rules (see
// js/config.js comment on this judgment call re: PRD "harga bisa ditimpa").
// ============================================================================
import { renderCrudPage } from './_shared.js';
import { formatCurrency, escapeHtml, badge } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getOwnerFilter, getLookups } from '../state.js';
import { ownerIdByCode, ownerName, ownerOptions, activeOnly } from '../lookups.js';
import { PRICE_CATEGORY } from '../config.js';
import { previewJahit, ownerPriceGroupId } from '../pricing.js';

export async function render(container) {
  const period = getCurrentPeriod();
  await renderCrudPage(container, {
    title: 'Jahit',
    subtitle: 'Transaksi jual produk Jahit per Owner.',
    listAction: 'getSewingTransactions',
    listParams: () => ({ period_id: period?.id, owner_id: ownerIdByCode(getLookups(), getOwnerFilter()) }),
    emptyTitle: 'Belum ada transaksi Jahit',
    emptyHint: 'Tambahkan transaksi baru, atau gunakan Import Excel untuk input massal.',
    emptyIcon: '✂️',
    columns: [
      { key: 'owner', label: 'Owner', format: (r) => ownerTag(r) },
      { key: 'product_type_id', label: 'Jenis Produk', format: (r) => escapeHtml(nameOf(r, 'productTypes', 'product_type_id')) },
      { key: 'nama_order', label: 'Nama Order' },
      { key: 'jumlah', label: 'Jumlah', align: 'num' },
      { key: 'harga', label: 'Harga', align: 'num', format: (r) => formatCurrency(r.harga) },
      { key: 'total', label: 'Total', align: 'num', format: (r) => `<strong>${formatCurrency(r.total)}</strong>` },
      { key: 'source', label: 'Sumber', format: (r) => badge(r.source === 'excel_import' ? 'Excel' : 'Manual', r.source === 'excel_import' ? 'neutral' : 'success') }
    ],
    saveAction: 'saveSewingTransaction',
    deleteAction: 'deleteSewingTransaction',
    deleteMessage: (r) => `Hapus transaksi Jahit "${r.nama_order}"?`,
    formTitle: (mode) => mode === 'edit' ? 'Edit Transaksi Jahit' : mode === 'duplicate' ? 'Duplikat Transaksi Jahit' : 'Tambah Transaksi Jahit',
    formFields: [
      { key: 'owner_id', label: 'Owner', type: 'select', required: true,
        options: (v, lk) => ownerOptions(lk),
        default: () => ownerIdByCode(getLookups(), getOwnerFilter()) },
      { key: 'product_type_id', label: 'Jenis Produk', type: 'select', required: true,
        options: (v, lk) => activeOnly(lk?.productTypes).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'nama_order', label: 'Nama Order', required: true, placeholder: 'mis. Order A' },
      { key: 'jumlah', label: 'Jumlah', type: 'number', required: true, min: 1 },
      { key: 'harga_preview', label: 'Harga & Total (pratinjau)', type: 'preview',
        render: (v) => renderPreview(v) },
      { key: 'catatan', label: 'Catatan', type: 'textarea', fullWidth: true }
    ],
    buildPayload: (v) => ({
      period_id: period?.id,
      owner_id: v.owner_id,
      product_type_id: v.product_type_id,
      nama_order: v.nama_order,
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
  if (!values.owner_id || !values.product_type_id || !values.jumlah) {
    return '<span class="text-low">Lengkapi Owner, Jenis Produk &amp; Jumlah untuk melihat pratinjau harga.</span>';
  }
  const priceGroupId = ownerPriceGroupId(lk, values.owner_id);
  const { harga, total, rule } = previewJahit({
    lookups: lk, category: PRICE_CATEGORY.JAHIT, refId: values.product_type_id,
    priceGroupId, jumlah: values.jumlah
  });
  if (!rule) return `<span class="text-low">${icon('alert', 14)} Belum ada aturan harga untuk kombinasi ini &mdash; harga final ditentukan server.</span>`;
  return `Harga: <strong>${formatCurrency(harga)}</strong> &middot; Total: <strong>${formatCurrency(total)}</strong>
    <div class="hint">Pratinjau klien saja &mdash; server yang menghitung &amp; menyimpan nilai final.</div>`;
}
