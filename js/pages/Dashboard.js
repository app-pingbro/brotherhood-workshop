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
import { fetchSWR, fetchDashStats } from '../cache.js';
import { formatCurrency, skeletonKpis, emptyState, escapeHtml, pick, badge, formatPeriodLabel } from '../ui.js';
import { icon } from '../icons.js';
import { multiLineChart, donutChart, shortMonthLabel } from '../chart.js';
import { getCurrentPeriod, getOwnerFilter, setOwnerFilter, getUser } from '../state.js';
import { EXPENSE_OWNERS } from '../config.js';
import { openSettleModal } from './SaldoPiutang.js';

export async function render(container) {
  chartState.stats = null; chartState.sig = ''; chartState.error = false;
  const period = getCurrentPeriod();
  const user = getUser();
  const who = String((user && (user.name || user.email)) || 'Admin').trim().split(/\s+/)[0] || 'Admin';
  container.innerHTML = `
    <div class="page-header dash-header">
      <div>
        <h1>Selamat Datang, ${escapeHtml(who)}</h1>
        <div class="subtitle">${period ? 'Berikut ringkasan keuangan workshop untuk periode ' + escapeHtml(formatPeriodLabel(period)) : 'Pilih periode di kanan atas'}</div>
      </div>
      <div class="page-header__actions" id="dash-period-badge"></div>
    </div>
    <div id="dash-kpis" class="dash-section">${skeletonKpis(4)}</div>
    <div class="grid grid-2 mt-16" id="dash-owner-panels">
      <div class="card"><div class="skeleton-line" style="height:190px"></div></div>
      <div class="card"><div class="skeleton-line" style="height:190px"></div></div>
    </div>
    <div class="mt-16 dash-section" id="dash-stats">${skeletonKpis(4)}</div>
    <div class="mt-16 dash-section" id="dash-charts">${chartsSkeleton()}</div>
  `;

  if (!period) {
    document.getElementById('dash-kpis').innerHTML = `<div class="card">${emptyState('Belum ada periode', 'Buat periode pertama dari Rekap Bulanan atau Master Data.', '\u{1F4C5}')}</div>`;
    document.getElementById('dash-owner-panels').innerHTML = '';
    document.getElementById('dash-stats').innerHTML = '';
    document.getElementById('dash-charts').innerHTML = '';
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
  root.innerHTML = `<div class="period-chip ${isClosed ? 'period-chip--closed' : ''}">
    <span class="period-chip__dot"></span>
    <div><strong>${isClosed ? 'Periode Ditutup' : 'Periode Berjalan'}</strong><small>${escapeHtml(periodRange(period))}</small></div>
  </div>`;
}

// "01 – 30 September 2026", derived from the period's month/year only.
function periodRange(period) {
  const m = Number(period.month), y = Number(period.year);
  if (!(m >= 1 && m <= 12) || !y) return '';
  const last = new Date(y, m, 0).getDate();
  const monthName = formatPeriodLabel(period).replace(/\s+\d{4}$/, '');
  return `01 – ${String(last).padStart(2, '0')} ${monthName} ${y}`;
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
    renderKpis(latestRecap);
    renderStats(latestRecap, latestDeductions);
    renderOwnerPanels(latestRecap, ctx);
  };
  const onRecap = (recap) => {
    painted = true;
    latestRecap = recap;
    repaint();
  };

  // Hooks for the Bayar / Terima button on the owner panels (see
  // openSettleModal in SaldoPiutang.js). After a save the dashboard updates
  // INSTANTLY (optimistic: Total Harus Dibayar and Saldo Perusahaan move right
  // away), then a forced refetch of the recap reconciles with the server.
  const ctx = {
    period,
    getOwner: (ownerId) => (latestRecap && latestRecap.perOwner ? latestRecap.perOwner[ownerId] : null),
    getSaldo: () => (latestRecap ? Number(pick(latestRecap, ['saldoAkhir', 'saldo_akhir'])) || 0 : 0),
    // Bayar (PAYMENT): total shrinks, company saldo shrinks.
    // Terima (RECEIPT): total moves toward 0 (+), company saldo grows.
    patchSettled: (ownerId, kind, nominal) => {
      const po = latestRecap && latestRecap.perOwner ? latestRecap.perOwner[ownerId] : null;
      if (!po || !(nominal > 0)) return;
      const sign = kind === 'RECEIPT' ? 1 : -1;
      po.total_harus_dibayar = ownerTotal(po) + sign * nominal;
      if (kind === 'RECEIPT') {
        po.diterima = (Number(po.diterima) || 0) + nominal;
        latestRecap.penerimaanOwner = (Number(latestRecap.penerimaanOwner) || 0) + nominal;
      } else {
        po.dibayar = (Number(po.dibayar) || 0) + nominal;
        latestRecap.pembayaranOwner = (Number(latestRecap.pembayaranOwner) || 0) + nominal;
      }
      latestRecap.saldoAkhir = (Number(pick(latestRecap, ['saldoAkhir', 'saldo_akhir'])) || 0) + sign * nominal; // same direction as the total
      repaint();
    },
    refresh: () => fetchSWR('getMonthlyRecap', { period_id: period.id }, onRecap, { force: true }).catch(() => {})
  };

  const recapPromise = fetchSWR('getMonthlyRecap', { period_id: period.id }, onRecap).catch(() => {
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

  // Statistik grafik: request terpisah & non-fatal (gagal/backend lama => hanya panel grafik yang
  // menampilkan catatan, kartu & panel Owner tetap normal).
  const statsPromise = fetchDashStats(period.id, (data) => {
    const sig = JSON.stringify(data);
    if (sig === chartState.sig && chartState.stats) return;      // data sama: jangan gambar ulang
    chartState.sig = sig; chartState.stats = data; chartState.error = false;
    renderCharts();
  }).catch(() => {
    if (!chartState.stats) { chartState.error = true; renderCharts(); }
  });

  await Promise.all([recapPromise, deductionsPromise, statsPromise]);
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

// ---- 4 kartu utama ---------------------------------------------------------
// Semua dari satu respons getMonthlyRecap (tanpa request tambahan):
//   Saldo Kas Perusahaan = saldoAkhir  (Saldo Awal Final + Hasil Bulan - Bayar + Terima;
//                          SATU angka perusahaan dari rantai saldo backend — BUKAN
//                          jumlah saldo per Owner, jadi tidak pernah terhitung ganda)
//   Total Omzet          = totalPemasukan      Total Pengeluaran = totalBiaya
//   Hasil Bersih         = hasilBulan
function renderKpis(recap) {
  const root = document.getElementById('dash-kpis');
  if (!recap) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat ringkasan bulan ini.</div>`;
    return;
  }
  const totalOmzet = Number(pick(recap, ['totalPemasukan', 'total_pemasukan'])) || 0;
  const totalPengeluaran = Number(pick(recap, ['totalBiaya', 'total_biaya'])) || 0;
  const hasilBersih = Number(pick(recap, ['hasilBulan', 'hasil_bulan'], totalOmzet - totalPengeluaran)) || 0;
  const saldoAwalFinal = Number(pick(recap, ['saldoAwalFinal', 'saldo_awal_final'])) || 0;
  const saldoKas = Number(pick(recap, ['saldoAkhir', 'saldo_akhir'], saldoAwalFinal + hasilBersih)) || 0;
  const perOwner = Object.values(recap.perOwner || {});
  const omzetJahit = perOwner.reduce((s, o) => s + (Number(o.jahit) || 0), 0);
  const omzetSablon = perOwner.reduce((s, o) => s + (Number(o.sablon) || 0), 0);

  // Perubahan kas selama periode ini = Saldo Akhir - Saldo Awal Final (dari data yang sama).
  const delta = saldoKas - saldoAwalFinal;
  const deltaChip = Math.abs(delta) < 0.5
    ? '<span class="kh-chip kh-chip--flat">Tidak berubah dari awal periode</span>'
    : `<span class="kh-chip kh-chip--${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '↑' : '↓'} ${formatCurrency(Math.abs(delta))} dari awal periode</span>`;

  // Pengeluaran vs Omzet — berapa persen Omzet yang terpakai.
  const overBudget = totalOmzet > 0 && totalPengeluaran > totalOmzet;
  const pct = totalOmzet > 0 ? (totalPengeluaran / totalOmzet) * 100 : (totalPengeluaran > 0 ? 100 : 0);
  const fillTone = overBudget ? 'progress-fill--critical' : (pct >= 80 ? 'progress-fill--warning' : '');

  const card = (tone, iconName, label, value, valueColor, meta) => `
    <article class="kpi-hero kpi-hero--${tone}">
      <div class="kpi-hero__top">
        <span class="kpi-hero__icon">${icon(iconName, 22)}</span>
        <div class="kpi-hero__label">${label}</div>
      </div>
      <div class="kpi-hero__value" ${valueColor ? `style="color:${valueColor}"` : ''}>${formatCurrency(value)}</div>
      <div class="kpi-hero__meta">${meta}</div>
    </article>`;

  root.innerHTML = `<div class="kpi-hero-grid">
    ${card('saldo', 'wallet', 'Saldo Kas Perusahaan', saldoKas, saldoKas < 0 ? 'var(--status-critical-fg)' : '',
      `${deltaChip}<div class="kh-sub">Saldo awal periode ${formatCurrency(saldoAwalFinal)}</div>`)}
    ${card('omzet', 'trendUp', 'Total Omzet', totalOmzet, '',
      `<div class="kh-sub">Jahit ${formatCurrency(omzetJahit)} · Sablon ${formatCurrency(omzetSablon)}</div>`)}
    ${card('keluar', 'receipt', 'Total Pengeluaran', totalPengeluaran, '',
      `<div class="progress-track"><div class="progress-fill ${fillTone}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(0)}%"></div></div>
       <div class="progress-label"><span>${pct.toFixed(0)}% dari Omzet</span>${overBudget ? badge('Melebihi Omzet', 'critical') : ''}</div>`)}
    ${card('hasil', 'chart', 'Hasil Bersih', hasilBersih, hasilBersih >= 0 ? 'var(--status-success-fg)' : 'var(--status-critical-fg)',
      `<span class="kh-chip kh-chip--${hasilBersih >= 0 ? 'up' : 'down'}">${hasilBersih >= 0 ? '↑ Surplus' : '↓ Defisit'}</span><div class="kh-sub">Omzet − Pengeluaran</div>`)}
  </div>`;
}

// ---- Statistik Pengeluaran ---------------------------------------------------
// Urutan: Gaji Jahit, Gaji Sablon, Gaji Harian, Gaji Minggu, Lembur, Kasbon,
// Pengeluaran PINGBRO, Pengeluaran SUNRISE. Sumber: recap.gaji.* dan
// recap.pengeluaran.* (getMonthlyRecap) + Kasbon dari getPayrollDeductions —
// request yang sama dengan sebelumnya. Persentase = bagian dari Total
// Pengeluaran. Gaji & Lembur sudah tercatat sebagai Pengeluaran Owner (lihat
// Rekap.gs), jadi barisnya adalah RINCIAN, bukan tambahan; Kasbon adalah
// potongan gaji (bukan biaya usaha) sehingga tidak diberi persentase.
function renderStats(recap, deductions) {
  const root = document.getElementById('dash-stats');
  if (!recap) { root.innerHTML = ''; return; }
  const gaji = recap.gaji || {};
  const pengeluaran = recap.pengeluaran || {};
  const totalBiaya = Number(pick(recap, ['totalBiaya', 'total_biaya'])) || 0;
  const items = [
    { label: 'Gaji Jahit', icon: 'scissors', tone: 'info', val: pick(gaji, ['gajiJahit', 'gaji_jahit']) },
    { label: 'Gaji Sablon', icon: 'shirt', tone: 'highlight', val: pick(gaji, ['gajiSablon', 'gaji_sablon']) },
    { label: 'Gaji Harian', icon: 'calendar', tone: 'success', val: pick(gaji, ['gajiHarian', 'gaji_harian']) },
    { label: 'Gaji Minggu', icon: 'calendar', tone: 'warning', val: pick(gaji, ['gajiMinggu', 'gaji_minggu']) },
    { label: 'Lembur', icon: 'clock', tone: 'critical', val: pick(gaji, ['lembur', 'totalLembur', 'total_lembur']) },
    { label: 'Kasbon', icon: 'coins', tone: 'teal', val: computeKasbonTotal(deductions), noPct: true },
    { label: 'Pengeluaran PINGBRO', icon: 'building', tone: 'success', val: pick(pengeluaran, ['pingbro']) },
    { label: 'Pengeluaran SUNRISE', icon: 'sun', tone: 'highlight', val: pick(pengeluaran, ['sunrise']) }
  ];
  root.innerHTML = `<section class="card dash-stats">
    <div class="dash-stats__head">
      <h3>Statistik Pengeluaran</h3>
      <span class="dash-stats__total">Total Pengeluaran ${formatCurrency(totalBiaya)}</span>
    </div>
    <div class="dash-stats__grid">${items.map((it) => {
      const v = Number(it.val) || 0;
      const pct = totalBiaya > 0 ? (v / totalBiaya) * 100 : 0;
      return `<div class="dstat dstat--${it.tone}" data-stat="${escapeHtml(it.label)}">
        <div class="dstat__icon">${icon(it.icon, 18)}</div>
        <div class="dstat__body">
          <div class="dstat__label">${escapeHtml(it.label)}</div>
          <div class="dstat__value">${formatCurrency(v)}</div>
          ${it.noPct
            ? '<div class="dstat__note">Potongan gaji</div>'
            : `<div class="dstat__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, pct))}"><span style="width:${Math.max(0, Math.min(100, pct)).toFixed(0)}%"></span></div><div class="dstat__pct">${pct.toFixed(0)}%</div>`}
        </div>
      </div>`;
    }).join('')}</div>
    <p class="dash-stats__footnote">Persentase = bagian dari Total Pengeluaran. Gaji &amp; Lembur sudah termasuk di Pengeluaran Owner; Kasbon adalah potongan gaji, bukan biaya usaha.</p>
  </section>`;
}

// ---- Statistik grafik: Tren Omzet 6 Bulan + Komposisi Pengeluaran ------------
// Satu request getDashboardStats({period_id}) (cache "dashTrend::stats::<periode>",
// ikut dibuang oleh semua invalidatePrefix('dashTrend') yang sudah ada setelah
// simpan/hapus transaksi). Filter Owner = filter Owner global (pill di topbar):
// mengubahnya di sini tidak memicu request — data semua Owner sudah ada di
// respons, tinggal disaring di browser.
//   Tren   : Omzet Jahit / Omzet Sablon / Total Omzet per bulan (Jahit + Sablon).
//   Donut  : rincian Total Pengeluaran tanpa hitung dobel (lihat backend
//            api_getDashboardStats). Kasbon TIDAK masuk (potongan gaji).
const chartState = { stats: null, sig: '', error: false, obs: null };
const CHART_OWNER_FILTERS = [{ code: 'ALL', name: 'Semua' }, { code: 'PINGBRO', name: 'PINGBRO' }, { code: 'SUNRISE', name: 'SUNRISE' }, { code: 'BROTHERHOOD', name: 'BROTHERHOOD' }];
const DONUT_SLICES = [
  { key: 'gajiJahit', label: 'Gaji Jahit', cls: 'dc--jahit' },
  { key: 'gajiSablon', label: 'Gaji Sablon', cls: 'dc--sablon' },
  { key: 'gajiHarian', label: 'Gaji Harian', cls: 'dc--harian' },
  { key: 'gajiMinggu', label: 'Gaji Minggu', cls: 'dc--minggu' },
  { key: 'lembur', label: 'Lembur', cls: 'dc--lembur' },
  { key: 'lain', label: 'Pengeluaran PINGBRO', cls: 'dc--pingbro', owner: 'PINGBRO' },
  { key: 'lain', label: 'Pengeluaran SUNRISE', cls: 'dc--sunrise', owner: 'SUNRISE' }
];

function chartsSkeleton() {
  return '<div class="dash-charts"><div class="card dash-chart-skel"></div><div class="card dash-chart-skel"></div></div>';
}

function trendOwnerValue(m, code, key) {
  const by = m.byOwner || {};
  if (code === 'ALL') return Object.values(by).reduce((s, o) => s + (Number(o[key]) || 0), 0);
  return by[code] ? Number(by[code][key]) || 0 : 0;
}

function pctText(p) { return `${p.toFixed(1).replace('.', ',')}%`; }

function renderCharts() {
  const root = document.getElementById('dash-charts');
  if (!root) return;
  if (!chartState.stats) {
    if (chartState.error) {
      root.innerHTML = `<div class="notice notice-info">${icon('info')} Statistik grafik belum tersedia. Pastikan backend (Kode.gs) sudah diperbarui ke versi terbaru, lalu muat ulang halaman.</div>`;
    }
    return;
  }
  const code = getOwnerFilter();
  const stats = chartState.stats;
  const months = stats.trend || [];
  const periodLabel = formatPeriodLabel(getCurrentPeriod());
  const ownerName = code === 'ALL' ? 'Semua' : code;

  // --- Tren ---
  const series = {
    jahit: months.map((m) => trendOwnerValue(m, code, 'jahit')),
    sablon: months.map((m) => trendOwnerValue(m, code, 'sablon'))
  };
  series.total = series.jahit.map((v, i) => v + series.sablon[i]);
  const last = months.length - 1;
  const cur = series.total[last] || 0, prev = last > 0 ? series.total[last - 1] || 0 : 0;
  let chip = '';
  if (prev > 0) {
    const p = ((cur - prev) / prev) * 100;
    chip = `<span class="kh-chip kh-chip--${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '↑' : '↓'} ${pctText(Math.abs(p))} dari bulan lalu</span>`;
  }
  const trendAll0 = series.total.every((v) => !v);
  const filterBtns = CHART_OWNER_FILTERS.map((f) => `<button type="button" class="seg__btn${f.code === code ? ' is-active' : ''}" data-owner="${f.code}" aria-pressed="${f.code === code}">${f.name}</button>`).join('');
  const lastLabel = months[last] ? months[last].label : '';
  const trendCard = `
    <section class="card chart-card chart-card--trend" aria-label="Tren Omzet 6 Bulan Terakhir">
      <div class="chart-card__head">
        <div class="chart-card__title"><span class="chart-card__icon">${icon('trendUp', 18)}</span><div><h3>Tren Omzet 6 Bulan Terakhir</h3><div class="chart-card__sub">${months.length ? escapeHtml(months[0].label) + ' – ' + escapeHtml(lastLabel) : ''} · Owner: ${escapeHtml(ownerName)}</div></div></div>
        <div class="seg" role="group" aria-label="Filter Owner">${filterBtns}</div>
      </div>
      <div class="trend-summary"><div><div class="ts-label">Total Omzet ${escapeHtml(lastLabel)}</div><div class="ts-value">${formatCurrency(cur)}</div></div>${chip}</div>
      <div class="chart-legend">
        <span class="lg"><i class="lg__line tc--jahit"></i>Omzet Jahit</span>
        <span class="lg"><i class="lg__line tc--sablon"></i>Omzet Sablon</span>
        <span class="lg"><i class="lg__line tc--total"></i>Total Omzet</span>
      </div>
      <div class="trend-chart">
        <div class="tc-canvas"></div>
        <div class="tc-tip" hidden></div>
        ${trendAll0 ? `<div class="chart-empty">Belum ada omzet ${code === 'ALL' ? '' : 'untuk ' + escapeHtml(code) + ' '}pada 6 bulan terakhir.</div>` : ''}
      </div>
      <div class="chart-sr"><table><caption>Tren Omzet 6 bulan terakhir, Owner ${escapeHtml(ownerName)}</caption><thead><tr><th>Bulan</th><th>Omzet Jahit</th><th>Omzet Sablon</th><th>Total Omzet</th></tr></thead><tbody>${months.map((m, i) => `<tr><td>${escapeHtml(m.label)}</td><td>${formatCurrency(series.jahit[i])}</td><td>${formatCurrency(series.sablon[i])}</td><td>${formatCurrency(series.total[i])}</td></tr>`).join('')}</tbody></table></div>
    </section>`;

  // --- Donut ---
  const comp = stats.composition || { byOwner: {} };
  const ownersIn = code === 'ALL' ? ['PINGBRO', 'SUNRISE'] : [code];
  const slices = DONUT_SLICES.filter((s) => !s.owner || ownersIn.includes(s.owner)).map((s) => {
    const by = comp.byOwner || {};
    const value = s.owner
      ? (by[s.owner] ? Number(by[s.owner].lain) || 0 : 0)
      : ownersIn.reduce((sum, c) => sum + (by[c] ? Number(by[c][s.key]) || 0 : 0), 0);
    return { ...s, value };
  });
  const totalSlices = slices.reduce((s, x) => s + x.value, 0);
  slices.forEach((s) => { s.pct = totalSlices > 0 ? (s.value / totalSlices) * 100 : 0; s.title = `${s.label}: ${formatCurrency(s.value)} (${pctText(s.pct)})`; });
  const totalLabel = code === 'ALL' ? 'Total Pengeluaran' : `Total Pengeluaran ${code}`;
  const donutSvg = donutChart(slices, { centerLabel: 'Total', centerValue: formatCurrency(totalSlices) });
  const legend = slices.map((s, i) => `
    <li class="dc-row${s.value > 0 ? '' : ' is-zero'}" data-i="${i}">
      <i class="dc-dot ${s.cls}"></i><span class="dc-name">${escapeHtml(s.label)}</span>
      <span class="dc-val">${formatCurrency(s.value)}</span><span class="dc-pct">${pctText(s.pct)}</span>
    </li>`).join('');
  const emptyMsg = code === 'ALL' ? 'Belum ada pengeluaran pada periode ini.' : `${escapeHtml(code)} tidak memiliki Pengeluaran pada periode ini.`;
  const donutCard = `
    <section class="card chart-card chart-card--donut" aria-label="Komposisi Pengeluaran">
      <div class="chart-card__head">
        <div class="chart-card__title"><span class="chart-card__icon chart-card__icon--red">${icon('receipt', 18)}</span><div><h3>Komposisi Pengeluaran</h3><div class="chart-card__sub">${escapeHtml(periodLabel)} · Owner: ${escapeHtml(ownerName)}</div></div></div>
      </div>
      <div class="donut-body">
        <div class="donut-figure">${donutSvg}</div>
        ${totalSlices > 0 ? `<ul class="dc-legend">${legend}</ul>` : `<div class="chart-empty chart-empty--inline">${emptyMsg}</div>`}
      </div>
      <div class="donut-total"><span>${escapeHtml(totalLabel)}</span><strong>${formatCurrency(totalSlices)}</strong></div>
      <p class="chart-note">Gaji = gaji bersih yang sudah dicatat sebagai Pengeluaran (Slip Gaji › Dibayarkan Oleh), jadi tidak dihitung dua kali. Pengeluaran PINGBRO/SUNRISE = di luar gaji. Kasbon tidak dihitung (potongan gaji, bukan biaya usaha).</p>
    </section>`;

  root.innerHTML = `<div class="dash-charts">${trendCard}${donutCard}</div>`;

  root.querySelectorAll('.seg__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.owner === getOwnerFilter()) return;
      setOwnerFilter(btn.dataset.owner);   // sama dengan pill Owner di topbar (ikut tersinkron)
      renderCharts();
    });
  });
  const svgDonut = root.querySelector('.dn-svg');
  root.querySelectorAll('.dc-row').forEach((row) => {
    const i = row.dataset.i;
    const seg = () => svgDonut && svgDonut.querySelector(`.dn-seg[data-i="${i}"]`);
    row.addEventListener('mouseenter', () => { if (svgDonut) { svgDonut.classList.add('has-hover'); const s = seg(); if (s) s.classList.add('is-hover'); } });
    row.addEventListener('mouseleave', () => { if (svgDonut) { svgDonut.classList.remove('has-hover'); const s = seg(); if (s) s.classList.remove('is-hover'); } });
  });

  mountTrendChart(root, months, series);
}

