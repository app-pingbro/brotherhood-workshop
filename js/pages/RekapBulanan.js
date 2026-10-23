// ============================================================================
// Rekap Bulanan — ringkasan KPI (Omzet Jahit/Sablon, Total Pemasukan, Total
// Pengeluaran, Hasil Bersih, Saldo Akhir), perhitungan saldo (Saldo Awal
// Otomatis + Koreksi Manual = Saldo Awal Final -> Saldo Akhir), tabel
// Piutang & Pembayaran Owner, matriks "Rincian Perhitungan", penjelasan rumus
// dan kontrol Tutup/Buka Kembali periode (reopen wajib beralasan, sesuai
// aturan audit PRD).
//
// Form "Koreksi Saldo Awal" SENGAJA tidak ada lagi di halaman ini (UI saja);
// aksi backend correctSaldoAwal dan nilai koreksi yang sudah tersimpan tetap
// ada & tetap dihitung ke Saldo Awal Final (ditampilkan sebagai "Koreksi
// Manual"). Tidak ada rumus yang berubah di file ini.
//
// Matrix is built client-side from the ACTUAL backend response shape
// (verified against backend/Rekap.gs, not guessed): recap.perOwner is an
// object keyed by owner id -> {owner_name, owner_code, jahit, sablon,
// pengeluaran, pemasukan}; recap.gaji holds workshop-wide payroll totals
// (Gaji Jahit/Sablon Borongan, Harian, Minggu, Lembur are paid from a SHARED
// labor pool per the PRD, not attributable to one owner — they only ever
// appear in the "Biaya Bersama" column); recap.pengeluaran.{pingbro,sunrise}
// holds Pengeluaran, which BROTHERHOOD never carries (PRD CHECK constraint).
// ============================================================================
import { postData } from '../api.js';
import { fetchSWR, invalidate, invalidatePrefix } from '../cache.js';
import { buildForm } from './_shared.js';
import { formatCurrency, escapeHtml, skeletonKpis, skeletonTable, toast, openModal, closeModal, confirmDialog, pick, formatPeriodLabel } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getState, setPeriods } from '../state.js';

const COLUMNS = [
  { key: 'PINGBRO', label: 'Pingbro' },
  { key: 'SUNRISE', label: 'Sunrise' },
  { key: 'BROTHERHOOD', label: 'Brotherhood' },
  { key: 'BIAYA_BERSAMA', label: 'Biaya Bersama' },
  { key: 'GABUNGAN', label: 'Gabungan' }
];

// Rupiah dengan tanda minus di depan ("-Rp1.561.000"), konsisten dengan tabel.
function money(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + 'Rp' + Math.abs(v).toLocaleString('id-ID');
}
const pctText = (p) => `${p.toFixed(1).replace('.', ',')}%`;

// "01 – 30 September 2026", dari bulan/tahun periode saja.
function periodRange(period) {
  const m = Number(period.month), y = Number(period.year);
  if (!(m >= 1 && m <= 12) || !y) return '';
  const last = new Date(y, m, 0).getDate();
  const monthName = formatPeriodLabel(period).replace(/\s+\d{4}$/, '');
  return `01 – ${String(last).padStart(2, '0')} ${monthName} ${y}`;
}

// Periode tepat satu bulan sebelum `period` (jika ada) — hanya untuk
// perbandingan "dari bulan lalu"; tidak mempengaruhi angka apa pun.
function previousPeriod(period) {
  const periods = (getState().periods) || [];
  const key = Number(period.year) * 12 + Number(period.month);
  return periods.find((p) => Number(p.year) * 12 + Number(p.month) === key - 1) || null;
}

