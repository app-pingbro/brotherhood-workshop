// ============================================================================
// Master Data — tabbed CRUD for the generic entities BUILD-SPEC lists:
// owners, employees, productTypes, sewingJobTypes, inkTypes, priceRules,
// expenseTypes, users, settings — all driven by getMaster/saveMaster/
// deactivateMaster {entity, ...}. Deactivate toggle only, never a hard
// delete (PRD forbids deleting rows already referenced by a transaction).
//
// NOTE (judgment calls, see handoff notes for the full list):
//  - PriceGroups is not one of BUILD-SPEC's listed master-CRUD entities, so
//    Owners' Price Group is a read-only select sourced from getLookups()
//    (seeded PINGBRO_SUNRISE/BROTHERHOOD groups), not independently edited.
//  - deactivateMaster only deactivates; "reactivate" is implemented as
//    saveMaster with active:true since no separate reactivate action exists.
//  - Users' password is only sent on create/explicit reset (non-empty
//    field), matching the Users sheet's hash+salt storage model.
// ============================================================================
import { fetchData, postData } from '../api.js';
import { buildForm } from './_shared.js';
import {
  formatCurrency, escapeHtml, badge, skeletonTable, emptyState, toast,
  openModal, closeModal, confirmDialog
} from '../ui.js';
import { icon } from '../icons.js';
import { getLookups } from '../state.js';
import { PRICE_CATEGORY } from '../config.js';

const TABS = [
  { key: 'owners', label: 'Owner' },
  { key: 'employees', label: 'Pekerja' },
  { key: 'productTypes', label: 'Jenis Produk' },
  { key: 'sewingJobTypes', label: 'Jenis Pekerjaan Jahit' },
  { key: 'inkTypes', label: 'Jenis Tinta' },
  { key: 'priceRules', label: 'Master Harga' },
  { key: 'expenseTypes', label: 'Jenis Pengeluaran' },
  { key: 'users', label: 'Pengguna' },
  { key: 'settings', label: 'Pengaturan' }
];

let activeTab = 'owners';

export async function render(container) {
  container.innerHTML = `
    <div class="page-header">
      <div><h1>Master Data</h1><div class="subtitle">Data referensi &amp; pengaturan. Data yang sudah dipakai transaksi hanya bisa dinonaktifkan, tidak dihapus.</div></div>
    </div>
    <div class="tabs" id="md-tabs"></div>
    <div id="md-body"></div>
  `;
  const tabsRoot = document.getElementById('md-tabs');
  tabsRoot.innerHTML = TABS.map((t) => `<button class="tab-btn ${t.key === activeTab ? 'is-active' : ''}" data-tab="${t.key}">${escapeHtml(t.label)}</button>`).join('');
  tabsRoot.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      tabsRoot.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderTab();
    });
  });
  renderTab();
}

async function renderTab() {
  const body = document.getElementById('md-body');
  const cfg = ENTITY_CONFIG[activeTab];
  body.innerHTML = `
    <div class="page-header"><div></div><div class="page-header__actions"><button class="btn btn-primary" id="md-add">${icon('plus', 15)} Tambah ${escapeHtml(cfg.label)}</button></div></div>
    <div id="md-list">${skeletonTable(cfg.columns.length + 1, 5)}</div>
  `;
  document.getElementById('md-add').addEventListener('click', () => openEntityForm(cfg, null));

  let rows = [];
  try {
    rows = await fetchData('getMaster', { entity: activeTab }) || [];
  } catch (e) {
    document.getElementById('md-list').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat data.</div>`;
    return;
  }
  renderList(cfg, rows);
}

function renderList(cfg, rows) {
  const root = document.getElementById('md-list');
  if (!rows.length) { root.innerHTML = emptyState(`Belum ada ${cfg.label}`, 'Tambahkan data baru di atas.'); return; }
  root.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr>${cfg.columns.map((c) => `<th class="${c.align === 'num' ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('')}<th class="num">Aksi</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr data-idx="${i}">
        ${cfg.columns.map((c) => `<td class="${c.align === 'num' ? 'num' : ''}">${c.format ? c.format(r) : escapeHtml(r[c.key] ?? '-')}</td>`).join('')}
        <td class="row-actions">
          <button class="btn btn-outline btn-sm btn-icon" data-act="edit" title="Edit">${icon('edit', 15)}</button>
          ${cfg.noDeactivate ? '' : `<button class="btn btn-outline btn-sm btn-icon" data-act="toggle" title="${r.active === false ? 'Aktifkan' : 'Nonaktifkan'}">${icon(r.active === false ? 'check' : 'trash', 15)}</button>`}
        </td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
  root.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = rows[Number(btn.closest('tr').dataset.idx)];
      if (btn.dataset.act === 'edit') openEntityForm(cfg, row);
      else toggleActive(cfg, row);
    });
  });
}

