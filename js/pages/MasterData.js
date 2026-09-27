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
import { postData } from '../api.js';
import { fetchSWR, peek, invalidate } from '../cache.js';
import { buildForm } from './_shared.js';
import {
  formatCurrency, escapeHtml, badge, skeletonTable, emptyState, toast,
  openModal, closeModal, confirmDialog, MONTHS_ID, formatPeriodLabel
} from '../ui.js';
import { icon } from '../icons.js';
import { getLookups, setLookups } from '../state.js';
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
  { key: 'periods', label: 'Periode' },
  { key: 'settings', label: 'Pengaturan' }
];

const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

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

  // Periode has its own dedicated API (getPeriods/createPeriod, already
  // used elsewhere in the app by Rekap Bulanan's Close/Reopen) rather than
  // the generic getMaster/saveMaster entity engine below, so it's handled
  // as a separate small view instead of an ENTITY_CONFIG entry.
  if (activeTab === 'periods') { renderPeriodsTab(body); return; }

  const cfg = ENTITY_CONFIG[activeTab];
  const params = { entity: activeTab };
  // Instant UX: paint the previously-loaded rows for this tab immediately
  // (switching Owner -> Pekerja -> Owner again feels instant), then
  // silently refresh from the server (stale-while-revalidate).
  const cached = peek('getMaster', params);
  body.innerHTML = `
    ${activeTab === 'settings' ? '<div class="card mb-16" id="md-company-info"></div>' : ''}
    <div class="page-header"><div></div><div class="page-header__actions"><button class="btn btn-primary" id="md-add">${icon('plus', 15)} Tambah ${escapeHtml(cfg.label)}</button></div></div>
    <div id="md-list">${cached === undefined ? skeletonTable(cfg.columns.length + 1, 5) : ''}</div>
  `;
  document.getElementById('md-add').addEventListener('click', () => openEntityForm(cfg, null));
  if (activeTab === 'settings') renderCompanyInfoCard();
  if (cached !== undefined) renderList(cfg, cached || []);

  try {
    await fetchSWR('getMaster', params, (rows) => renderList(cfg, rows || []));
  } catch (e) {
    if (cached === undefined) {
      document.getElementById('md-list').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat data.</div>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Periode tab — list + "Buat Periode Baru". Reuses the existing
// getLookups().periods (already fetched/cached at app-shell mount, same
// data Rekap Bulanan's period selector uses) for the instant first paint,
// so there's no separate skeleton/fetch here; createPeriod is the same
// backend action Rekap Bulanan's flows already talk to.
// ---------------------------------------------------------------------------
function renderPeriodsTab(body) {
  body.innerHTML = `
    <div class="page-header"><div></div><div class="page-header__actions"><button class="btn btn-primary" id="md-add-period">${icon('plus', 15)} Buat Periode Baru</button></div></div>
    <div id="md-period-list"></div>
  `;
  document.getElementById('md-add-period').addEventListener('click', openCreatePeriodForm);
  renderPeriodList();
}

function renderPeriodList() {
  const root = document.getElementById('md-period-list');
  if (!root) return;
  const periods = (getLookups()?.periods || []).slice()
    .sort((a, b) => (b.year - a.year) || (b.month - a.month));
  if (!periods.length) { root.innerHTML = emptyState('Belum ada Periode', 'Buat periode baru dengan tombol di atas.'); return; }
  root.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Periode</th><th>Status</th><th class="num">Aksi</th></tr></thead>
    <tbody>${periods.map((p) => {
      const isClosed = String(p.status).toUpperCase() === 'CLOSED';
      return `
      <tr data-period-id="${escapeHtml(p.id)}">
        <td>${escapeHtml(formatPeriodLabel(p))}</td>
        <td>${badge(isClosed ? 'Closed' : 'Open', isClosed ? 'neutral' : 'success')}</td>
        <td class="row-actions">
          <button class="btn btn-outline btn-sm btn-icon" data-act="edit-period" title="${isClosed ? 'Buka kembali periode ini dari Rekap Bulanan untuk mengedit' : 'Edit'}" ${isClosed ? 'disabled' : ''}>${icon('edit', 15)}</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>`;
  root.querySelectorAll('[data-act="edit-period"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tr = btn.closest('tr');
      const period = periods.find((p) => String(p.id) === tr.dataset.periodId);
      if (period) openEditPeriodForm(period);
    });
  });
}

function openCreatePeriodForm() {
  const now = new Date();
  const values = { month: String(now.getMonth() + 1), year: String(now.getFullYear()) };
  openModal({
    title: 'Buat Periode Baru',
    bodyHtml: '<div id="period-form-root"></div>',
    onMount: (formBody) => {
      buildForm(formBody.querySelector('#period-form-root'), [
        { key: 'month', label: 'Bulan', type: 'select', required: true,
          options: () => MONTHS_ID.map((name, i) => ({ value: String(i + 1), label: name })) },
        { key: 'year', label: 'Tahun', type: 'number', required: true, min: 2000, noGroup: true }
      ], values, getLookups(), async (finalValues) => {
        const month = Number(finalValues.month);
        const year = Number(finalValues.year);
        const label = `${MONTHS_ID[month - 1]} ${year}`;
        // Duplicate check + OPEN-by-default status are enforced server-side
        // (Periods.gs api_createPeriod) — not re-implemented here. On a
        // duplicate, postData's centralized error toast already shows the
        // exact "Periode tersebut sudah tersedia." message; this callback
        // then simply does nothing and the modal stays open to correct it.
        const res = await postData('createPeriod', { month, year, label });
        if (res.success) {
          toast('Periode berhasil dibuat.', 'success');
          closeModal();
          await refreshLookupsCache();
          renderPeriodList();
        }
      }, { submitLabel: 'Buat Periode' });
    }
  });
}

// Edit Periode — same fields/validation/save mechanism as "Buat Periode
// Baru" above (identical field config, same buildForm engine, same
// createPeriod-style duplicate check server-side via updatePeriod), just
// pre-filled with the period's current month/year and sent with its id.
// Never touches status (Close/Reopen on Rekap Bulanan stay the only way to
// change that) or any transaction/payroll data — those only reference
// period_id, never a copy of month/year/label.
function openEditPeriodForm(period) {
  const values = { month: String(period.month), year: String(period.year) };
  openModal({
    title: 'Edit Periode',
    bodyHtml: '<div id="period-form-root"></div>',
    onMount: (formBody) => {
      buildForm(formBody.querySelector('#period-form-root'), [
        { key: 'month', label: 'Bulan', type: 'select', required: true,
          options: () => MONTHS_ID.map((name, i) => ({ value: String(i + 1), label: name })) },
        { key: 'year', label: 'Tahun', type: 'number', required: true, min: 2000, noGroup: true }
      ], values, getLookups(), async (finalValues) => {
        const month = Number(finalValues.month);
        const year = Number(finalValues.year);
        const label = `${MONTHS_ID[month - 1]} ${year}`;
        // Duplicate check (against every OTHER period) + the OPEN/CLOSED
        // guard are enforced server-side (Periods.gs api_updatePeriod),
        // reusing the exact same checks createPeriod already uses — not
        // reimplemented here. On a duplicate or a CLOSED period, postData's
        // centralized error toast shows the backend's message and this
        // callback does nothing further, leaving the modal open to correct it.
        const res = await postData('updatePeriod', { period_id: period.id, month, year, label });
        if (res.success) {
          toast('Periode berhasil diperbarui.', 'success');
          closeModal();
          await refreshLookupsCache();
          renderPeriodList();
        }
      }, { submitLabel: 'Simpan Perubahan' });
    }
  });
}

// Refreshes the shared getLookups() cache/state so the topbar's Global
// Period Selector, this tab's Periode list, and the Company Info logo
// preview all pick up a change immediately — no reload. Mirrors
// router.js's own refreshLookups(); reused by both Buat Periode Baru and
// Upload Logo below since both just add/replace one row in a sheet that's
// already part of the same getLookups() payload.
async function refreshLookupsCache() {
  invalidate('getLookups');
  try {
    await fetchSWR('getLookups', {}, (fresh) => setLookups(fresh || {}), { force: true });
  } catch (e) { /* next navigation will retry naturally */ }
}

// ---------------------------------------------------------------------------
// Informasi Perusahaan (Company Info) — logo upload, prepended above the
// generic key/value list on the existing "Pengaturan" tab. Uses the new
// uploadLogo action (CompanyAssets.gs); the reference it saves lands as one
// more row in the same Settings sheet the generic list below already
// reads, so no separate fetch/cache is needed here either.
// ---------------------------------------------------------------------------
function currentLogoRef() {
  const rows = getLookups()?.settings || [];
  const row = rows.find((r) => r.key === 'company_logo');
  if (!row || !row.value) return null;
  try { return JSON.parse(row.value); } catch (e) { return null; }
}

function renderCompanyInfoCard() {
  const card = document.getElementById('md-company-info');
  if (!card) return;
  const ref = currentLogoRef();
  card.innerHTML = `
    <h3 class="mb-8">Informasi Perusahaan</h3>
    <div class="field">
      <label>Logo Perusahaan</label>
      <div class="logo-upload-row">
        ${ref
          ? `<img src="${escapeHtml(ref.url)}" alt="Logo perusahaan" class="logo-preview" />`
          : `<div class="logo-preview logo-preview--empty">${icon('upload', 20)}</div>`}
        <div>
          <input type="file" id="logo-file-input" accept="image/png,image/jpeg,image/webp" style="display:none" />
          <button type="button" class="btn btn-outline btn-sm" id="logo-upload-btn">${ref ? 'Ganti Logo' : 'Upload Logo'}</button>
          <div class="hint mt-4">PNG, JPG, atau WEBP. Maks 2MB.</div>
        </div>
      </div>
    </div>
  `;
  const input = card.querySelector('#logo-file-input');
  const btn = card.querySelector('#logo-upload-btn');
  btn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => handleLogoFileChosen(input, btn));
}

async function handleLogoFileChosen(input, btn) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    toast('Format file tidak didukung. Gunakan PNG, JPG, atau WEBP.', 'error');
    return;
  }
  if (file.size > LOGO_MAX_BYTES) {
    toast('Ukuran logo terlalu besar. Silakan gunakan file yang lebih kecil.', 'error');
    return;
  }
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Mengunggah...';
  try {
    const base64 = await fileToBase64(file);
    const res = await postData('uploadLogo', { file_name: file.name, mime_type: file.type, file_base64: base64 });
    if (res.success) {
      toast('Logo berhasil diperbarui.', 'success');
      await refreshLookupsCache();
      renderCompanyInfoCard();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const comma = String(result).indexOf(',');
      resolve(comma !== -1 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Gagal membaca file.'));
    reader.readAsDataURL(file);
  });
}