export async function render(container) {
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header rk-header">
      <div class="rk-title">
        <div class="page-icon">${icon('chart', 20)}</div>
        <div><h1>Rekap Bulanan</h1><div class="subtitle">${period ? 'Ringkasan keuangan workshop untuk periode ' + escapeHtml(formatPeriodLabel(period)) : 'Pilih periode di kanan atas'}</div></div>
      </div>
      <div class="page-header__actions rk-actions" id="period-actions"></div>
    </div>
    <div id="rk-status"></div>
    <div id="ringkasan-section" class="dash-section">${skeletonKpis(4)}</div>
    <div id="result-section" class="dash-section mt-16"></div>
    <div id="saldo-section" class="mt-16">${skeletonKpis(3)}</div>
    <div id="owner-section"></div>
    <div class="card mt-16 rk-matrix-card">
      <div class="rk-card-head">
        <span class="rk-card-icon">${icon('list', 18)}</span>
        <div><h3>Rincian Perhitungan</h3><small>Per Owner, Biaya Bersama, dan Gabungan</small></div>
      </div>
      <div class="rk-legend" aria-label="Keterangan warna">
        <span><i style="background:var(--status-success-fg)"></i>Pemasukan</span>
        <span><i style="background:var(--status-info-fg)"></i>Gaji &amp; Lembur</span>
        <span><i style="background:var(--status-critical-fg)"></i>Potongan (Kasbon, dll)</span>
        <span><i style="background:var(--status-warning-fg)"></i>Pengeluaran</span>
        <span><i style="background:var(--status-highlight-fg)"></i>Hasil Bulan</span>
      </div>
      <div id="matrix-section" class="mt-12">${skeletonTable(7, 7)}</div>
    </div>
    <div class="card mt-16" id="formula-section"></div>
  `;

  // Kartu formula bersifat statis (tidak tergantung data recap) — dirender
  // langsung, tidak perlu menunggu fetch selesai.
  renderFormulaCard();

  if (!period) {
    document.getElementById('ringkasan-section').innerHTML = '';
    document.getElementById('saldo-section').innerHTML = '<div class="notice notice-info">Pilih periode terlebih dahulu.</div>';
    document.getElementById('matrix-section').innerHTML = '';
    return;
  }

  renderPeriodActions(period);
  renderStatusNote(period);

  // Instant UX (gas-instant-ux Prinsip 2/4): paint everything from cache
  // immediately if this period was already viewed this session, then quietly
  // refresh from the server.
  //
  // Feature F #1 (Total Kasbon/Potongan di Rincian Gaji & Lembur): the
  // matrix also needs PAYROLL_DEDUCTIONS for this period (same action/params
  // Kasbon.js already uses — getPayrollDeductions({period_id}) returns ALL
  // employees' rows for the period, no new backend action needed). Fetched
  // independently of getMonthlyRecap (own try/catch) so a hiccup fetching
  // deductions never blocks the core recap/saldo from rendering.
  //
  // Perbandingan "dari bulan lalu" memakai getMonthlyRecap periode sebelumnya
  // (aksi yang sama, hanya dibaca) — juga independen & non-fatal.
  let painted = false;
  let latestRecap = null;
  let latestDeductions = [];
  let prevRecap = null;
  const prev = previousPeriod(period);
  const repaintKpis = () => {
    if (!latestRecap) return;
    renderRingkasan(latestRecap, prevRecap, prev);
    renderResult(latestRecap);
  };
  const repaintMatrix = () => { if (latestRecap) renderMatrix(latestRecap, latestDeductions); };

  const recapPromise = fetchSWR('getMonthlyRecap', { period_id: period.id }, (recap) => {
    painted = true;
    latestRecap = recap;
    repaintKpis();
    renderSaldo(recap);
    renderOwnerLedger(recap);
    repaintMatrix();
  }).catch(() => {
    if (!painted) {
      document.getElementById('ringkasan-section').innerHTML = '';
      document.getElementById('saldo-section').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat Rekap Bulanan.</div>`;
      document.getElementById('matrix-section').innerHTML = '';
    }
  });

  const deductionsPromise = fetchSWR('getPayrollDeductions', { period_id: period.id }, (rows) => {
    latestDeductions = rows || [];
    repaintMatrix();
  }).catch(() => { /* non-fatal — lihat komentar di atas */ });

  const prevPromise = prev
    ? fetchSWR('getMonthlyRecap', { period_id: prev.id }, (r) => { prevRecap = r; repaintKpis(); }).catch(() => { /* non-fatal */ })
    : Promise.resolve();

  await Promise.all([recapPromise, deductionsPromise, prevPromise]);
}

function renderPeriodActions(period) {
  const root = document.getElementById('period-actions');
  const isClosed = String(period.status || '').toLowerCase() === 'closed';
  root.innerHTML = `<div class="period-chip ${isClosed ? 'period-chip--closed' : ''}">
    <span class="period-chip__dot"></span>
    <div><strong>${isClosed ? 'Periode Ditutup' : 'Periode Berjalan'}</strong><small>${escapeHtml(periodRange(period))}</small></div>
  </div>`;
  const btn = document.createElement('button');
  if (isClosed) {
    btn.className = 'btn btn-secondary';
    btn.innerHTML = `${icon('lock', 15)} Buka Kembali Periode`;
    btn.addEventListener('click', () => openReopenModal(period));
  } else {
    btn.className = 'btn btn-primary';
    btn.innerHTML = `${icon('check', 15)} Tutup Periode`;
    btn.addEventListener('click', () => closePeriodFlow(period));
  }
  root.appendChild(btn);
}

