// ============================================================================
// Dashboard — KPI hero cards from getMonthlyRecap (+ PAYROLL_DEDUCTIONS for
// Total Kasbon), a two-panel PINGBRO/SUNRISE Owner summary, and the existing
// secondary stat strip.
//
// Fitur: Redesign Dashboard (this change) — the "Order Berjalan Periode
// Ini"/"Ringkasan Aktivitas Operasional" two-column grid (Jahit/Sablon order
// counts + a merged activity feed) is REPLACED by two Owner-branded panels
// (PINGBRO / SUNRISE), per the reference mockup the user attached. Each
// panel shows Omzet Jahit / Omzet Sablon / Pengeluaran / Total Harus
// Dibayar (= Omzet Jahit + Omzet Sablon - Pengeluaran, which can be
// negative if Pengeluaran exceeds Omzet — shown in red when so). All four
// numbers are read straight off recap.perOwner[ownerId] — the SAME
// getMonthlyRecap response the KPI row above already fetches (Rekap.gs's
// computeRecapForPeriod_, perOwner block) — so this redesign needed ZERO
// new backend calls and can never show a different number than Rekap
// Bulanan's own per-Owner breakdown for the same period.
//
// Three judgment calls made here, disclosed to the user in the delivery
// report rather than decided silently:
//   1. Panel accent color: the app's OWN existing Owner identity tokens
//      (--color-owner-pingbro/--color-owner-sunrise, theme.css — already
//      used everywhere else for these two Owners) are used instead of the
//      reference mockup's literal green/orange, so these panels always
//      match the rest of the app and never drift from it.
//   2. Month-over-month deltas and "Aktif" badges shown in the reference
//      mockup are NOT built — there is no stored prior-period comparison
//      anywhere in this schema for Omzet/Pengeluaran per Owner, and
//      fabricating one was out of scope ("Gunakan data asli, bukan angka
//      dummy").
//   3. The "Buka PINGBRO"/"Buka SUNRISE" CTA button sets the app's existing
//      Owner filter (setOwnerFilter, same one the top-bar pills use) and
//      navigates to Rekap Bulanan — the one existing page that already
//      shows this exact Owner's full per-category breakdown for the
//      period — rather than inventing per-Owner marketing copy the
//      reference showed but this schema has no field for.
//
// Feature F #2 (earlier redesign, unchanged by this one): the old "Tren
// Hasil Bulan" line-chart card and "Transaksi Terbaru" table card stay
// removed; "Status Produksi"/"Deadline Mendekat" stay intentionally not
// built (no backing data in the schema, confirmed via AskUserQuestion).
//
// NOTE (judgment call, inherited): BUILD-SPEC's API contract does not pin
// the exact JSON field names getMonthlyRecap returns, so this page still
// reads via ui.pick() trying both totalPemasukan/total_pemasukan-style keys.
// ============================================================================
import { fetchSWR } from '../cache.js';
import { formatCurrency, skeletonKpis, emptyState, escapeHtml, pick, badge, formatPeriodLabel } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, setOwnerFilter } from '../state.js';
import { EXPENSE_OWNERS } from '../config.js';