function mountTrendChart(root, months, series) {
  const box = root.querySelector('.trend-chart');
  const canvas = root.querySelector('.tc-canvas');
  const tip = root.querySelector('.tc-tip');
  if (!box || !canvas || !months.length) return;
  if (chartState.obs) { try { chartState.obs.disconnect(); } catch (e) { /* ignore */ } chartState.obs = null; }
  const points = months.map((m) => ({ label: shortMonthLabel(m.year, m.month) }));
  let drawnW = 0, drawnH = 0;

  const draw = () => {
    const w = Math.floor(box.clientWidth);
    const h = Math.max(220, Math.floor(box.clientHeight));
    if (!w || (Math.abs(w - drawnW) < 2 && Math.abs(h - drawnH) < 2)) return;
    drawnW = w; drawnH = h;
    const ch = multiLineChart(points, [
      { key: 'sablon', values: series.sablon, cls: 'tc--sablon' },
      { key: 'jahit', values: series.jahit, cls: 'tc--jahit' },
      { key: 'total', values: series.total, cls: 'tc--total', area: true }
    ], { width: w, height: h });
    canvas.innerHTML = ch.svg;
    const svg = canvas.querySelector('svg');
    const guide = svg.querySelector('.tc-guide');
    const hide = () => { guide.style.display = 'none'; tip.hidden = true; svg.querySelectorAll('.tc-dot.is-active').forEach((d) => d.classList.remove('is-active')); };
    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const x = clientX - rect.left;
      let best = 0;
      ch.xs.forEach((xx, i) => { if (Math.abs(xx - x) < Math.abs(ch.xs[best] - x)) best = i; });
      guide.setAttribute('x1', ch.xs[best]); guide.setAttribute('x2', ch.xs[best]); guide.style.display = '';
      svg.querySelectorAll('.tc-dot').forEach((d) => d.classList.toggle('is-active', Number(d.dataset.i) === best));
      tip.innerHTML = `<div class="tc-tip__title">${escapeHtml(months[best].label)}</div>
        <div class="tc-tip__row"><i class="lg__line tc--jahit"></i><span>Omzet Jahit</span><b>${formatCurrency(series.jahit[best])}</b></div>
        <div class="tc-tip__row"><i class="lg__line tc--sablon"></i><span>Omzet Sablon</span><b>${formatCurrency(series.sablon[best])}</b></div>
        <div class="tc-tip__row"><i class="lg__line tc--total"></i><span>Total Omzet</span><b>${formatCurrency(series.total[best])}</b></div>`;
      tip.hidden = false;
      const tw = tip.offsetWidth;
      let left = ch.xs[best] + 14;
      if (left + tw > box.clientWidth) left = ch.xs[best] - tw - 14;
      tip.style.left = `${Math.max(0, left)}px`;
    };
    svg.addEventListener('pointermove', (e) => show(e.clientX));
    svg.addEventListener('pointerdown', (e) => show(e.clientX));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  };

  draw();
  if (typeof ResizeObserver === 'function') {
    chartState.obs = new ResizeObserver(() => {
      if (!box.isConnected) { chartState.obs.disconnect(); return; }
      draw();
    });
    chartState.obs.observe(box);
  }
}