// Keterangan status periode — satu kalimat singkat, sesuai perilaku sistem
// (tutup periode = transaksi terkunci + snapshot Slip Gaji; buka kembali
// wajib alasan dan tercatat di Audit Log).
function renderStatusNote(period) {
  const root = document.getElementById('rk-status');
  if (!root) return;
  const isClosed = String(period.status || '').toLowerCase() === 'closed';
  root.innerHTML = isClosed
    ? `<div class="rk-status rk-status--closed">${icon('lock', 17)}<span><strong>Periode sudah ditutup.</strong> Transaksi terkunci dan Slip Gaji memakai snapshot. Gunakan &ldquo;Buka Kembali Periode&rdquo; (wajib beralasan) jika data perlu diubah.</span></div>`
    : `<div class="rk-status rk-status--open">${icon('info', 17)}<span><strong>Periode masih berjalan.</strong> Angka di bawah mengikuti transaksi terbaru. Tutup periode setelah semua data final agar Slip Gaji dibekukan.</span></div>`;
}

async function closePeriodFlow(period) {
  const ok = await confirmDialog(
    `Tutup periode "${formatPeriodLabel(period)}"? Sistem akan membuat snapshot Slip Gaji untuk semua pekerja yang memiliki aktivitas pada periode ini, dan transaksi akan terkunci.`,
    { confirmLabel: 'Tutup Periode', tone: 'danger' }
  );
  if (!ok) return;
  const res = await postData('closePeriod', { period_id: period.id });
  if (res.success) {
    toast('Periode berhasil ditutup dan snapshot Slip Gaji dibuat.', 'success');
    invalidateRecapCaches(period.id);
    invalidate('getLookups'); // periods[].status changed
    await refreshPeriodsAndRerender();
  }
}

function invalidateRecapCaches(periodId) {
  invalidate('getMonthlyRecap', { period_id: periodId });
  invalidatePrefix('dashRecent');
  invalidatePrefix('dashTrend');
}

function openReopenModal(period) {
  openModal({
    title: 'Buka Kembali Periode',
    bodyHtml: '<div id="reopen-form-root"></div>',
    onMount: (body) => {
      const root = body.querySelector('#reopen-form-root');
      buildForm(root, [
        { key: 'reason', label: 'Alasan Reopen', type: 'textarea', required: true, fullWidth: true,
          hint: 'Wajib diisi — akan dicatat pada Audit Log beserta waktu dan pengguna.' }
      ], { reason: '' }, null, async (values) => {
        const res = await postData('reopenPeriod', { period_id: period.id, reason: values.reason });
        if (res.success) {
          toast('Periode dibuka kembali.', 'success');
          invalidateRecapCaches(period.id);
          invalidate('getLookups'); // periods[].status changed
          closeModal();
          await refreshPeriodsAndRerender();
        }
      }, { submitLabel: 'Buka Kembali Periode' });
    }
  });
}

async function refreshPeriodsAndRerender() {
  try {
    // Forced + written back into the shared cache (not a bare fetchData())
    // so the sidebar's period selector and every other page that reads
    // getLookups() also see the new status immediately, not after the TTL.
    const lookups = await fetchSWR('getLookups', {}, () => {}, { force: true });
    setPeriods(lookups.periods || []);
  } catch (e) { /* ignore */ }
  render(document.getElementById('view'));
}

// Nilai-nilai saldo dibaca persis seperti sebelumnya (tanpa rumus baru).
function saldoValues(recap) {
  const saldoAwalOtomatis = Number(pick(recap, ['saldoAwalOtomatis', 'saldo_awal_otomatis'])) || 0;
  const saldoAwalKoreksi = Number(pick(recap, ['saldoAwalKoreksi', 'saldo_awal_koreksi'])) || 0;
  // Saldo Awal (input) — saldo kas sebelum aplikasi dipakai (Master Data >
  // Saldo & Piutang Awal). 0 (dan kotaknya tidak tampil) sampai ada yang diinput.
  const saldoAwalInput = Number(recap.saldoAwalAwal) || 0;
  const saldoAwalFinal = Number(pick(recap, ['saldoAwalFinal', 'saldo_awal_final'], saldoAwalOtomatis + saldoAwalKoreksi + saldoAwalInput)) || 0;
  const hasilBulan = Number(pick(recap, ['hasilBulan', 'hasil_bulan'])) || 0;
  // Bayar / Terima Owner (Dashboard) — perpindahan kas, BUKAN Pengeluaran/Pemasukan,
  // jadi tidak ikut Hasil Bulan; hanya menggeser Saldo Akhir. 0 sampai dipakai.
  const bayarOwner = Number(recap.pembayaranOwner) || 0;
  const terimaOwner = Number(recap.penerimaanOwner) || 0;
  const saldoAkhir = Number(pick(recap, ['saldoAkhir', 'saldo_akhir'], saldoAwalFinal + hasilBulan - bayarOwner + terimaOwner)) || 0;
  return { saldoAwalOtomatis, saldoAwalKoreksi, saldoAwalInput, saldoAwalFinal, hasilBulan, bayarOwner, terimaOwner, saldoAkhir };
}

