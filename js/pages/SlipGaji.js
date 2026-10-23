// ============================================================================
// Slip Gaji — pilih pekerja, pratinjau slip A4, Download PNG, Cetak/Simpan PDF.
//
// Satu sumber data: respons getSalarySlip -> buildSlipModel() (js/slip/model.js)
// -> dipakai oleh pratinjau layar, area cetak PDF (A4, SATU halaman, ukuran font
// & kolom tabel disesuaikan otomatis oleh fitSlip) dan renderer PNG (js/slip/png.js).
// Total penghasilan / potongan / gaji bersih tetap dibaca LANGSUNG dari API
// (gajiKotor, potongan.total, gajiBersih) — tidak pernah dihitung ulang di sini.
// Slip periode tertutup memakai snapshot beku dari server (locked=true).
// ============================================================================
import { fetchSWR, peek, invalidate, invalidatePrefix } from '../cache.js';
import { postData } from '../api.js';
import { escapeHtml, skeletonKpis, formatPeriodLabel, toast } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups, getCompanyLogoUrl, getCompanyName } from '../state.js';
import { toOptions, ownerOptions } from '../lookups.js';
import { EXPENSE_OWNERS } from '../config.js';
import { currentTheme } from '../theme.js';
import { buildSlipModel, slipFileName } from '../slip/model.js';
import { fitSlip, mountPrintHost, unmountPrintHost, mountPreview, setPreviewTheme } from '../slip/view.js';
import { getCachedLogo, ensureLogo, logoRef } from '../slip/logo.js';
import { downloadSlipPng } from '../slip/png.js';

let selectedEmployeeId = '';

// Pengamat yang hidup selama slip tampil; dibersihkan saat pindah halaman /
// pilih pekerja lain agar tidak bocor dan agar area cetak tidak tertinggal.
let teardownFns = [];
function teardown() {
  teardownFns.forEach((fn) => { try { fn(); } catch (e) { /* abaikan */ } });
  teardownFns = [];
  unmountPrintHost();
}
let routeWatcherInstalled = false;
function installRouteWatcher() {
  if (routeWatcherInstalled) return;
  routeWatcherInstalled = true;
  window.addEventListener('hashchange', () => { if (location.hash !== '#/slip-gaji') teardown(); });
}

export async function render(container) {
  teardown();
  installRouteWatcher();
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header no-print">
      <div><h1>Slip Gaji</h1><div class="subtitle">${period ? escapeHtml(formatPeriodLabel(period)) : 'Pilih periode di kanan atas'}</div></div>
    </div>
    <div class="card mb-16 no-print">
      <div class="form-grid">
        <div class="field">
          <label>Pekerja</label>
          <select class="input select-control" id="slip-employee">
            <option value="">Pilih pekerja...</option>
            ${toOptions(getLookups()?.employees).map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>
    <div id="slip-body"></div>
  `;

  const select = document.getElementById('slip-employee');
  if (selectedEmployeeId) select.value = selectedEmployeeId;
  select.addEventListener('change', () => {
    selectedEmployeeId = select.value;
    if (!selectedEmployeeId) {
      slipRequestId += 1;
      teardown();
      document.getElementById('slip-body').innerHTML = emptyState();
      return;
    }
    loadSlip(period, selectedEmployeeId);
  });

  if (!period) {
    document.getElementById('slip-body').innerHTML = '<div class="notice notice-info">Pilih periode terlebih dahulu.</div>';
    return;
  }
  if (selectedEmployeeId) loadSlip(period, selectedEmployeeId);
  else document.getElementById('slip-body').innerHTML = emptyState();
}

function emptyState() {
  return '<div class="empty-state">' + icon('file', 26) + '<div class="empty-state__title mt-8">Pilih pekerja untuk melihat Slip Gaji</div></div>';
}

// Latest-request-wins guard: picking worker A then quickly worker B must never
// let A's (slower) response paint over B's slip, nor a response arriving after
// the user left this page touch the DOM.
let slipRequestId = 0;

async function loadSlip(period, employeeId) {
  const root = document.getElementById('slip-body');
  if (!root) return;
  const reqId = ++slipRequestId;
  const params = { period_id: period.id, employee_id: employeeId };
  // Instant UX: re-picking a worker already viewed this session paints
  // their slip immediately from cache, then quietly refreshes.
  const cached = peek('getSalarySlip', params);
  if (cached === undefined) {
    teardown();
    root.innerHTML = skeletonKpis(2);
  }

  try {
    await fetchSWR('getSalarySlip', params, (slip) => {
      if (reqId !== slipRequestId || !root.isConnected) return;
      renderSlip(slip, period, employeeId, reqId);
    });
  } catch (e) {
    if (cached === undefined && reqId === slipRequestId && root.isConnected) {
      root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat Slip Gaji.</div>`;
    }
  }
}

