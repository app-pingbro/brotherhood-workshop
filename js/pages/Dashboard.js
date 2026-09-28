// ============================================================================
// Dashboard — KPI hero cards from getMonthlyRecap (+ PAYROLL_DEDUCTIONS for
// Total Kasbon), an "Order Berjalan Periode Ini" summary (Jahit/Sablon count
// & value this period), a merged operational activity feed (Jahit/Sablon/
// Pengeluaran, most recent first), and the existing secondary stat strip.
//
// Feature F #2 (redesign): the old "Tren Hasil Bulan" line-chart card and
// "Transaksi Terbaru" (Jahit/Sablon-only) table card are REMOVED per the
// user's explicit request, replaced by the two sections above — confirmed
// via AskUserQuestion that "Status Produksi" and "Deadline Mendekat" (also
// requested) have NO backing data anywhere in the schema (no status/deadline
// column on SewingTransactions/PrintingTransactions or anywhere else), so
// per the user's choice ("Hilangkan keduanya") they are intentionally NOT
// built here — adding fake data or new DB columns for them was explicitly
// out of scope. Every number below comes from an existing backend action
// (getMonthlyRecap / getPayrollDeductions / getSewingTransactions /
// getPrintingTransactions / getExpenses) — none of it is invented.
//
// NOTE (judgment call, inherited): BUILD-SPEC's API contract does not pin
// the exact JSON field names getMonthlyRecap returns, so this page still
// reads via ui.pick() trying both totalPemasukan/total_pemasukan-style keys.
// ============================================================================
import { fetchData } from '../api.js';
import { fetchSWR, swr } from '../cache.js';
import { formatCurrency, formatDateTime, skeletonKpis, emptyState, escapeHtml, pick, badge, formatPeriodLabel, ownerDotClass } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getOwnerFilter, getLookups } from '../state.js';
import { ownerIdByCode, ownerName } from '../lookups.js';