// Kartu "Perhitungan Saldo": dua persamaan berurutan —
//   Saldo Awal Final = Saldo Awal Otomatis + Koreksi Manual (+ Saldo Awal Input)
//   Saldo Akhir      = Saldo Awal Final + Hasil Bulan (− Bayar Owner + Terima Owner)
function renderSaldo(recap) {
  const root = document.getElementById('saldo-section');
  if (!root) return;
  const v = saldoValues(recap);
  const box = (label, value, hint, mod = '') => `
    <div class="rk-eq__box ${mod}"><div class="rk-eq__label">${label}</div><div class="rk-eq__value${value < 0 ? ' is-neg' : ''}">${money(value)}</div>${hint ? `<div class="rk-eq__hint">${hint}</div>` : ''}</div>`;
  const op = (sym) => `<div class="rk-eq__op" aria-hidden="true">${sym}</div>`;

  root.innerHTML = `
    <div class="card rk-saldo">
      <div class="rk-card-head">
        <span class="rk-card-icon">${icon('wallet', 18)}</span>
        <div><h3>Perhitungan Saldo</h3><small>Dari saldo awal sampai saldo akhir periode ini</small></div>
      </div>

      <div class="rk-eqtitle">Saldo Awal</div>
      <div class="rk-eq">
        ${box('Saldo Awal Otomatis', v.saldoAwalOtomatis, '= Saldo Akhir bulan lalu')}
        ${op('+')}
        ${box('Koreksi Manual', v.saldoAwalKoreksi, 'dari koreksi tersimpan')}
        ${v.saldoAwalInput !== 0 ? `${op('+')}${box('Saldo Awal (Input)', v.saldoAwalInput, 'sebelum aplikasi dipakai')}` : ''}
        ${op('=')}
        ${box('Saldo Awal Final', v.saldoAwalFinal, 'dipakai periode ini', 'rk-eq__box--result')}
      </div>

      <div class="rk-eqtitle">Saldo Akhir</div>
      <div class="rk-eq">
        ${box('Saldo Awal Final', v.saldoAwalFinal, '')}
        ${op('+')}
        ${box('Hasil Bulan', v.hasilBulan, 'Pemasukan − Biaya')}
        ${v.bayarOwner !== 0 ? `${op('−')}${box('Pembayaran ke Owner', v.bayarOwner, 'Bayar di Dashboard; bukan Pengeluaran')}` : ''}
        ${v.terimaOwner !== 0 ? `${op('+')}${box('Penerimaan dari Owner', v.terimaOwner, 'Terima di Dashboard; bukan Pemasukan')}` : ''}
        ${op('=')}
        ${box('Saldo Akhir', v.saldoAkhir, 'saldo kas akhir periode', 'rk-eq__box--result')}
      </div>
    </div>`;
}

// Piutang & pembayaran PINGBRO/SUNRISE — only shown once at least one of them
// has a Piutang Awal or a Pembayaran (backend flag ledger_aktif), so Rekap
// looks exactly as before for anyone not using Bayar / Piutang Awal.
function renderOwnerLedger(recap) {
  const root = document.getElementById('owner-section');
  if (!root) return;
  const rows = Object.values(recap.perOwner || {}).filter((o) => o.ledger_aktif);
  if (!rows.length) { root.innerHTML = ''; return; }
  const dot = (code) => `<i class="rk-dot rk-dot--${escapeHtml(String(code || '').toLowerCase())}"></i>`;
  root.innerHTML = `
    <div class="card mt-16 rk-owner-card">
      <div class="rk-card-head">
        <span class="rk-card-icon">${icon('coins', 18)}</span>
        <div><h3>Piutang &amp; Pembayaran Owner</h3><small>Tagihan periode, pembayaran, dan sisa yang harus dibayar</small></div>
      </div>
      <div class="table-wrap"><table class="data-table rk-table">
        <thead><tr><th>Owner</th><th class="num">Tagihan Periode</th><th class="num">Sisa Periode Lalu</th><th class="num">Piutang Awal</th><th class="num">Sudah Dibayar</th><th class="num">Sudah Diterima</th><th class="num">Total Harus Dibayar</th></tr></thead>
        <tbody>${rows.map((o) => `<tr>
          <td class="rk-owner">${dot(o.owner_code)}${escapeHtml(o.owner_name)}</td>
          <td class="num">${formatCurrency(o.tagihan)}</td>
          <td class="num c-warn">${formatCurrency(o.sisa_sebelumnya)}</td>
          <td class="num c-warn">${formatCurrency(o.piutang_awal)}</td>
          <td class="num c-ok">${formatCurrency(o.dibayar)}</td>
          <td class="num c-info">${formatCurrency(o.diterima || 0)}</td>
          <td class="num c-total"><strong>${formatCurrency(o.total_harus_dibayar)}</strong></td>
        </tr>`).join('')}</tbody>
      </table></div>
      <p class="rk-note">Total Harus Dibayar = Tagihan Periode + Sisa Periode Lalu + Piutang Awal &minus; Sudah Dibayar + Sudah Diterima.</p>
    </div>`;
}