async function toggleActive(cfg, row) {
  if (row.active === false) {
    const res = await postData('saveMaster', { entity: cfg.key, data: { ...row, active: true } });
    if (res.success) { toast('Diaktifkan kembali.', 'success'); renderTab(); }
    return;
  }
  const ok = await confirmDialog(`Nonaktifkan "${row.name || row.email || row.key || row.id}"? Data lama yang sudah dipakai transaksi tetap tersimpan.`, { confirmLabel: 'Nonaktifkan' });
  if (!ok) return;
  const res = await postData('deactivateMaster', { entity: cfg.key, id: row.id });
  if (res.success) { toast('Berhasil dinonaktifkan.', 'success'); renderTab(); }
}

function openEntityForm(cfg, row) {
  const values = {};
  cfg.formFields.forEach((f) => { values[f.key] = row ? (row[f.key] ?? '') : (f.default ? f.default() : ''); });
  if (row) values.id = row.id;
  openModal({
    title: row ? `Edit ${cfg.label}` : `Tambah ${cfg.label}`,
    bodyHtml: '<div id="md-form-root"></div>',
    onMount: (body) => {
      buildForm(body.querySelector('#md-form-root'), cfg.formFields, values, getLookups(), async (finalValues) => {
        const payload = cfg.buildPayload ? cfg.buildPayload(finalValues) : finalValues;
        if (row) payload.id = row.id;
        const res = await postData('saveMaster', { entity: cfg.key, data: payload });
        if (res.success) { toast('Data tersimpan.', 'success'); closeModal(); renderTab(); }
      }, { submitLabel: row ? 'Simpan Perubahan' : 'Simpan' });
    }
  });
}