// After any master-data write: drop this entity's cached list so the next
// renderTab() call re-fetches, and refresh the app-wide getLookups() cache
// in the background so every other page's dropdowns (Jahit/Sablon/Payroll/
// Pengeluaran forms all read owners/employees/priceRules/etc. from it) pick
// up the change immediately instead of waiting out the 30 min TTL.
async function invalidateAfterWrite(entityKey) {
  invalidate('getMaster', { entity: entityKey });
  if (entityKey === 'users') return; // users aren't part of getLookups()
  invalidate('getLookups');
  try {
    await fetchSWR('getLookups', {}, (fresh) => setLookups(fresh || {}), { force: true });
  } catch (e) { /* next navigation will retry naturally */ }
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
    if (res.success) { toast('Diaktifkan kembali.', 'success'); await invalidateAfterWrite(cfg.key); renderTab(); }
    return;
  }
  const ok = await confirmDialog(`Nonaktifkan "${row.name || row.email || row.key || row.id}"? Data lama yang sudah dipakai transaksi tetap tersimpan.`, { confirmLabel: 'Nonaktifkan' });
  if (!ok) return;
  const res = await postData('deactivateMaster', { entity: cfg.key, id: row.id });
  if (res.success) { toast('Berhasil dinonaktifkan.', 'success'); await invalidateAfterWrite(cfg.key); renderTab(); }
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
        if (res.success) { toast('Data tersimpan.', 'success'); closeModal(); await invalidateAfterWrite(cfg.key); renderTab(); }
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