// Dipakai bersama oleh renderRingkasan() (5 kartu ringkasan) dan
// buildMatrixRows() (tabel rinci) supaya angkanya SELALU sama persis — tidak
// ada rumus yang dihitung dua kali secara terpisah dan bisa berbeda.
function computeTotals(recap) {
  const perOwner = recap.perOwner || {};
  const ownerRow = Object.values(perOwner); // {owner_id, owner_name, owner_code, jahit, sablon, pengeluaran, pemasukan}
  const byCode = (code) => ownerRow.find((o) => String(o.owner_code || '').toUpperCase() === code) || {};
  const P = byCode('PINGBRO'), S = byCode('SUNRISE'), B = byCode('BROTHERHOOD');
  const gaji = recap.gaji || {};
  const gajiTotal = (Number(gaji.gajiJahit) || 0) + (Number(gaji.gajiSablon) || 0) +
    (Number(gaji.gajiHarian) || 0) + (Number(gaji.gajiMinggu) || 0) + (Number(gaji.lembur) || 0);
  const pengeluaran = recap.pengeluaran || {};
  const omzetJahit = (P.jahit || 0) + (S.jahit || 0) + (B.jahit || 0);
  const omzetSablon = (P.sablon || 0) + (S.sablon || 0) + (B.sablon || 0);
  return { P, S, B, gaji, gajiTotal, pengeluaran, omzetJahit, omzetSablon };
}

// Perbandingan dengan bulan lalu: persentase dihitung dari recap periode
// sebelumnya (aksi yang sama). `goodWhenUp`: naik = baik (hijau) atau buruk (merah).
function trendMeta(cur, prevRecap, prevValue, goodWhenUp) {
  if (!prevRecap) return '<div class="kh-sub">Belum ada data bulan lalu</div>';
  const prev = Number(prevValue) || 0;
  const sub = `<div class="kh-sub">Bulan lalu ${money(prev)}</div>`;
  if (prev <= 0) return sub;
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.05) return `<span class="kh-chip kh-chip--flat">Sama dengan bulan lalu</span>${sub}`;
  const good = (p >= 0) === goodWhenUp;
  return `<span class="kh-chip kh-chip--${good ? 'up' : 'down'}">${p >= 0 ? '↑' : '↓'} ${pctText(Math.abs(p))} dari bulan lalu</span>${sub}`;
}

function heroCard(tone, iconName, label, value, meta, valueColor = '') {
  return `
    <article class="kpi-hero ${tone}">
      <div class="kpi-hero__top">
        <span class="kpi-hero__icon">${icon(iconName, 22)}</span>
        <div class="kpi-hero__label">${escapeHtml(label)}</div>
      </div>
      <div class="kpi-hero__value" ${valueColor ? `style="color:${valueColor}"` : ''}>${money(value)}</div>
      <div class="kpi-hero__meta">${meta}</div>
    </article>`;
}

// 4 kartu utama: Omzet Jahit, Omzet Sablon, Total Pemasukan, Total Pengeluaran.
// Semua nilai diambil dari computeTotals()/recap langsung (tidak ada angka baru).
function renderRingkasan(recap, prevRecap, prev) {
  const root = document.getElementById('ringkasan-section');
  if (!root) return;
  if (!recap) { root.innerHTML = ''; return; }
  const t = computeTotals(recap);
  const pt = prevRecap ? computeTotals(prevRecap) : null;
  const pemasukan = Number(recap.totalPemasukan) || 0;
  const biaya = Number(recap.totalBiaya) || 0;
  const pctOfOmzet = pemasukan > 0 ? (biaya / pemasukan) * 100 : null;
  root.innerHTML = `<div class="kpi-hero-grid">
    ${heroCard('', 'scissors', 'Omzet Jahit', t.omzetJahit, trendMeta(t.omzetJahit, prevRecap, pt && pt.omzetJahit, true))}
    ${heroCard('kpi-hero--omzet', 'droplet', 'Omzet Sablon', t.omzetSablon, trendMeta(t.omzetSablon, prevRecap, pt && pt.omzetSablon, true))}
    ${heroCard('kpi-hero--hasil', 'wallet', 'Total Pemasukan', pemasukan, trendMeta(pemasukan, prevRecap, prevRecap && prevRecap.totalPemasukan, true))}
    ${heroCard('kpi-hero--keluar', 'receipt', 'Total Pengeluaran', biaya, trendMeta(biaya, prevRecap, prevRecap && prevRecap.totalBiaya, false) + (pctOfOmzet !== null ? `<div class="kh-sub">${pctOfOmzet.toFixed(0)}% dari Total Pemasukan</div>` : ''))}
  </div>`;
}