// ---------------------------------------------------------------------------
// Per-entity config
// ---------------------------------------------------------------------------
const ENTITY_CONFIG = {
  owners: {
    key: 'owners', label: 'Owner', noDeactivate: true,
    columns: [
      { key: 'name', label: 'Nama' }, { key: 'code', label: 'Kode' },
      { key: 'price_group_id', label: 'Price Group', format: (r) => escapeHtml(priceGroupName(r.price_group_id)) }
    ],
    formFields: [
      { key: 'name', label: 'Nama Owner', required: true },
      { key: 'code', label: 'Kode', required: true, hint: 'mis. PINGBRO, SUNRISE, BROTHERHOOD' },
      { key: 'price_group_id', label: 'Price Group', type: 'select', required: true,
        options: (v, lk) => (lk?.priceGroups || []).map((p) => ({ value: p.id, label: p.name })) }
    ]
  },
  employees: {
    key: 'employees', label: 'Pekerja',
    columns: [
      { key: 'name', label: 'Nama' },
      { key: 'active', label: 'Status', format: (r) => badge(r.active === false ? 'Nonaktif' : 'Aktif', r.active === false ? 'neutral' : 'success') },
      { key: 'tarif_harian', label: 'Tarif Harian', align: 'num', format: (r) => r.tarif_harian ? formatCurrency(r.tarif_harian) : '-' },
      { key: 'tarif_minggu', label: 'Tarif Minggu', align: 'num', format: (r) => r.tarif_minggu ? formatCurrency(r.tarif_minggu) : '-' },
      { key: 'tarif_lembur', label: 'Tarif Lembur', align: 'num', format: (r) => r.tarif_lembur ? formatCurrency(r.tarif_lembur) : '-' }
    ],
    formFields: [
      { key: 'name', label: 'Nama Pekerja', required: true },
      { key: 'worker_types', label: 'Jenis Pekerjaan', hint: 'Pisahkan dengan koma, mis. jahit,sablon,harian' },
      { key: 'tarif_harian', label: 'Tarif Harian (override, kosongkan = default global)', type: 'number', min: 0 },
      { key: 'tarif_minggu', label: 'Tarif Minggu (override)', type: 'number', min: 0 },
      { key: 'tarif_lembur', label: 'Tarif Lembur (override)', type: 'number', min: 0 }
    ],
    buildPayload: (v) => ({ ...v, worker_types: typeof v.worker_types === 'string' ? v.worker_types.split(',').map((s) => s.trim()).filter(Boolean) : v.worker_types })
  },
  productTypes: simpleNameEntity('productTypes', 'Jenis Produk'),
  sewingJobTypes: simpleNameEntity('sewingJobTypes', 'Jenis Pekerjaan Jahit'),
  inkTypes: simpleNameEntity('inkTypes', 'Jenis Tinta'),
  priceRules: {
    key: 'priceRules', label: 'Master Harga', noDeactivate: true,
    columns: [
      { key: 'category', label: 'Kategori', format: (r) => escapeHtml(categoryLabel(r.category)) },
      { key: 'ref_id', label: 'Referensi', format: (r) => escapeHtml(refName(r)) },
      { key: 'price_group_id', label: 'Price Group', format: (r) => r.price_group_id ? escapeHtml(priceGroupName(r.price_group_id)) : badge('Global (Borongan)', 'neutral') },
      { key: 'base_price', label: 'Harga Dasar', align: 'num', format: (r) => formatCurrency(r.base_price) },
      { key: 'increment_price', label: 'Tambahan/Warna', align: 'num', format: (r) => r.increment_price ? formatCurrency(r.increment_price) : '-' },
      { key: 'unit_label', label: 'Satuan' }
    ],
    formFields: [
      { key: 'category', label: 'Kategori', type: 'select', required: true,
        options: () => [
          { value: PRICE_CATEGORY.JAHIT, label: 'Jahit (jual)' },
          { value: PRICE_CATEGORY.SABLON, label: 'Sablon (jual)' },
          { value: PRICE_CATEGORY.JAHIT_BORONGAN, label: 'Jahit Borongan' },
          { value: PRICE_CATEGORY.SABLON_BORONGAN, label: 'Sablon Borongan' }
        ] },
      { key: 'ref_id', label: 'Referensi (Jenis Produk/Tinta/Pekerjaan)', type: 'select', required: true,
        options: (v, lk) => refOptions(v.category, lk) },
      { key: 'price_group_id', label: 'Price Group', type: 'select',
        showIf: (v) => v.category === PRICE_CATEGORY.JAHIT || v.category === PRICE_CATEGORY.SABLON,
        required: (v) => v.category === PRICE_CATEGORY.JAHIT || v.category === PRICE_CATEGORY.SABLON,
        options: (v, lk) => (lk?.priceGroups || []).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'borongan_note', label: 'Price Group', type: 'static',
        showIf: (v) => v.category === PRICE_CATEGORY.JAHIT_BORONGAN || v.category === PRICE_CATEGORY.SABLON_BORONGAN,
        render: () => 'Global &mdash; berlaku lintas semua Owner, tanpa override per-pekerja.' },
      { key: 'base_price', label: 'Harga Dasar', type: 'number', required: true, min: 0 },
      { key: 'increment_price', label: 'Tambahan per Warna', type: 'number', min: 0,
        showIf: (v) => v.category === PRICE_CATEGORY.SABLON || v.category === PRICE_CATEGORY.SABLON_BORONGAN },
      { key: 'unit_label', label: 'Satuan', placeholder: 'mis. pcs' }
    ],
    buildPayload: (v) => ({
      ...v,
      price_group_id: (v.category === PRICE_CATEGORY.JAHIT_BORONGAN || v.category === PRICE_CATEGORY.SABLON_BORONGAN) ? null : v.price_group_id
    })
  },
  expenseTypes: {
    key: 'expenseTypes', label: 'Jenis Pengeluaran',
    columns: [
      { key: 'name', label: 'Nama' },
      { key: 'owner_id', label: 'Owner', format: (r) => r.owner_id ? escapeHtml(ownerNameOf(r.owner_id)) : badge('Bersama (PINGBRO & SUNRISE)', 'neutral') }
    ],
    formFields: [
      { key: 'name', label: 'Nama Jenis Pengeluaran', required: true },
      { key: 'owner_id', label: 'Khusus Owner (opsional)', type: 'select',
        options: (v, lk) => (lk?.owners || []).filter((o) => o.code !== 'BROTHERHOOD').map((o) => ({ value: o.id, label: o.name })),
        placeholder: 'Bersama (PINGBRO & SUNRISE)', hint: 'Kosongkan agar tersedia untuk PINGBRO dan SUNRISE.' }
    ]
  },
  users: {
    key: 'users', label: 'Pengguna',
    columns: [
      { key: 'name', label: 'Nama' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' },
      { key: 'active', label: 'Status', format: (r) => badge(r.active === false ? 'Nonaktif' : 'Aktif', r.active === false ? 'neutral' : 'success') }
    ],
    formFields: [
      { key: 'name', label: 'Nama', required: true },
      { key: 'email', label: 'Email', required: true, type: 'email' },
      { key: 'role', label: 'Role', type: 'select', options: () => [{ value: 'admin_owner', label: 'Admin/Owner' }], default: () => 'admin_owner' },
      { key: 'password', label: 'Password (isi untuk set/reset)', type: 'password', hint: 'Kosongkan jika tidak ingin mengubah password.' }
    ],
    buildPayload: (v) => { const p = { ...v }; if (!p.password) delete p.password; return p; }
  },
  settings: {
    key: 'settings', label: 'Pengaturan', noDeactivate: true,
    columns: [{ key: 'key', label: 'Key' }, { key: 'value', label: 'Value' }],
    formFields: [
      { key: 'key', label: 'Key', required: true, hint: 'mis. default_tarif_harian, nama_perusahaan' },
      { key: 'value', label: 'Value', required: true }
    ]
  }
};

function simpleNameEntity(key, label) {
  return {
    key, label,
    columns: [
      { key: 'name', label: 'Nama' },
      { key: 'active', label: 'Status', format: (r) => badge(r.active === false ? 'Nonaktif' : 'Aktif', r.active === false ? 'neutral' : 'success') }
    ],
    formFields: [{ key: 'name', label: 'Nama', required: true }]
  };
}

function priceGroupName(id) {
  return ((getLookups()?.priceGroups) || []).find((p) => p.id === id)?.name || '-';
}
function ownerNameOf(id) {
  return ((getLookups()?.owners) || []).find((o) => o.id === id)?.name || '-';
}
function categoryLabel(cat) {
  return { [PRICE_CATEGORY.JAHIT]: 'Jahit (jual)', [PRICE_CATEGORY.SABLON]: 'Sablon (jual)', [PRICE_CATEGORY.JAHIT_BORONGAN]: 'Jahit Borongan', [PRICE_CATEGORY.SABLON_BORONGAN]: 'Sablon Borongan' }[cat] || cat;
}
function refOptions(category, lk) {
  if (category === PRICE_CATEGORY.JAHIT) return (lk?.productTypes || []).map((p) => ({ value: p.id, label: p.name }));
  if (category === PRICE_CATEGORY.JAHIT_BORONGAN) return (lk?.sewingJobTypes || []).map((p) => ({ value: p.id, label: p.name }));
  if (category === PRICE_CATEGORY.SABLON || category === PRICE_CATEGORY.SABLON_BORONGAN) return (lk?.inkTypes || []).map((p) => ({ value: p.id, label: p.name }));
  return [];
}
function refName(row) {
  const lk = getLookups();
  const map = {
    [PRICE_CATEGORY.JAHIT]: 'productTypes',
    [PRICE_CATEGORY.JAHIT_BORONGAN]: 'sewingJobTypes',
    [PRICE_CATEGORY.SABLON]: 'inkTypes',
    [PRICE_CATEGORY.SABLON_BORONGAN]: 'inkTypes'
  };
  const list = lk?.[map[row.category]] || [];
  return list.find((x) => x.id === row.ref_id)?.name || row.ref_id || '-';
}