// ---- Owner panels (PINGBRO / SUNRISE) ---------------------------------
// Reads straight off recap.perOwner — the SAME getMonthlyRecap payload the
// KPI row above already has (Rekap.gs's computeRecapForPeriod_), so no extra
// network call is made. EXPENSE_OWNERS (['PINGBRO','SUNRISE'], config.js) just
// picks and orders the two panels; BROTHERHOOD has no Pengeluaran of its own.
//
// Alur angka (kiri -> kanan, atas -> bawah):
//   Omzet Jahit + Omzet Sablon - Pengeluaran   = Hasil Periode (tagihan)
//   + Piutang Awal + Sisa periode lalu - Dibayar + Diterima = TOTAL HARUS DIBAYAR
//   Saldo Awal tampil sebagai informasi (kas awal Owner) dan HANYA masuk ke
//   Saldo Perusahaan — tidak ikut Total Harus Dibayar, supaya tidak dobel.
// Total > 0  : perusahaan HARUS MEMBAYAR Owner      -> tombol Bayar
// Total < 0  : perusahaan BERHAK MENERIMA dari Owner -> tombol Terima
// Total = 0  : "Tidak ada pembayaran", tombol nonaktif
function renderOwnerPanels(recap, ctx) {
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

  const closed = String((ctx.period && ctx.period.status) || '').toLowerCase() === 'closed';
  const periodLabel = formatPeriodLabel(ctx.period);
  root.innerHTML = entries.map((o) => ownerPanelHtml(o, closed, periodLabel)).join('');
  root.querySelectorAll('.owner-panel__cta').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOwnerFilter(btn.dataset.ownerCode);
      location.hash = '#/rekap-bulanan';
    });
  });
  // Total Harus Dibayar -> Bayar / Terima -> nominal -> Konfirmasi
  root.querySelectorAll('.owner-panel__pay').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const ownerId = btn.dataset.ownerId;
      const current = ctx.getOwner(ownerId);
      const total = current ? ownerTotal(current) : 0;
      if (Math.abs(total) < SETTLED_EPS) return;
      openSettleModal({
        ownerId,
        period: ctx.period,
        total,
        saldo: ctx.getSaldo(),
        onSaved: (entry, duplicate) => {
          if (entry && !duplicate) ctx.patchSettled(ownerId, entry.kind, Number(entry.nominal) || 0);
          ctx.refresh();
        },
        onChanged: () => ctx.refresh()
      });
    });
  });
}

