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
import { openSettleModal } from './SaldoPiutang.js';

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
    ['Saldo Akhir (Saldo Perusahaan)', pick(recap, ['saldoAkhir', 'saldo_akhir'])]
  ];
  root.innerHTML = `<div class="stat-strip">${items.map(([label, val]) => `
    <div class="stat-strip__item"><div class="label">${escapeHtml(label)}</div><div class="value">${formatCurrency(val)}</div></div>
  `).join('')}</div>`;
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
  root.innerHTML = entries.map((o) => ownerPanelHtml(o, closed)).join('');
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

function ownerPanelHtml(o, closed) {
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

  const chips = [];
  if (sisaLalu !== 0) chips.push(`Sisa periode lalu ${formatCurrency(sisaLalu)}`);
  if (piutangAwal !== 0) chips.push(`Piutang Awal ${formatCurrency(piutangAwal)}`);
  if (dibayar !== 0) chips.push(`Sudah dibayar ${formatCurrency(dibayar)}`);
  if (diterima !== 0) chips.push(`Sudah diterima ${formatCurrency(diterima)}`);

  const actionBtn = mode === 'NONE'
    ? `<button type="button" class="btn btn-secondary owner-panel__pay" data-mode="NONE" data-owner-id="${escapeHtml(o.owner_id)}" disabled>${icon('check', 15)} Tidak ada pembayaran</button>`
    : `<button type="button" class="btn btn-primary owner-panel__pay" data-mode="${mode}" data-owner-id="${escapeHtml(o.owner_id)}">${icon(mode === 'PAYMENT' ? 'wallet' : 'arrowDown', 15)} ${mode === 'PAYMENT' ? 'Bayar' : 'Terima'}</button>`;

  return `
    <section class="card owner-panel owner-panel--${codeLower}" data-owner-code="${escapeHtml(code)}">
      <header class="op-head">
        <div class="op-avatar">${icon(codeLower === 'sunrise' ? 'sun' : 'building', 22)}</div>
        <div class="op-title">
          <h2 class="op-name owner-panel__name">${escapeHtml(name)}</h2>
          <div class="op-sub">Ringkasan keuangan periode ini</div>
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
        <div class="op-total__icon">${icon('coins', 22)}</div>
        <div class="op-total__main">
          <div class="op-total__label label">Total Harus Dibayar ${escapeHtml(name)}</div>
          <div class="op-total__value value" style="color:${valueColor}">${formatCurrency(total)}</div>
          <div class="op-total__caption">${caption}</div>
          ${chips.length ? `<div class="op-total__chips owner-panel__breakdown">${chips.map((t) => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="owner-panel__actions">
          ${actionBtn}
          <button type="button" class="btn btn-secondary owner-panel__cta" data-owner-code="${escapeHtml(code)}">${icon('chart', 15)} Lihat Detail ${escapeHtml(name)}</button>
        </div>
      </div>
    </section>
  `;
}