export async function render(container) {
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header">
      <div><h1>Dashboard</h1><div class="subtitle">${period ? escapeHtml(formatPeriodLabel(period)) : 'Pilih periode di kanan atas'}</div></div>
      <div class="page-header__actions" id="dash-period-badge"></div>
    </div>
    <div id="dash-kpis">${skeletonKpis(5)}</div>
    <div class="grid grid-2 mt-16">
      <div class="card">
        <h3>Order Berjalan Periode Ini</h3>
        <div id="dash-orders" class="mt-12"><div class="skeleton-line" style="height:130px"></div></div>
      </div>
      <div class="card">
        <h3>Ringkasan Aktivitas Operasional</h3>
        <div id="dash-activity" class="mt-12"><div class="skeleton-line" style="height:130px"></div></div>
      </div>
    </div>
    <div class="mt-16">
      <h3 class="mb-8">Statistik Lain</h3>
      <div id="dash-stats">${skeletonKpis(4)}</div>
    </div>
  `;

  if (!period) {
    document.getElementById('dash-kpis').innerHTML = `<div class="card">${emptyState('Belum ada periode', 'Buat periode pertama dari Rekap Bulanan atau Master Data.', '\u{1F4C5}')}</div>`;
    document.getElementById('dash-orders').innerHTML = '';
    document.getElementById('dash-activity').innerHTML = '';
    document.getElementById('dash-stats').innerHTML = '';
    return;
  }

  renderPeriodBadge(period);

  // Instant UX (gas-instant-ux Prinsip 2/4 — stale-while-revalidate): each
  // section paints from cache the moment this function is called (0ms) if a
  // previous visit to this period/owner already loaded it, then quietly
  // refreshes from the server. On a cold cache this behaves exactly like
  // before — skeleton, one network round trip, render.
  const lk = getLookups();
  const ownerId = ownerIdByCode(lk, getOwnerFilter());
  await Promise.allSettled([
    loadRecapSection(period),
    loadOperationalSection(period, ownerId)
  ]);
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
  };

  const recapPromise = fetchSWR('getMonthlyRecap', { period_id: period.id }, (recap) => {
    painted = true;
    latestRecap = recap;
    repaint();
  }).catch(() => {
    if (!painted) {
      document.getElementById('dash-kpis').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat ringkasan bulan ini.</div>`;
      document.getElementById('dash-stats').innerHTML = '';
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

// ---- Order Berjalan + Ringkasan Aktivitas Operasional ----------------------
// Replaces the old "Tren Hasil Bulan" chart + "Transaksi Terbaru" table.
// Same underlying actions as before (getSewingTransactions/
// getPrintingTransactions), PLUS getExpenses so the activity feed reflects
// operational spending too, not just Jahit/Sablon orders — all real rows for
// the selected period/owner, nothing summarized or invented.
async function loadOperationalSection(period, ownerId) {
  let painted = false;
  try {
    await swr(`dashOps::${period.id}::${ownerId || ''}`, () => loadOperationalData(period, ownerId), (data) => {
      painted = true;
      renderOrders(data);
      renderActivity(data.activity);
    });
  } catch (e) {
    if (!painted) {
      document.getElementById('dash-orders').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat data order.</div>`;
      document.getElementById('dash-activity').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat aktivitas.</div>`;
    }
  }
}

async function loadOperationalData(period, ownerId) {
  const [jahit, sablon, expenses] = await Promise.all([
    fetchData('getSewingTransactions', { period_id: period.id, owner_id: ownerId }).catch(() => []),
    fetchData('getPrintingTransactions', { period_id: period.id, owner_id: ownerId }).catch(() => []),
    fetchData('getExpenses', { period_id: period.id, owner_id: ownerId }).catch(() => [])
  ]);
  const jahitRows = jahit || [];
  const sablonRows = sablon || [];
  const expenseRows = expenses || [];

  const activity = [
    ...jahitRows.map((r) => ({ ...r, __kind: 'Jahit', __label: r.nama_order, __value: r.total, __at: r.created_at })),
    ...sablonRows.map((r) => ({ ...r, __kind: 'Sablon', __label: r.nama_desain, __value: r.total, __at: r.created_at })),
    ...expenseRows.map((r) => ({ ...r, __kind: 'Pengeluaran', __label: expenseTypeName(r), __value: r.nominal, __at: r.created_at }))
  ].sort((a, b) => new Date(b.__at || 0) - new Date(a.__at || 0)).slice(0, 10);

  return {
    jahitCount: jahitRows.length,
    jahitValue: jahitRows.reduce((s, r) => s + (Number(r.total) || 0), 0),
    sablonCount: sablonRows.length,
    sablonValue: sablonRows.reduce((s, r) => s + (Number(r.total) || 0), 0),
    expenseCount: expenseRows.length,
    activity
  };
}

// Sama seperti nameOf() di Pengeluaran.js — resolve expense_type_id ke nama
// lewat cache getLookups() (bukan panggilan API terpisah).
function expenseTypeName(row) {
  const lk = getLookups();
  const item = (lk?.expenseTypes || []).find((x) => x.id === row.expense_type_id);
  return item ? item.name : (row.keterangan || 'Pengeluaran');
}

function ownerCodeOf(lk, ownerId) {
  return (lk?.owners || []).find((o) => o.id === ownerId)?.code || '';
}

function renderOrders(data) {
  const root = document.getElementById('dash-orders');
  const totalOrders = data.jahitCount + data.sablonCount;
  if (!totalOrders) {
    root.innerHTML = emptyState('Belum ada order', 'Order Jahit/Sablon periode ini akan muncul di sini.', '\u{1F9F5}');
    return;
  }
  const jahitPct = totalOrders ? (data.jahitCount / totalOrders) * 100 : 0;
  root.innerHTML = `
    <div class="mini-stat-row">
      <div class="mini-stat"><div class="label">Order Jahit</div><div class="value">${data.jahitCount}</div></div>
      <div class="mini-stat"><div class="label">Nilai Jahit</div><div class="value">${formatCurrency(data.jahitValue)}</div></div>
      <div class="mini-stat"><div class="label">Order Sablon</div><div class="value">${data.sablonCount}</div></div>
      <div class="mini-stat"><div class="label">Nilai Sablon</div><div class="value">${formatCurrency(data.sablonValue)}</div></div>
    </div>
    <div class="progress-track mt-12"><div class="progress-fill" style="width:${jahitPct.toFixed(0)}%"></div></div>
    <div class="progress-label"><span>Jahit ${data.jahitCount} order</span><span>Sablon ${data.sablonCount} order</span></div>
    <p class="subtitle mt-12">Total ${totalOrders} order tercatat pada periode ini${data.expenseCount ? ` &middot; ${data.expenseCount} transaksi Pengeluaran` : ''}.</p>
  `;
}

function renderActivity(rows) {
  const root = document.getElementById('dash-activity');
  if (!rows || !rows.length) {
    root.innerHTML = emptyState('Belum ada aktivitas', 'Aktivitas Jahit/Sablon/Pengeluaran terbaru akan muncul di sini.');
    return;
  }
  const lk = getLookups();
  const toneByKind = { Jahit: 'success', Sablon: 'neutral', Pengeluaran: 'warning' };
  root.innerHTML = `<div class="activity-list">${rows.map((r) => {
    const ownerTag = `<span class="owner-tag"><span class="owner-dot ${ownerDotClass(ownerCodeOf(lk, r.owner_id))}"></span>${escapeHtml(ownerName(lk, r.owner_id))}</span>`;
    return `<div class="activity-item">
      ${badge(r.__kind, toneByKind[r.__kind] || 'neutral')}
      <div class="activity-item__body">
        <div class="activity-item__title">${escapeHtml(r.__label || '-')}</div>
        <div class="activity-item__meta">${ownerTag}<span>&middot; ${escapeHtml(formatDateTime(r.__at))}</span></div>
      </div>
      <div class="activity-item__value">${formatCurrency(r.__value)}</div>
    </div>`;
  }).join('')}</div>`;
}