// Baris kedua: Hasil Bersih dan Saldo Akhir.
function renderResult(recap) {
  const root = document.getElementById('result-section');
  if (!root) return;
  if (!recap) { root.innerHTML = ''; return; }
  const v = saldoValues(recap);
  const pemasukan = Number(recap.totalPemasukan) || 0;
  const biaya = Number(recap.totalBiaya) || 0;
  const hasil = Number(pick(recap, ['hasilBulan', 'hasil_bulan'], pemasukan - biaya)) || 0;
  const surplus = hasil >= 0;
  let hasilNote;
  if (surplus) hasilNote = pemasukan > 0 && hasil > 0 ? `Pemasukan melebihi pengeluaran sebesar ${(hasil / pemasukan * 100).toFixed(0)}%` : 'Pemasukan sama dengan pengeluaran';
  else hasilNote = pemasukan > 0 ? `Pengeluaran melebihi pemasukan sebesar ${(-hasil / pemasukan * 100).toFixed(0)}%` : 'Pengeluaran melebihi pemasukan';
  const delta = v.saldoAkhir - v.saldoAwalFinal;
  const deltaChip = Math.abs(delta) < 0.5
    ? '<span class="kh-chip kh-chip--flat">Tidak berubah dari awal periode</span>'
    : `<span class="kh-chip kh-chip--${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '↑' : '↓'} ${money(Math.abs(delta))} dari awal periode</span>`;
  root.innerHTML = `<div class="rk-pair">
    ${heroCard(surplus ? '' : 'kpi-hero--keluar', 'chart', 'Hasil Bersih', hasil,
      `<span class="kh-chip kh-chip--${surplus ? 'up' : 'down'}">${surplus ? '↑ Surplus' : '↓ Defisit'}</span><div class="kh-sub">${hasilNote}</div>`,
      surplus ? 'var(--status-success-fg)' : 'var(--status-critical-fg)')}
    ${heroCard('kpi-hero--omzet', 'wallet', 'Saldo Akhir', v.saldoAkhir,
      `${deltaChip}<div class="kh-sub">Saldo awal final ${money(v.saldoAwalFinal)}</div>`,
      v.saldoAkhir < 0 ? 'var(--status-critical-fg)' : '')}
  </div>`;
}

// Kartu "Cara Membaca Rekap" statis — teks sesuai rumus yang BENAR-BENAR
// berjalan di sistem (Total Biaya = Pengeluaran PINGBRO+SUNRISE, dikonfirmasi
// bersama user sebelumnya).
function renderFormulaCard() {
  const root = document.getElementById('formula-section');
  if (!root) return;
  root.innerHTML = `
    <div class="rk-card-head">
      <span class="rk-card-icon">${icon('info', 18)}</span>
      <div><h3>Rumus Perhitungan</h3><small>Cara angka di halaman ini dihitung</small></div>
    </div>
    <div class="rk-formulas">
      <div class="rk-formula"><b>Hasil Bulan</b> = Total Pemasukan &minus; Total Biaya</div>
      <div class="rk-formula"><b>Total Biaya</b> = Pengeluaran PINGBRO + Pengeluaran SUNRISE</div>
      <div class="rk-formula"><b>Saldo Awal Final</b> = Saldo Awal Otomatis + Koreksi Manual (+ Saldo Awal Input)</div>
      <div class="rk-formula"><b>Saldo Akhir</b> = Saldo Awal Final + Hasil Bulan &minus; Pembayaran Owner + Penerimaan Owner</div>
    </div>
    <ul class="rk-notes">
      <li>Gaji &amp; Lembur sudah tercatat di Pengeluaran (dibayar Owner PINGBRO/SUNRISE), jadi tidak dihitung dua kali di Total Biaya.</li>
      <li>Kasbon &amp; Potongan memotong Slip Gaji pekerja, bukan biaya Owner &mdash; &ldquo;Total Bersih&rdquo; di rincian hanya informasi.</li>
      <li>Bayar/Terima Owner hanya menggeser Saldo Akhir, bukan Pengeluaran atau Pemasukan.</li>
      <li>Semua angka mengikuti periode yang dipilih di kanan atas.</li>
    </ul>`;
}

