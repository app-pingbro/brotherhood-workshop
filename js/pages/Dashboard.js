// ============================================================================
// Dashboard — KPI hero cards from getMonthlyRecap, a mixed recent-
// transactions list (latest Jahit/Sablon), a lightweight inline-SVG trend
// chart across the last few periods, and a secondary stat strip.
//
// NOTE (judgment call): BUILD-SPEC's API contract does not pin the exact
// JSON field names getMonthlyRecap returns (only "full additive computation
// + 3-step saldo + per-owner matrix"). This page reads via ui.pick() trying
// both totalPemasukan/total_pemasukan-style keys so it degrades gracefully
// against either casing; see the handoff notes for the assumed shape.
// ============================================================================
import { fetchData } from '../api.js';
<<<<<<< HEAD
import { fetchSWR, swr } from '../cache.js';
=======
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
import { formatCurrency, skeletonKpis, skeletonTable, emptyState, escapeHtml, pick, badge } from '../ui.js';
import { icon } from '../icons.js';
import { getState, getCurrentPeriod, getOwnerFilter, getLookups } from '../state.js';
import { ownerIdByCode, ownerName, nameById } from '../lookups.js';
import { lineAreaChart } from '../chart.js';

export async function render(container) {
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header">
      <div><h1>Dashboard</h1><div class="subtitle">${period ? escapeHtml(period.label || '') : 'Pilih periode di kanan atas'}</div></div>
    </div>
    <div id="dash-kpis">${skeletonKpis(3)}</div>
    <div class="grid grid-2 mt-16">
      <div class="card">
        <h3>Tren Hasil Bulan</h3>
        <div id="dash-chart" class="mt-12"><div class="skeleton-line" style="height:180px"></div></div>
      </div>
      <div class="card">
        <h3>Transaksi Terbaru</h3>
        <div id="dash-recent" class="mt-12">${skeletonTable(4, 5)}</div>
      </div>
    </div>
    <div class="mt-16">
      <h3 class="mb-8">Statistik Lain</h3>
      <div id="dash-stats">${skeletonKpis(4)}</div>
    </div>
  `;

  if (!period) {
    document.getElementById('dash-kpis').innerHTML = `<div class="card">${emptyState('Belum ada periode', 'Buat periode pertama dari Rekap Bulanan atau Master Data.', '\u{1F4C5}')}</div>`;
    document.getElementById('dash-chart').innerHTML = '';
    document.getElementById('dash-recent').innerHTML = '';
    document.getElementById('dash-stats').innerHTML = '';
    return;
  }

<<<<<<< HEAD
  // Instant UX (gas-instant-ux Prinsip 2/4 — stale-while-revalidate): each
  // section paints from cache the moment this function is called (0ms) if a
  // previous visit to this period/owner already loaded it, then quietly
  // refreshes from the server. On a cold cache this behaves exactly like
  // before — skeleton, one network round trip, render.
  const lk = getLookups();
  const ownerId = ownerIdByCode(lk, getOwnerFilter());
  await Promise.allSettled([
    loadRecapSection(period),
    loadRecentSection(period, ownerId),
    loadTrendSection(period)
  ]);
}

async function loadRecapSection(period) {
  let painted = false;
  try {
    await fetchSWR('getMonthlyRecap', { period_id: period.id }, (recap) => {
      painted = true;
      renderKpis(recap);
      renderStats(recap);
    });
  } catch (e) {
    if (!painted) {
      document.getElementById('dash-kpis').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat ringkasan bulan ini.</div>`;
      document.getElementById('dash-stats').innerHTML = '';
    }
  }
}

async function loadRecentSection(period, ownerId) {
  let painted = false;
  try {
    await swr(`dashRecent::${period.id}::${ownerId || ''}`, () => loadRecentTransactions(period), (recent) => {
      painted = true;
      renderRecent(recent);
    });
  } catch (e) {
    if (!painted) renderRecent([]);
  }
}