export async function render(container) {
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header">
      <div><h1>Dashboard</h1><div class="subtitle">${period ? escapeHtml(formatPeriodLabel(period)) : 'Pilih periode di kanan atas'}</div></div>
      <div class="page-header__actions" id="dash-period-badge"></div>
    </div>
    <div id="dash-kpis">${skeletonKpis(5)}</div>
    <div class="grid grid-2 mt-16" id="dash-owner-panels">
      <div class="card"><div class="skeleton-line" style="height:190px"></div></div>
      <div class="card"><div class="skeleton-line" style="height:190px"></div></div>
    </div>
    <div class="mt-16">
      <h3 class="mb-8">Statistik Lain</h3>
      <div id="dash-stats">${skeletonKpis(4)}</div>
    </div>
  `;

  if (!period) {
    document.getElementById('dash-kpis').innerHTML = `<div class="card">${emptyState('Belum ada periode', 'Buat periode pertama dari Rekap Bulanan atau Master Data.', '\u{1F4C5}')}</div>`;
    document.getElementById('dash-owner-panels').innerHTML = '';
    document.getElementById('dash-stats').innerHTML = '';
    return;
  }

  renderPeriodBadge(period);

  // Instant UX (gas-instant-ux Prinsip 2/4 — stale-while-revalidate): the
  // section paints from cache the moment this function is called (0ms) if a
  // previous visit to this period already loaded it, then quietly
  // refreshes from the server. On a cold cache this behaves exactly like
  // before — skeleton, one network round trip, render. The two Owner panels
  // are painted from this SAME getMonthlyRecap response (see repaint() in
  // loadRecapSection below) — no second fetch needed.
  await loadRecapSection(period);
}

function renderPeriodBadge(period) {
  const root = document.getElementById('dash-period-badge');
  if (!root) return;
  const isClosed = String(period.status || '').toLowerCase() === 'closed';
  root.innerHTML = badge(isClosed ? 'Periode Ditutup' : 'Periode Berjalan', isClosed ? 'neutral' : 'success');
}

// ---- Recap + Kasbon (KPI hero row + Statistik Lain) ------------------------
// Total Kasbon needs PAYROLL_DEDUCTIONS (same action Kasbon.js/RekapBulanan.js
// already use — getPayrollDeductions({period_id}) returns every employee's
// rows for the period, no owner scoping since deductions have no owner_id,
// same "shared labor pool" reasoning as Gaji & Lembur). Fetched independently
// of getMonthlyRecap (own .catch()) so a hiccup here never blocks the core
// KPIs from rendering — worst case Total Kasbon just shows 0 until it loads.
async function loadRecapSection(period) {
  let painted = false;
  let latestRecap = null;
  let latestDeductions = [];
  const repaint = () => {
    if (!latestRecap) return;
    renderKpis(latestRecap, latestDeductions);
    renderStats(latestRecap);
    renderOwnerPanels(latestRecap);
  };

  const recapPromise = fetchSWR('getMonthlyRecap', { period_id: period.id }, (recap) => {
    painted = true;
    latestRecap = recap;
    repaint();
  }).catch(() => {
    if (!painted) {
      document.getElementById('dash-kpis').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat ringkasan bulan ini.</div>`;
      document.getElementById('dash-stats').innerHTML = '';
      document.getElementById('dash-owner-panels').innerHTML = `<div class="card">${icon('alert')} Gagal memuat ringkasan Owner.</div>`;
    }
  });

  const deductionsPromise = fetchSWR('getPayrollDeductions', { period_id: period.id }, (rows) => {
    latestDeductions = rows || [];
    repaint();
  }).catch(() => { /* non-fatal — lihat komentar di atas */ });

  await Promise.all([recapPromise, deductionsPromise]);
}

// Sama persis dengan rumus di RekapBulanan.js (buildMatrixRows) — dijaga
// identik dengan sengaja supaya "Total Gaji & Lembur" di Dashboard dan di
// Rekap Bulanan tidak pernah berbeda angka untuk periode yang sama.
function computeGajiTotal(recap) {
  const gaji = recap.gaji || {};
  return (Number(gaji.gajiJahit) || 0) + (Number(gaji.gajiSablon) || 0) +
    (Number(gaji.gajiHarian) || 0) + (Number(gaji.gajiMinggu) || 0) + (Number(gaji.lembur) || 0);
}

// Sama persis dengan rumus Total Kasbon di RekapBulanan.js (jenis === 'kasbon',
// field `nominal`) — juga konsisten dengan computeSalarySlipCore() di
// backend/SalarySlip.gs.
function computeKasbonTotal(deductions) {
  return (deductions || [])
    .filter((r) => r.jenis === 'kasbon')
    .reduce((s, r) => s + (Number(r.nominal) || 0), 0);
}