function buildMatrixRows(recap, deductions) {
  const { P, S, B, gaji, gajiTotal, pengeluaran, omzetJahit, omzetSablon } = computeTotals(recap);

  // Feature F #1 — Total Kasbon / Total Potongan / Total Bersih di Rincian
  // Gaji & Lembur. PAYROLL_DEDUCTIONS punya 3 jenis (lihat config.js
  // DEDUCTION_TYPES: kasbon / hutang_cicilan / potongan_lain) dan TIDAK
  // punya owner_id sama sekali (per-employee, sama seperti Gaji & Lembur di
  // atas — shared labor pool, karenanya juga tampil di kolom Biaya Bersama,
  // bukan per-Owner). Rumus ini SENGAJA meniru persis
  // computeSalarySlipCore() di backend/SalarySlip.gs (satu-satunya rumus
  // "potongan gaji" yang sudah ada di sistem, dipakai Slip Gaji per
  // pekerja): kasbon = Σnominal (jenis kasbon), hutang_cicilan memakai
  // `nominal_cicilan` (cicilan BULAN INI, bukan total_hutang keseluruhan),
  // potongan_lain = Σnominal — lalu diagregasi lintas SEMUA pekerja untuk
  // periode ini (bukan satu pekerja seperti di Slip Gaji). "Total Potongan"
  // = hutang_cicilan + potongan_lain (kasbon dipisah sendiri, mengikuti
  // pemisahan 2 baris yang diminta user), match dengan
  // computeSalarySlipCore's totalPotongan = kasbon + cicilanBulanIni + potonganLain.
  //
  // "Total Bersih" = Total Gaji & Lembur - (Total Kasbon + Total Potongan)
  // adalah figur INFORMASI untuk bagian rincian ini SAJA — TIDAK
  // ditambahkan/dikurangkan ke "Total Biaya"/"Hasil Bulan" Rekap di bawah.
  // Kasbon & Potongan adalah potongan Slip Gaji pekerja (mengurangi apa yang
  // diterima pekerja), BUKAN biaya usaha Owner — beda dari Gaji & Lembur
  // yang memang dicatat ulang sebagai Pengeluaran Owner. Sehingga tidak ada
  // risiko dihitung dua kali ke Total Biaya (yang sudah exclude Kasbon/
  // Potongan sejak awal, lihat Rekap.gs).
  const rows_ = deductions || [];
  const sumJenis = (jenis, field) => rows_
    .filter((r) => r.jenis === jenis)
    .reduce((s, r) => s + (Number(r[field]) || 0), 0);
  const totalKasbon = sumJenis('kasbon', 'nominal');
  const totalPotongan = sumJenis('potongan_lain', 'nominal') + sumJenis('hutang_cicilan', 'nominal_cicilan');
  const totalBersih = gajiTotal - (totalKasbon + totalPotongan);

  // Feature F #3 (tampilan): setiap baris data bernomor urut otomatis; baris
  // pemisah bagian ("Rincian Gaji & Lembur...") dan baris akhir "Hasil
  // Bulan" (ikon target, bukan nomor) TIDAK ikut diberi nomor — persis
  // seperti referensi tampilan dari user.
  let n = 0;
  const row = (label, { pingbro = null, sunrise = null, brotherhood = null, bersama = null, gabungan, emphasize = false, tone = null } = {}) => {
    n += 1;
    return {
      no: n, label, emphasize, tone,
      values: { PINGBRO: pingbro, SUNRISE: sunrise, BROTHERHOOD: brotherhood, BIAYA_BERSAMA: bersama, GABUNGAN: gabungan }
    };
  };
  const sectionRow = (label) => ({ isSection: true, label });
  const finalRow = (label, { gabungan, tone = null }) => ({
    isFinal: true, label, emphasize: true, tone,
    values: { PINGBRO: null, SUNRISE: null, BROTHERHOOD: null, BIAYA_BERSAMA: null, GABUNGAN: gabungan }
  });

  return [
    sectionRow('Pemasukan'),
    row('Omzet Jahit', { pingbro: P.jahit, sunrise: S.jahit, brotherhood: B.jahit, gabungan: omzetJahit }),
    row('Omzet Sablon', { pingbro: P.sablon, sunrise: S.sablon, brotherhood: B.sablon, gabungan: omzetSablon }),
    row('Total Pemasukan', { pingbro: P.pemasukan, sunrise: S.pemasukan, brotherhood: B.pemasukan, gabungan: recap.totalPemasukan, emphasize: true, tone: 'success' }),
    // Baris "Rincian Gaji & Lembur" di bawah ini BERSIFAT INFORMASI SAJA —
    // gaji & lembur sudah tercatat sebagai baris Pengeluaran (dibayar oleh
    // Owner PINGBRO/SUNRISE), sehingga TIDAK ikut dijumlahkan lagi ke
    // "Total Biaya" (lihat computeRecapForPeriod_ di Rekap.gs). Baris ini
    // sengaja tidak punya nilai "Gabungan" ikut ke Total Biaya di bawah,
    // supaya tidak terlihat seperti dihitung dua kali.
    sectionRow('Rincian Gaji & Lembur (setelah Kasbon & Potongan)'),
    row('Gaji Jahit Borongan', { bersama: gaji.gajiJahit, gabungan: gaji.gajiJahit }),
    row('Gaji Sablon Borongan', { bersama: gaji.gajiSablon, gabungan: gaji.gajiSablon }),
    row('Gaji Harian', { bersama: gaji.gajiHarian, gabungan: gaji.gajiHarian }),
    row('Gaji Minggu', { bersama: gaji.gajiMinggu, gabungan: gaji.gajiMinggu }),
    row('Lembur', { bersama: gaji.lembur, gabungan: gaji.lembur }),
    row('Total Gaji & Lembur', { bersama: gajiTotal, gabungan: gajiTotal, emphasize: true, tone: 'info' }),
    row('Total Kasbon', { bersama: -totalKasbon, gabungan: -totalKasbon, tone: 'critical' }),
    row('Total Potongan', { bersama: -totalPotongan, gabungan: -totalPotongan, tone: 'critical' }),
    row('Total Bersih (Gaji & Lembur setelah Kasbon/Potongan)', { bersama: totalBersih, gabungan: totalBersih, emphasize: true, tone: 'info' }),
    // "Pengeluaran" DAN "Total Biaya" adalah angka yang SAMA persis
    // (Total Biaya = Pengeluaran PINGBRO + SUNRISE, lihat Rekap.gs) — baris
    // "Total Biaya" terpisah yang dulu ada di sini dihapus karena hanya
    // mengulang angka yang sama dan berpotensi membingungkan (referensi
    // tampilan user juga tidak punya baris terpisah untuk ini). Nilai
    // Gabungan di sini diambil LANGSUNG dari recap.totalBiaya (bukan
    // dihitung ulang secara lokal) supaya selalu 100% sama dengan sumbernya.
    sectionRow('Pengeluaran & Hasil Bulan'),
    row('Pengeluaran (= Total Biaya)', { pingbro: pengeluaran.pingbro, sunrise: pengeluaran.sunrise, brotherhood: null, gabungan: recap.totalBiaya, emphasize: true, tone: 'warning' }),
    finalRow('Hasil Bulan', { gabungan: recap.hasilBulan, tone: 'highlight' })
  ];
}