async function loadTrendSection(period) {
  let painted = false;
  try {
    await swr(`dashTrend::${period.id}`, () => loadTrend(period), (trend) => {
      painted = true;
      document.getElementById('dash-chart').innerHTML = lineAreaChart(trend, { colorVar: '--color-primary' }) + legendNote();
    });
  } catch (e) {
    if (!painted) {
      document.getElementById('dash-chart').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat tren.</div>`;
    }
  }
=======
  const [recap, recent, trend] = await Promise.allSettled([
    fetchData('getMonthlyRecap', { period_id: period.id }),
    loadRecentTransactions(period),
    loadTrend(period)
  ]);

  renderKpis(recap.status === 'fulfilled' ? recap.value : null);
  renderStats(recap.status === 'fulfilled' ? recap.value : null);
  document.getElementById('dash-chart').innerHTML = trend.status === 'fulfilled'
    ? lineAreaChart(trend.value, { colorVar: '--color-primary' }) + legendNote()
    : `<div class="notice notice-critical">${icon('alert')} Gagal memuat tren.</div>`;
  renderRecent(recent.status === 'fulfilled' ? recent.value : []);
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
}

function legendNote() {
  return '<div class="chart-legend"><span><span class="chart-legend__dot" style="background:var(--color-primary)"></span>Hasil Bulan (Pemasukan - Biaya)</span></div>';
}

function renderKpis(recap) {
  const root = document.getElementById('dash-kpis');
  const totalPemasukan = pick(recap, ['totalPemasukan', 'total_pemasukan']);
  const totalBiaya = pick(recap, ['totalBiaya', 'total_biaya']);
  const hasilBulan = pick(recap, ['hasilBulan', 'hasil_bulan'], totalPemasukan - totalBiaya);

  if (!recap) {
    root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat ringkasan bulan ini.</div>`;
    return;
  }

  root.innerHTML = `<div class="grid grid-kpi">
    <div class="card kpi-card kpi-card--accent">
      <div class="label">Total Pemasukan</div>
      <div class="value">${formatCurrency(totalPemasukan)}</div>
    </div>
    <div class="card kpi-card">
      <div class="label">Total Biaya</div>
      <div class="value">${formatCurrency(totalBiaya)}</div>
    </div>
    <div class="card kpi-card">
      <div class="label">Hasil Bulan</div>
      <div class="value" style="color:${hasilBulan >= 0 ? 'var(--status-success-fg)' : 'var(--status-critical-fg)'}">${formatCurrency(hasilBulan)}</div>
      <span class="delta ${hasilBulan >= 0 ? 'up' : 'down'}">${hasilBulan >= 0 ? '↑ Surplus' : '↓ Defisit'}</span>
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

async function loadRecentTransactions(period) {
  const lk = getLookups();
  const ownerId = ownerIdByCode(lk, getOwnerFilter());
  const [jahit, sablon] = await Promise.all([
    fetchData('getSewingTransactions', { period_id: period.id, owner_id: ownerId }).catch(() => []),
    fetchData('getPrintingTransactions', { period_id: period.id, owner_id: ownerId }).catch(() => [])
  ]);
  const merged = [
    ...(jahit || []).map((r) => ({ ...r, __kind: 'Jahit', __label: r.nama_order })),
    ...(sablon || []).map((r) => ({ ...r, __kind: 'Sablon', __label: r.nama_desain }))
  ];
  merged.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  return merged.slice(0, 8);
}

function renderRecent(rows) {
  const root = document.getElementById('dash-recent');
  if (!rows.length) { root.innerHTML = emptyState('Belum ada transaksi', 'Transaksi Jahit/Sablon terbaru akan muncul di sini.'); return; }
  const lk = getLookups();
  root.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Modul</th><th>Owner</th><th>Keterangan</th><th class="num">Total</th></tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td>${badge(r.__kind, r.__kind === 'Jahit' ? 'success' : 'neutral')}</td>
        <td><span class="owner-tag"><span class="owner-dot owner-dot--${(ownerCode(lk, r.owner_id) || '').toLowerCase()}"></span>${escapeHtml(ownerName(lk, r.owner_id))}</span></td>
        <td>${escapeHtml(r.__label || '-')}</td>
        <td class="num"><strong>${formatCurrency(r.total)}</strong></td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

function ownerCode(lk, ownerId) {
  return (lk?.owners || []).find((o) => o.id === ownerId)?.code || '';
}

async function loadTrend(period) {
  const state = getState();
  const sorted = state.periods.slice().sort((a, b) => (a.year - b.year) || (a.month - b.month));
  const idx = sorted.findIndex((p) => p.id === period.id);
  const windowPeriods = sorted.slice(Math.max(0, idx - 5), idx + 1);
  if (windowPeriods.length < 2) return [];
  const results = await Promise.all(windowPeriods.map((p) =>
    fetchData('getMonthlyRecap', { period_id: p.id }).catch(() => null)
  ));
  return windowPeriods.map((p, i) => ({
    label: p.label || `${p.month}/${p.year}`,
    value: pick(results[i], ['hasilBulan', 'hasil_bulan'], 0)
  }));
}