function renderKpis(recap, deductions) {
  const root = document.getElementById('dash-kpis');
  if (!recap) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat ringkasan bulan ini.</div>`;
    return;
  }
  const totalOmzet = pick(recap, ['totalPemasukan', 'total_pemasukan']);
  const totalPengeluaran = pick(recap, ['totalBiaya', 'total_biaya']);
  const hasilBersih = pick(recap, ['hasilBulan', 'hasil_bulan'], totalOmzet - totalPengeluaran);
  const gajiTotal = computeGajiTotal(recap);
  const kasbonTotal = computeKasbonTotal(deductions);

  // "Pengeluaran vs Omzet" — indikator kesehatan operasional sederhana dari
  // data yang sudah ada (tidak ada angka baru/dummy): berapa persen Omzet
  // yang terpakai untuk Pengeluaran periode ini.
  const overBudget = totalOmzet > 0 && totalPengeluaran > totalOmzet;
  const pctPengeluaran = totalOmzet > 0 ? (totalPengeluaran / totalOmzet) * 100 : (totalPengeluaran > 0 ? 100 : 0);
  const fillTone = overBudget ? 'progress-fill--critical' : (pctPengeluaran >= 80 ? 'progress-fill--warning' : '');

  root.innerHTML = `<div class="grid grid-kpi">
    <div class="card kpi-card kpi-card--accent">
      <div class="label">Total Omzet</div>
      <div class="value">${formatCurrency(totalOmzet)}</div>
    </div>
    <div class="card kpi-card">
      <div class="label">Total Pengeluaran</div>
      <div class="value">${formatCurrency(totalPengeluaran)}</div>
      <div class="progress-track mt-8"><div class="progress-fill ${fillTone}" style="width:${Math.max(0, Math.min(100, pctPengeluaran)).toFixed(0)}%"></div></div>
      <div class="progress-label"><span>${pctPengeluaran.toFixed(0)}% dari Omzet</span>${overBudget ? badge('Melebihi Omzet', 'critical') : ''}</div>
    </div>
    <div class="card kpi-card">
      <div class="label">Hasil Bersih</div>
      <div class="value" style="color:${hasilBersih >= 0 ? 'var(--status-success-fg)' : 'var(--status-critical-fg)'}">${formatCurrency(hasilBersih)}</div>
      <span class="delta ${hasilBersih >= 0 ? 'up' : 'down'}">${hasilBersih >= 0 ? '↑ Surplus' : '↓ Defisit'}</span>
    </div>
    <div class="card kpi-card">
      <div class="label">Total Gaji &amp; Lembur</div>
      <div class="value">${formatCurrency(gajiTotal)}</div>
    </div>
    <div class="card kpi-card">
      <div class="label">Total Kasbon</div>
      <div class="value">${formatCurrency(kasbonTotal)}</div>
      <div class="mt-8">${kasbonTotal > 0 ? badge('Ada Kasbon berjalan', 'warning') : badge('Tidak ada Kasbon', 'success')}</div>
    </div>
  </div>`;
}

function renderStats(recap) {
  const root = document.getElementById('dash-stats');
  if (!recap) { root.innerHTML = ''; return; }
  // NOTE: backend (Rekap.gs) nests the payroll/expense breakdown one level
  // down under recap.gaji.* and recap.pengeluaran.* (not top-level fields) —
  // read from those sub-objects, confirmed against the actual backend source.
  const gaji = recap.gaji || {};
  const pengeluaran = recap.pengeluaran || {};
  const items = [
    ['Gaji Jahit', pick(gaji, ['gajiJahit', 'gaji_jahit'])],
    ['Gaji Sablon', pick(gaji, ['gajiSablon', 'gaji_sablon'])],
    ['Gaji Harian', pick(gaji, ['gajiHarian', 'gaji_harian'])],
    ['Gaji Minggu', pick(gaji, ['gajiMinggu', 'gaji_minggu'])],
    ['Lembur', pick(gaji, ['lembur', 'totalLembur', 'total_lembur'])],
    ['Pengeluaran PINGBRO', pick(pengeluaran, ['pingbro'])],
    ['Pengeluaran SUNRISE', pick(pengeluaran, ['sunrise'])],
    ['Saldo Akhir', pick(recap, ['saldoAkhir', 'saldo_akhir'])]
  ];
  root.innerHTML = `<div class="stat-strip">${items.map(([label, val]) => `
    <div class="stat-strip__item"><div class="label">${escapeHtml(label)}</div><div class="value">${formatCurrency(val)}</div></div>
  `).join('')}</div>`;
}

// ---- Owner panels (PINGBRO / SUNRISE) ---------------------------------
// Reads straight off recap.perOwner — the SAME getMonthlyRecap payload the
// KPI row above already has (Rekap.gs's computeRecapForPeriod_), so no
// extra network call is made for this redesign. perOwner is keyed by
// owner id but each entry already carries its own owner_code/owner_name
// (Rekap.gs), so EXPENSE_OWNERS (['PINGBRO','SUNRISE'], config.js) is just
// used to pick and order the two panels — BROTHERHOOD has no Pengeluaran of
// its own (see Expenses.gs/Pengeluaran.js) so it was never part of this
// panel, same restriction as the rest of the app.
function renderOwnerPanels(recap) {
  const root = document.getElementById('dash-owner-panels');
  if (!root) return;
  if (!recap) { root.innerHTML = `<div class="card">${icon('alert')} Gagal memuat ringkasan Owner.</div>`; return; }

  const perOwner = recap.perOwner || {};
  const entries = EXPENSE_OWNERS
    .map((code) => Object.values(perOwner).find((o) => o.owner_code === code))
    .filter(Boolean);

  if (!entries.length) {
    root.innerHTML = `<div class="card">${emptyState('Belum ada data Owner', 'Ringkasan PINGBRO/SUNRISE akan muncul di sini setelah ada transaksi.', '\u{1F4C8}')}</div>`;
    return;
  }

  root.innerHTML = entries.map(ownerPanelHtml).join('');
  root.querySelectorAll('.owner-panel__cta').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOwnerFilter(btn.dataset.ownerCode);
      location.hash = '#/rekap-bulanan';
    });
  });
}

// Total Harus Dibayar = Omzet Jahit + Omzet Sablon - Pengeluaran (per the
// user's own formula) — can legitimately go negative if Pengeluaran
// exceeds Omzet this period, shown in red when so, exactly like the
// existing "Hasil Bersih" KPI card above already does for the same idea.
function ownerPanelHtml(o) {
  const jahit = Number(o.jahit) || 0;
  const sablon = Number(o.sablon) || 0;
  const pengeluaran = Number(o.pengeluaran) || 0;
  const totalDibayar = jahit + sablon - pengeluaran;
  const codeLower = String(o.owner_code || '').toLowerCase();

  return `
    <div class="card owner-panel owner-panel--${codeLower}">
      <div class="owner-panel__header">
        <div class="owner-panel__icon">${icon('building', 18)}</div>
        <div>
          <div class="owner-panel__name">${escapeHtml(o.owner_name)}</div>
          <div class="owner-panel__sub text-low">Ringkasan periode ini</div>
        </div>
      </div>
      <div class="owner-panel__stats">
        <div class="owner-panel__stat"><div class="label">Omzet Jahit</div><div class="value">${formatCurrency(jahit)}</div></div>
        <div class="owner-panel__stat"><div class="label">Omzet Sablon</div><div class="value">${formatCurrency(sablon)}</div></div>
        <div class="owner-panel__stat"><div class="label">Pengeluaran</div><div class="value">${formatCurrency(pengeluaran)}</div></div>
        <div class="owner-panel__stat owner-panel__stat--total">
          <div class="label">Total Harus Dibayar</div>
          <div class="value" style="color:${totalDibayar >= 0 ? 'var(--status-success-fg)' : 'var(--status-critical-fg)'}">${formatCurrency(totalDibayar)}</div>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm owner-panel__cta" data-owner-code="${escapeHtml(o.owner_code)}">
        ${icon('chart', 14)} Lihat Detail ${escapeHtml(o.owner_name)}
      </button>
    </div>
  `;
}