function renderMatrix(recap, deductions) {
  const root = document.getElementById('matrix-section');
  if (!recap) {
    root.innerHTML = '<div class="notice notice-info">Data matriks belum tersedia dari server untuk periode ini.</div>';
    return;
  }
  const rows = buildMatrixRows(recap, deductions);
  // Negative values (Total Kasbon/Total Potongan) render as "-Rp500.000",
  // matching the existing convention in SlipGaji.js's "Rincian Potongan"
  // (`-${formatCurrency(kasbon)}`) rather than formatCurrency's own
  // "Rp-500.000" (Number.toLocaleString puts the sign after "Rp").
  const cell = (v) => {
    if (v === null || v === undefined) return '<span class="text-muted">—</span>';
    const n = Number(v) || 0;
    return n < 0 ? `-${formatCurrency(Math.abs(n))}` : formatCurrency(n);
  };
  const colspan = 2 + COLUMNS.length;
  root.innerHTML = `<div class="table-wrap"><table class="data-table recap-matrix">
    <thead><tr><th class="num-col">No</th><th>Metrik</th>${COLUMNS.map((c) => `<th class="num">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => {
      if (r.isSection) {
        return `<tr class="row-section"><td colspan="${colspan}">${escapeHtml(r.label)}</td></tr>`;
      }
      const toneClass = r.tone ? `row-tone--${r.tone}` : '';
      const negClass = Object.values(r.values).some((v) => typeof v === 'number' && v < 0) ? 'row-negative' : '';
      const noCell = r.isFinal ? `<td class="icon-col">${icon('target', 16)}</td>` : `<td class="num-col">${r.no}</td>`;
      return `
      <tr class="${toneClass} ${negClass} ${r.emphasize ? 'total-row' : ''}">
        ${noCell}
        <td class="metric-label">${escapeHtml(r.label)}</td>
        ${COLUMNS.map((c) => `<td class="num">${cell(r.values[c.key])}</td>`).join('')}
      </tr>`;
    }).join('')}
    </tbody>
  </table></div>
  <p class="rk-note">Biaya Bersama = tenaga kerja bersama (Gaji &amp; Lembur tidak dibagi per Owner dan sudah termasuk di Pengeluaran). Pengeluaran hanya berlaku untuk PINGBRO &amp; SUNRISE.</p>`;
}
