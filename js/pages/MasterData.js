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
import { fetchSWR, peek, invalidate, invalidateAll } from '../cache.js';
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
    ${activeTab === 'settings' ? '<div class="card mb-16" id="md-company-info"></div><div class="card mb-16" id="md-danger-zone"></div>' : ''}
    <div class="page-header"><div></div><div class="page-header__actions"><button class="btn btn-primary" id="md-add">${icon('plus', 15)} Tambah ${escapeHtml(cfg.label)}</button></div></div>
    <div id="md-list">${cached === undefined ? skeletonTable(cfg.columns.length + 1, 5) : ''}</div>
  `;
  document.getElementById('md-add').addEventListener('click', () => openEntityForm(cfg, null));
  if (activeTab === 'settings') { renderCompanyInfoCard(); renderDangerZoneCard(); }
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

// ---------------------------------------------------------------------------
// Reset Data Transaksi ("Zona Berbahaya") — Pengaturan > Sistem. Lets the
// user pick a PERIOD (bulan & tahun) first, then WHICH categories to wipe
// (Jahit, Sablon, Gaji Jahit, Gaji Sablon, Gaji Harian, Lembur, Kasbon,
// Pengeluaran, or "Pilih Semua" of those 8) via backend/Reset.gs's
// api_resetTransactionData — selecting Periode September 2026 + Jahit
// deletes ONLY Jahit data belonging to September 2026; every other period
// (and every other category, including Periode, Saldo/Balance, Slip Gaji
// and Log Aktivitas, which are no longer part of this feature at all) is
// left completely untouched. Settings/Master Data/User/Login are never
// touched either way (enforced server-side, this UI only drives the
// period+selection+confirmation flow). Backend takes a full spreadsheet
// backup to Drive BEFORE deleting anything, and the whole action requires
// the ADMIN_OWNER role.
//
// Flow: tombol -> pilih PERIODE -> pilih kategori (jumlah data per kategori
// PADA PERIODE ITU ditampilkan) -> centang "Saya memahami..." + ketik RESET
// -> Proses Reset -> hasil + link backup.
// ---------------------------------------------------------------------------
const RESET_CATEGORIES = [
  { key: 'jahit', label: 'Jahit', sheetKey: 'SEWING_TRANSACTIONS' },
  { key: 'sablon', label: 'Sablon', sheetKey: 'PRINTING_TRANSACTIONS' },
  { key: 'gaji_jahit', label: 'Gaji Jahit', sheetKey: 'SEWING_WORKER_PAYMENTS' },
  { key: 'gaji_sablon', label: 'Gaji Sablon', sheetKey: 'PRINTING_WORKER_PAYMENTS' },
  { key: 'gaji_harian', label: 'Gaji Harian', sheetKey: 'DAILY_WORKER_PAYMENTS' },
  { key: 'lembur', label: 'Lembur', sheetKey: 'OVERTIME' },
  { key: 'kasbon', label: 'Kasbon', sheetKey: 'PAYROLL_DEDUCTIONS' },
  { key: 'pengeluaran', label: 'Pengeluaran', sheetKey: 'EXPENSES' }
];

function renderDangerZoneCard() {
  const card = document.getElementById('md-danger-zone');
  if (!card) return;
  card.innerHTML = `
    <h3 class="mb-8" style="color:var(--status-critical-fg)">${icon('alert', 18)} Zona Berbahaya</h3>
    <p class="text-low mb-8">
      Menghapus permanen data transaksi per kategori pilihan Anda: Jahit, Sablon, Gaji Jahit, Gaji Sablon, Gaji Harian, Lembur,
      Kasbon, Pengeluaran &mdash; pilih satu, beberapa, atau semuanya. Kategori yang tidak dipilih tetap aman &amp; tidak tersentuh.
      Pengaturan Sistem, Logo &amp; Nama Perusahaan, Master Data, User/Login, Periode, Saldo/Balance, Slip Gaji (Laporan), dan
      Log Aktivitas <strong>tidak terpengaruh</strong> oleh fitur ini.
      Backup otomatis ke Google Drive dibuat sebelum data dihapus.
    </p>
    <button type="button" class="btn btn-danger" id="reset-open-btn">⚠️ Reset Data Transaksi</button>
  `;
  card.querySelector('#reset-open-btn').addEventListener('click', openResetWizard);
}

function formatResetLines(categories, totalLabel, total) {
  if (!categories.length) return `${totalLabel}: ${total} data`;
  const width = Math.max(...categories.map((c) => c.label.length), totalLabel.length) + 2;
  const lines = categories.map((c) => `${c.label.padEnd(width, ' ')}: ${c.count} data`);
  lines.push('─'.repeat(width + 8));
  lines.push(`${totalLabel.padEnd(width, ' ')}: ${total} data`);
  return lines.join('\n');
}

async function openResetWizard() {
  openModal({
    title: '⚠️ Reset Data Transaksi',
    size: 'lg',
    bodyHtml: '<div id="reset-wizard-root"></div>',
    onMount: async (body) => {
      const root = body.querySelector('#reset-wizard-root');
      renderResetStep0(root);
    }
  });
}

// Step 0 (NEW — "Pilih Periode"): a period must be chosen BEFORE any
// category/count is shown, since every count and every delete below is now
// scoped to it. Reuses the SAME period list already cached by getLookups()
// (state.js) — no separate getPeriods() call — sorted most-recent-first,
// same ordering router.js's own period <select> already uses.
function renderResetStep0(root) {
  const periods = (getLookups()?.periods || [])
    .slice()
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .reverse();

  if (!periods.length) {
    root.innerHTML = `<div class="notice notice-info">${icon('info')} Belum ada periode. Buat periode terlebih dahulu dari Rekap Bulanan.</div>
      <div class="form-actions"><button class="btn btn-secondary" id="reset-close-noperiod">Tutup</button></div>`;
    root.querySelector('#reset-close-noperiod').addEventListener('click', () => closeModal());
    return;
  }

  root.innerHTML = `
    <div class="notice notice-info mb-12">${icon('info', 16)} Pilih periode (bulan &amp; tahun) yang ingin direset. Hanya data pada periode ini yang akan terpengaruh &mdash; periode lain selalu aman.</div>
    <div class="field mb-12">
      <label>Periode</label>
      <select class="input select-control" id="reset-period-select">
        ${periods.map((p) => `<option value="${p.id}">${escapeHtml(formatPeriodLabel(p))}${String(p.status || '').toLowerCase() === 'closed' ? ' \u{1F512}' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" id="reset-cancel-0">Batal</button>
      <button type="button" class="btn btn-primary" id="reset-next-0">Lanjut</button>
    </div>
  `;
  root.querySelector('#reset-cancel-0').addEventListener('click', () => closeModal());
  root.querySelector('#reset-next-0').addEventListener('click', async () => {
    const periodId = root.querySelector('#reset-period-select').value;
    const period = periods.find((p) => String(p.id) === String(periodId));
    root.innerHTML = '<div class="notice notice-info">Memuat jumlah data periode ini...</div>';
    let preview;
    try {
      preview = await fetchData('getResetPreview', { period_id: periodId });
    } catch (e) {
      root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat data: ${escapeHtml(e.message)}</div>
        <div class="form-actions"><button class="btn btn-secondary" id="reset-close-err">Tutup</button></div>`;
      root.querySelector('#reset-close-err').addEventListener('click', () => closeModal());
      return;
    }
    renderResetStep1(root, preview, period);
  });
}

function renderResetStep1(root, preview, period) {
  const allCats = preview.categories || [];
  const countFor = (sheetKey) => (allCats.find((c) => c.key === sheetKey) || {}).count || 0;
  const items = RESET_CATEGORIES.map((c) => ({ ...c, count: countFor(c.sheetKey) }));

  root.innerHTML = `
    <div class="notice notice-critical mb-12">${icon('alert', 16)} Tindakan ini PERMANEN dan tidak dapat dibatalkan. Backup otomatis akan dibuat ke Google Drive sebelum data dihapus.</div>
    <p class="mb-8"><button type="button" id="reset-back-0" style="background:none;border:none;color:var(--color-primary);cursor:pointer;padding:0;font-weight:700;font-size:12.5px">&larr; Ganti periode</button></p>
    <h4 class="mb-8">Periode: ${escapeHtml(formatPeriodLabel(period))} &mdash; pilih kategori data yang ingin direset:</h4>
    <label style="display:flex;gap:8px;align-items:center;cursor:pointer" class="mb-8">
      <input type="checkbox" id="reset-select-all" />
      <strong>Pilih Semua</strong>
    </label>
    <div class="table-wrap mb-8"><table class="data-table">
      <thead><tr><th></th><th>Kategori</th><th class="num">Jumlah Data</th></tr></thead>
      <tbody>${items.map((c) => `
        <tr>
          <td><input type="checkbox" class="reset-cat-check" data-cat="${c.key}" ${c.count === 0 ? 'disabled' : ''} /></td>
          <td>${escapeHtml(c.label)}</td>
          <td class="num">${c.count} data</td>
        </tr>`).join('')}
      </tbody>
    </table></div>
    <div id="reset-selected-total" class="text-low mb-12">Belum ada kategori dipilih.</div>
    <p class="text-low mb-12">
      Data yang <strong>TETAP DIPERTAHANKAN</strong> (tidak pernah dihapus oleh fitur ini): Pengaturan Sistem, Logo &amp; Nama
      Usaha, Data Owner, Master Harga, Master Jenis Jahit, Master Jenis Sablon, Master Pekerja, User &amp; Login, Konfigurasi
      Aplikasi, Template Excel, Periode, Saldo/Balance Periode, Slip Gaji (Laporan), dan Log Aktivitas.
    </p>
    <label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer" class="mb-8">
      <input type="checkbox" id="reset-ack" style="margin-top:3px" />
      <span>Saya memahami bahwa data transaksi akan dihapus permanen</span>
    </label>
    <div class="field mb-12">
      <label>Ketik <code>RESET</code> untuk mengonfirmasi</label>
      <input type="text" class="input" id="reset-confirm-text" placeholder="RESET" autocomplete="off" />
    </div>
    <div class="form-actions">
      <button type="button" class="btn btn-secondary" id="reset-cancel">Batal</button>
      <button type="button" class="btn btn-danger" id="reset-proceed" disabled>Proses Reset</button>
    </div>
  `;

  const selectAll = root.querySelector('#reset-select-all');
  const catChecks = Array.from(root.querySelectorAll('.reset-cat-check'));
  const ack = root.querySelector('#reset-ack');
  const textInput = root.querySelector('#reset-confirm-text');
  const proceedBtn = root.querySelector('#reset-proceed');
  const totalLine = root.querySelector('#reset-selected-total');

  function selectedKeys() {
    return catChecks.filter((c) => c.checked && !c.disabled).map((c) => c.dataset.cat);
  }
  function selectedTotal() {
    return selectedKeys().reduce((sum, key) => sum + (items.find((i) => i.key === key)?.count || 0), 0);
  }
  function updateEnabled() {
    const keys = selectedKeys();
    const total = selectedTotal();
    totalLine.textContent = keys.length ? `${keys.length} kategori dipilih — total ${total} data akan dihapus.` : 'Belum ada kategori dipilih.';
    const selectableCount = catChecks.filter((c) => !c.disabled).length;
    selectAll.checked = selectableCount > 0 && keys.length === selectableCount;
    proceedBtn.disabled = !(keys.length > 0 && total > 0 && ack.checked && textInput.value.trim() === 'RESET');
  }

  selectAll.addEventListener('change', () => {
    catChecks.forEach((c) => { if (!c.disabled) c.checked = selectAll.checked; });
    updateEnabled();
  });
  catChecks.forEach((c) => c.addEventListener('change', updateEnabled));
  ack.addEventListener('change', updateEnabled);
  textInput.addEventListener('input', updateEnabled);
  root.querySelector('#reset-cancel').addEventListener('click', () => closeModal());
  root.querySelector('#reset-back-0').addEventListener('click', () => renderResetStep0(root));
  proceedBtn.addEventListener('click', () => {
    if (proceedBtn.disabled) return; // guards a double-click
    proceedBtn.disabled = true;
    runReset(root, period, ack.checked, textInput.value.trim(), selectedKeys());
  });

  updateEnabled();
}

async function runReset(root, period, confirmUnderstood, confirmText, categories) {
  root.innerHTML = `<div class="notice notice-info">${icon('alert', 15)} Membuat backup otomatis dan menghapus data transaksi periode ${escapeHtml(formatPeriodLabel(period))}... Mohon tunggu, jangan tutup halaman ini.</div>`;

  const res = await postData('resetTransactionData', {
    period_id: period.id, confirm_understood: confirmUnderstood, confirm_text: confirmText, categories
  });
  if (!res.success) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} ${escapeHtml(res.message || 'Gagal mereset data.')}</div>
      <div class="form-actions"><button class="btn btn-secondary" id="reset-close">Tutup</button></div>`;
    root.querySelector('#reset-close').addEventListener('click', () => closeModal());
    return;
  }

  const data = res.data;
  toast('Reset data transaksi berhasil.', 'success');

  // A change touching up to 8 different transaction/payroll lists at once is
  // simpler and safer to treat as "wipe every cache" than to enumerate each
  // affected action name one by one — cache.js already exposes exactly this.
  // Periode is never deleted by this feature anymore, so there is no stale
  // current-period id to clear (unlike the old full-reset flow). Only the
  // CHOSEN period's rows were actually deleted server-side — invalidating
  // every cached variant here is still correct, it just means every period
  // (not only this one) re-fetches fresh on next view, which is harmless.
  invalidateAll();
  await refreshLookupsCache();

  root.innerHTML = `
    <div class="notice" style="background:var(--status-success-bg);color:var(--status-success-fg)">${icon('check')} Reset selesai untuk kategori terpilih pada periode ${escapeHtml(formatPeriodLabel(period))}. Periode lain, kategori lain, Saldo, Slip Gaji, dan Log Aktivitas tidak tersentuh.</div>
    <pre class="mt-12" style="background:var(--color-surface-muted);color:var(--color-text-high);padding:12px 16px;border-radius:8px;font-family:inherit;line-height:1.6;white-space:pre">${escapeHtml(formatResetLines(data.deletedCounts || [], 'Total dihapus', data.totalDeleted || 0))}</pre>
    <p class="mt-8 text-low">Backup otomatis: <strong>${escapeHtml(data.backup.name)}</strong> &mdash; <a href="${escapeHtml(data.backup.url)}" target="_blank" rel="noopener">buka di Google Drive</a>.</p>
    <div class="form-actions">
      <button type="button" class="btn btn-primary" id="reset-done">Selesai</button>
    </div>
  `;
  root.querySelector('#reset-done').addEventListener('click', () => {
    closeModal();
    location.hash = '#/dashboard';
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