// Rounded-to-the-rupiah comparisons: totals are sums of floats, so "0" means
// |x| < half a rupiah (same tolerance the backend uses).
const SETTLED_EPS = 0.5;

// Total Harus Dibayar — backend (Rekap.gs + OwnerLedger.gs) sends
// `total_harus_dibayar`; an older backend that doesn't falls back to the
// original formula Omzet Jahit + Omzet Sablon - Pengeluaran.
function ownerTotal(o) {
  if (o.total_harus_dibayar !== undefined && o.total_harus_dibayar !== null) return Number(o.total_harus_dibayar) || 0;
  return (Number(o.jahit) || 0) + (Number(o.sablon) || 0) - (Number(o.pengeluaran) || 0);
}

function ownerPanelHtml(o, closed, periodLabel) {
  const jahit = Number(o.jahit) || 0;
  const sablon = Number(o.sablon) || 0;
  const pengeluaran = Number(o.pengeluaran) || 0;
  const hasil = jahit + sablon - pengeluaran;
  const total = ownerTotal(o);
  const sisaLalu = Number(o.sisa_sebelumnya) || 0;
  const piutangAwal = Number(o.piutang_awal) || 0;
  const saldoAwal = Number(o.saldo_awal_input) || 0;
  const dibayar = Number(o.dibayar) || 0;
  const diterima = Number(o.diterima) || 0;
  const code = String(o.owner_code || '');
  const codeLower = code.toLowerCase();
  const name = String(o.owner_name || code);

  const mode = total > SETTLED_EPS ? 'PAYMENT' : (total < -SETTLED_EPS ? 'RECEIPT' : 'NONE');
  const caption = mode === 'PAYMENT' ? 'Perusahaan harus membayar'
    : (mode === 'RECEIPT' ? 'Perusahaan berhak menerima' : 'Tidak ada pembayaran');
  const valueColor = mode === 'RECEIPT' ? 'var(--status-critical-fg)' : (mode === 'PAYMENT' ? 'var(--status-success-fg)' : 'var(--color-text-high)');

  // Progress penyelesaian: berapa bagian dari kewajiban kotor (sisa lalu + hasil
  // periode + piutang awal) yang sudah dibayar (Total > 0) / diterima (Total < 0).
  const gross = sisaLalu + hasil + piutangAwal;
  const settledAmt = gross >= 0 ? dibayar : diterima;
  const settledPct = Math.abs(gross) > SETTLED_EPS ? Math.max(0, Math.min(100, (settledAmt / Math.abs(gross)) * 100)) : 0;

  const actionBtn = mode === 'NONE'
    ? `<button type="button" class="btn btn-secondary owner-panel__pay" data-mode="NONE" data-owner-id="${escapeHtml(o.owner_id)}" disabled>${icon('check', 15)} Tidak ada pembayaran</button>`
    : `<button type="button" class="btn btn-primary owner-panel__pay" data-mode="${mode}" data-owner-id="${escapeHtml(o.owner_id)}">${icon(mode === 'PAYMENT' ? 'wallet' : 'arrowDown', 15)} ${mode === 'PAYMENT' ? 'Bayar' : 'Terima'}</button>`;

  return `
    <section class="card owner-panel owner-panel--${codeLower}" data-owner-code="${escapeHtml(code)}">
      <header class="op-head">
        <div class="op-avatar">${icon(codeLower === 'sunrise' ? 'sun' : 'building', 22)}</div>
        <div class="op-title">
          <h2 class="op-name owner-panel__name">${escapeHtml(name)}</h2>
          <div class="op-sub">Ringkasan keuangan periode ${escapeHtml(periodLabel || 'ini')}</div>
        </div>
        <span class="op-badge ${closed ? 'op-badge--closed' : ''}">${closed ? 'Ditutup' : 'Aktif'}</span>
      </header>

      <div class="op-stats">
        <div class="op-stat"><div class="op-stat__icon">${icon('scissors', 16)}</div><div class="op-stat__label">Omzet Jahit</div><div class="op-stat__value">${formatCurrency(jahit)}</div></div>
        <div class="op-stat"><div class="op-stat__icon">${icon('shirt', 16)}</div><div class="op-stat__label">Omzet Sablon</div><div class="op-stat__value">${formatCurrency(sablon)}</div></div>
        <div class="op-stat op-stat--neg"><div class="op-stat__icon">${icon('wallet', 16)}</div><div class="op-stat__label">Pengeluaran</div><div class="op-stat__value">${formatCurrency(pengeluaran)}</div></div>
        <div class="op-stat ${hasil < 0 ? 'op-stat--neg' : ''}" title="Omzet Jahit + Omzet Sablon − Pengeluaran"><div class="op-stat__icon">${icon('coins', 16)}</div><div class="op-stat__label">Hasil Periode</div><div class="op-stat__value" style="color:${hasil < 0 ? 'var(--status-critical-fg)' : 'inherit'}">${formatCurrency(hasil)}</div></div>
      </div>

      <div class="op-open">
        <div class="op-open__item op-open__item--saldo">
          <div class="op-open__icon">${icon('wallet', 18)}</div>
          <div class="op-open__body"><div class="op-open__label">Saldo Awal ${escapeHtml(name)}</div><div class="op-open__value">${formatCurrency(saldoAwal)}</div></div>
          <span class="op-info" title="Saldo kas awal ${escapeHtml(name)} yang diinput di Master Data > Saldo &amp; Piutang Awal untuk periode ini. Masuk ke Saldo Perusahaan, bukan ke Total Harus Dibayar.">${icon('info', 15)}</span>
        </div>
        <div class="op-open__item op-open__item--piutang">
          <div class="op-open__icon">${icon('users', 18)}</div>
          <div class="op-open__body"><div class="op-open__label">Piutang ${escapeHtml(name)}</div><div class="op-open__value">${formatCurrency(piutangAwal)}</div></div>
          <span class="op-info" title="Piutang Awal ${escapeHtml(name)} yang diinput untuk periode ini. Menambah Total Harus Dibayar.">${icon('info', 15)}</span>
        </div>
      </div>

      <div class="op-total op-total--${mode.toLowerCase()} owner-panel__stat--total">
        <div class="op-total__top">
          <div class="op-total__icon">${icon('coins', 22)}</div>
          <div class="op-total__main">
            <div class="op-total__label label" title="Total Harus Dibayar ${escapeHtml(name)}">Total Harus Dibayar ${escapeHtml(name)}</div>
            <div class="op-total__value value" style="color:${valueColor}">${formatCurrency(total)}</div>
            <div class="op-total__caption" title="${escapeHtml(caption)}">${caption}</div>
          </div>
        </div>
        <div class="op-progress" role="progressbar" aria-label="Penyelesaian Total Harus Dibayar ${escapeHtml(name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(settledPct)}"><span style="width:${settledPct.toFixed(0)}%"></span></div>
        <dl class="op-total__chips owner-panel__breakdown">
          <div><dt>Sisa periode lalu</dt><dd>${formatCurrency(sisaLalu)}</dd></div>
          <div><dt>${gross >= 0 || diterima === 0 ? 'Sudah dibayar' : 'Sudah diterima'}</dt><dd>${formatCurrency(gross >= 0 ? dibayar : diterima)}</dd></div>
        </dl>
        <div class="owner-panel__actions">
          ${actionBtn}
          <button type="button" class="btn btn-secondary owner-panel__cta" data-owner-code="${escapeHtml(code)}">${icon('chart', 15)} Lihat Detail ${escapeHtml(name)}</button>
        </div>
      </div>
    </section>
  `;
}