function fontsReady() {
  const ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
  return Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
}

function buildModel(slip, period, employeeId) {
  const lk = getLookups() || {};
  const employee = (lk.employees || []).find((e) => e.id === employeeId);
  const owners = (lk.owners || []).map((o) => o.code || o.name).filter(Boolean);
  return buildSlipModel({
    slip,
    periodLabel: formatPeriodLabel(period),
    employee,
    lookups: lk,
    company: { name: getCompanyName(), owners, logoUrl: getCompanyLogoUrl() || '' },
    now: new Date()
  });
}

let paintSeq = 0;

async function renderSlip(slip, period, employeeId, reqId) {
  const root = document.getElementById('slip-body');
  if (!root) return;
  const seq = ++paintSeq;
  const locked = Boolean(slip && slip.locked);
  const model = buildModel(slip, period, employeeId);

  // Fitur: Slip Gaji - Pilih Pembayar ("Dibayarkan Oleh" PINGBRO/SUNRISE).
  // slip.payer ({owner_id, owner_code, owner_name, expense_id} | null) berasal
  // dari computeSalarySlipCore — objek yang sama juga ada di snapshot periode
  // tertutup. Nama pembayar tampil di slip (juga saat dicetak); select+Simpan
  // adalah editor no-print, dinonaktifkan saat periode terkunci.
  const payer = slip.payer || null;
  const payerOwnerId = payer ? payer.owner_id : '';

  await fontsReady();
  if (seq !== paintSeq || reqId !== slipRequestId || !root.isConnected) return;

  teardown();
  root.innerHTML = `
    <div class="slip-sheet">
      ${locked ? `<div class="slip-locked-banner no-print">${icon('lock', 15)} SNAPSHOT CLOSED &mdash; nilai dibekukan saat periode ditutup, tidak dihitung ulang.</div>` : ''}

      <div class="slip-toolbar no-print">
        <div class="slip-toolbar__hint">Pratinjau A4 &middot; PNG &amp; PDF memakai data yang sama</div>
        <div class="slip-toolbar__actions">
          <button class="btn btn-secondary btn-sm" id="slip-png">${icon('download', 15)} Download PNG</button>
          <button class="btn btn-secondary btn-sm" id="slip-print">${icon('print', 15)} Cetak / Simpan PDF</button>
        </div>
      </div>

      <div class="card mb-16 no-print" id="slip-payer-editor">
        <div class="form-grid">
          <div class="field">
            <label>Dibayarkan Oleh (Pengeluaran masuk ke Owner ini)</label>
            <select class="input select-control" id="slip-payer-select" ${locked ? 'disabled' : ''}>
              <option value="">&mdash; Belum dipilih &mdash;</option>
              ${ownerOptions(getLookups(), EXPENSE_OWNERS).map((o) => `<option value="${o.value}"${payerOwnerId === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${locked
          ? '<p class="text-low mt-8" style="font-size:11.5px;">Periode terkunci &mdash; pembayar tidak dapat diubah lagi.</p>'
          : `<button class="btn btn-primary btn-sm mt-8" id="slip-payer-save">${icon('check', 14)} Simpan Pembayar</button>`}
      </div>

      <div id="slip-preview"></div>
      <div class="slip-fit-note no-print" id="slip-fit-note"></div>
    </div>
  `;

  const logoSrc = getCachedLogo() || getCompanyLogoUrl() || '';
  const fit = fitSlip(model, { logoSrc });
  const previewEl = document.getElementById('slip-preview');
  const theme = currentTheme();
  const layout = mountPreview(previewEl, model, fit, theme, logoSrc);
  mountPrintHost(model, fit, logoSrc);

  // Pratinjau mengikuti lebar kontainer & tema aplikasi.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => layout());
    ro.observe(previewEl);
    teardownFns.push(() => ro.disconnect());
  }
  const mo = new MutationObserver(() => setPreviewTheme(previewEl, currentTheme()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  teardownFns.push(() => mo.disconnect());

  const note = document.getElementById('slip-fit-note');
  const notes = [];
  if (fit.cols > 1 || fit.fs < 8.5) notes.push('Rincian order banyak &mdash; ukuran tabel &amp; font disesuaikan otomatis agar seluruh data tetap muat 1 halaman A4.');
  notes.push('Cetak / PDF selalu memakai tema terang; PNG mengikuti tema aplikasi.');
  note.innerHTML = notes.join(' ');

  // ---- Cetak / Simpan PDF
  document.getElementById('slip-print')?.addEventListener('click', () => {
    const prevTitle = document.title;
    document.title = slipFileName(model, 'pdf').replace(/\.pdf$/, '');
    const restore = () => { document.title = prevTitle; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
  });

  // ---- Download PNG
  const pngBtn = document.getElementById('slip-png');
  pngBtn?.addEventListener('click', async () => {
    if (pngBtn.disabled) return;
    const label = pngBtn.innerHTML;
    pngBtn.disabled = true;
    pngBtn.innerHTML = `${icon('download', 15)} Membuat PNG...`;
    try {
      const sources = [];
      const ensured = await ensureLogo();
      if (ensured) sources.push(ensured);
      const ref = logoRef();
      if (ref && ref.fileId) sources.push(`https://lh3.googleusercontent.com/d/${ref.fileId}=w512`);
      const stored = getCompanyLogoUrl();
      if (stored) sources.push(stored);
      await downloadSlipPng(model, { theme: currentTheme(), logoSources: sources });
      toast('Slip Gaji PNG berhasil diunduh.', 'success');
    } catch (e) {
      toast('Gagal membuat PNG: ' + (e && e.message ? e.message : 'coba lagi'), 'error');
    } finally {
      pngBtn.disabled = false;
      pngBtn.innerHTML = label;
    }
  });

  // ---- Simpan pembayar (tidak berubah)
  document.getElementById('slip-payer-save')?.addEventListener('click', async () => {
    const select = document.getElementById('slip-payer-select');
    const saveBtn = document.getElementById('slip-payer-save');
    const ownerId = select.value;
    saveBtn.disabled = true;
    const res = await postData('setSalaryPayer', { period_id: period.id, employee_id: employeeId, owner_id: ownerId });
    saveBtn.disabled = false;
    if (res.success) {
      // Pengeluaran yang baru dibuat/diperbarui/dihapus mempengaruhi Slip
      // Gaji ini sendiri, halaman Pengeluaran, DAN Dashboard/Rekap Bulanan
      // (recap.perOwner) — invalidate ketiganya supaya semua tempat segera
      // menunjukkan angka yang sama, tanpa perlu refresh manual.
      invalidate('getSalarySlip');
      invalidate('getExpenses');
      invalidate('getMonthlyRecap');
      invalidatePrefix('dashTrend'); // Komposisi Pengeluaran di Dashboard ikut berubah (Dibayarkan Oleh)
      toast(ownerId ? 'Pembayar gaji disimpan.' : 'Pembayar gaji dikosongkan.', 'success');
      loadSlip(period, employeeId);
    }
  });
}
