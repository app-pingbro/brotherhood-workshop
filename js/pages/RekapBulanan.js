// ============================================================================
// Rekap Bulanan — consolidated matrix (metric rows x PINGBRO/SUNRISE/
// BROTHERHOOD/Biaya Bersama/Gabungan columns), the 3-box saldo
// reconciliation, a Koreksi Saldo Awal form (correctSaldoAwal), and period
// Close/Reopen controls (reopen requires a reason, per PRD audit rule).
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
import { formatCurrency, escapeHtml, skeletonKpis, skeletonTable, toast, openModal, closeModal, confirmDialog, pick } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, setPeriods } from '../state.js';

const COLUMNS = [
  { key: 'PINGBRO', label: 'Pingbro' },
  { key: 'SUNRISE', label: 'Sunrise' },
  { key: 'BROTHERHOOD', label: 'Brotherhood' },
  { key: 'BIAYA_BERSAMA', label: 'Biaya Bersama' },
  { key: 'GABUNGAN', label: 'Gabungan' }
];

export async function render(container) {
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header">
      <div><h1>Rekap Bulanan</h1><div class="subtitle">${period ? escapeHtml(period.label || '') : 'Pilih periode di kanan atas'}</div></div>
      <div class="page-header__actions" id="period-actions"></div>
    </div>
    <div id="saldo-section">${skeletonKpis(3)}</div>
    <div class="card mt-16">
      <h3>Matriks Rekap</h3>
      <div id="matrix-section" class="mt-12">${skeletonTable(6, 6)}</div>
    </div>
    <div class="card mt-16" id="koreksi-section"></div>
  `;

  if (!period) {
    document.getElementById('saldo-section').innerHTML = '<div class="notice notice-info">Pilih periode terlebih dahulu.</div>';
    document.getElementById('matrix-section').innerHTML = '';
    document.getElementById('koreksi-section').innerHTML = '';
    return;
  }

  renderPeriodActions(period);
  // Independent of recap data (only needs `period`) — render it right away
  // rather than waiting on the recap fetch, and keep it OUT of the recap's
  // stale-while-revalidate callback below so a background refresh never
  // clobbers input the user is mid-typing into this form.
  renderKoreksiForm(period);

  // Instant UX (gas-instant-ux Prinsip 2/4): paint the saldo boxes + matrix
  // from cache immediately if this period was already viewed this session,
  // then quietly refresh from the server.
  let painted = false;
  try {
    await fetchSWR('getMonthlyRecap', { period_id: period.id }, (recap) => {
      painted = true;
      renderSaldo(recap, period);
      renderMatrix(recap);
    });
  } catch (e) {
    if (!painted) {
      document.getElementById('saldo-section').innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat Rekap Bulanan.</div>`;
      document.getElementById('matrix-section').innerHTML = '';
    }
  }
}

function renderPeriodActions(period) {
  const root = document.getElementById('period-actions');
  const isClosed = String(period.status || '').toLowerCase() === 'closed';
  root.innerHTML = '';
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

async function closePeriodFlow(period) {
  const ok = await confirmDialog(
    `Tutup periode "${period.label}"? Sistem akan membuat snapshot Slip Gaji untuk semua pekerja yang memiliki aktivitas pada periode ini, dan transaksi akan terkunci.`,
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

function renderSaldo(recap, period) {
  const root = document.getElementById('saldo-section');
  const saldoAwalOtomatis = pick(recap, ['saldoAwalOtomatis', 'saldo_awal_otomatis']);
  const saldoAwalKoreksi = pick(recap, ['saldoAwalKoreksi', 'saldo_awal_koreksi']);
  const saldoAwalFinal = pick(recap, ['saldoAwalFinal', 'saldo_awal_final'], saldoAwalOtomatis + saldoAwalKoreksi);
  const hasilBulan = pick(recap, ['hasilBulan', 'hasil_bulan']);
  const saldoAkhir = pick(recap, ['saldoAkhir', 'saldo_akhir'], saldoAwalFinal + hasilBulan);

  root.innerHTML = `
    <div class="saldo-boxes">
      <div class="saldo-box"><div class="label">Saldo Awal Otomatis</div><div class="value">${formatCurrency(saldoAwalOtomatis)}</div><div class="hint">= Saldo Akhir bulan lalu</div></div>
      <div class="saldo-op">+</div>
      <div class="saldo-box"><div class="label">Koreksi Manual</div><div class="value">${formatCurrency(saldoAwalKoreksi)}</div><div class="hint">tersimpan terpisah</div></div>
      <div class="saldo-op">=</div>
      <div class="saldo-box"><div class="label">Saldo Awal Final</div><div class="value">${formatCurrency(saldoAwalFinal)}</div></div>
    </div>
    <div class="grid grid-kpi mt-16">
      <div class="card kpi-card"><div class="label">Hasil Bulan</div><div class="value">${formatCurrency(hasilBulan)}</div></div>
      <div class="card kpi-card kpi-card--accent"><div class="label">Saldo Akhir</div><div class="value">${formatCurrency(saldoAkhir)}</div></div>
      <div class="card kpi-card"><div class="label">Status Periode</div><div class="value" style="font-size:16px">${String(period.status || '-').toUpperCase()}</div></div>
    </div>
  `;
}

function buildMatrixRows(recap) {
  const perOwner = recap.perOwner || {};
  const ownerRow = Object.values(perOwner); // {owner_id, owner_name, owner_code, jahit, sablon, pengeluaran, pemasukan}
  const byCode = (code) => ownerRow.find((o) => String(o.owner_code || '').toUpperCase() === code) || {};
  const P = byCode('PINGBRO'), S = byCode('SUNRISE'), B = byCode('BROTHERHOOD');
  const gaji = recap.gaji || {};
  const gajiTotal = (Number(gaji.gajiJahit) || 0) + (Number(gaji.gajiSablon) || 0) +
    (Number(gaji.gajiHarian) || 0) + (Number(gaji.gajiMinggu) || 0) + (Number(gaji.lembur) || 0);
  const pengeluaran = recap.pengeluaran || {};
  const pengeluaranTotal = (Number(pengeluaran.pingbro) || 0) + (Number(pengeluaran.sunrise) || 0);

  const row = (label, { pingbro = null, sunrise = null, brotherhood = null, bersama = null, gabungan, emphasize = false } = {}) => ({
    label, emphasize,
    values: { PINGBRO: pingbro, SUNRISE: sunrise, BROTHERHOOD: brotherhood, BIAYA_BERSAMA: bersama, GABUNGAN: gabungan }
  });

  return [
    row('Omzet Jahit', { pingbro: P.jahit, sunrise: S.jahit, brotherhood: B.jahit, gabungan: (P.jahit||0)+(S.jahit||0)+(B.jahit||0) }),
    row('Omzet Sablon', { pingbro: P.sablon, sunrise: S.sablon, brotherhood: B.sablon, gabungan: (P.sablon||0)+(S.sablon||0)+(B.sablon||0) }),
    row('Total Pemasukan', { pingbro: P.pemasukan, sunrise: S.pemasukan, brotherhood: B.pemasukan, gabungan: recap.totalPemasukan, emphasize: true }),
    row('Gaji Jahit Borongan', { bersama: gaji.gajiJahit, gabungan: gaji.gajiJahit }),
    row('Gaji Sablon Borongan', { bersama: gaji.gajiSablon, gabungan: gaji.gajiSablon }),
    row('Gaji Harian', { bersama: gaji.gajiHarian, gabungan: gaji.gajiHarian }),
    row('Gaji Minggu', { bersama: gaji.gajiMinggu, gabungan: gaji.gajiMinggu }),
    row('Lembur', { bersama: gaji.lembur, gabungan: gaji.lembur }),
    row('Pengeluaran', { pingbro: pengeluaran.pingbro, sunrise: pengeluaran.sunrise, brotherhood: null, gabungan: pengeluaranTotal }),
    row('Total Biaya', { bersama: gajiTotal, gabungan: recap.totalBiaya, emphasize: true }),
    row('Hasil Bulan', { gabungan: recap.hasilBulan, emphasize: true })
  ];
}

function renderMatrix(recap) {
  const root = document.getElementById('matrix-section');
  if (!recap) {
    root.innerHTML = '<div class="notice notice-info">Data matriks belum tersedia dari server untuk periode ini.</div>';
    return;
  }
  const rows = buildMatrixRows(recap);
  const cell = (v) => (v === null || v === undefined ? '<span class="text-muted">—</span>' : formatCurrency(v));
  root.innerHTML = `<div class="table-wrap"><table class="data-table recap-matrix">
    <thead><tr><th>Metrik</th>${COLUMNS.map((c) => `<th class="num">${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `
      <tr class="${r.emphasize ? 'total-row' : ''}">
        <td class="metric-label">${escapeHtml(r.label)}</td>
        ${COLUMNS.map((c) => `<td class="num">${cell(r.values[c.key])}</td>`).join('')}
      </tr>`).join('')}
    </tbody>
  </table></div>
  <p class="subtitle mt-8">Gaji dibayar dari tenaga kerja bersama (shared labor pool) sehingga tidak dapat diatribusikan ke satu Owner — selalu tampil di kolom Biaya Bersama. Pengeluaran hanya berlaku untuk PINGBRO &amp; SUNRISE (BROTHERHOOD tidak menanggung Pengeluaran operasional).</p>`;
}

function renderKoreksiForm(period) {
  const root = document.getElementById('koreksi-section');
  const isClosed = String(period.status || '').toLowerCase() === 'closed';
  root.innerHTML = `<h3>Koreksi Saldo Awal</h3>
    <p class="subtitle">Hak akses ADMIN/OWNER. Nilai otomatis tidak pernah ditimpa — koreksi tersimpan terpisah beserta alasan.</p>
    ${isClosed ? '<div class="notice notice-warning">' + icon('lock', 15) + ' Periode sedang CLOSED. Buka kembali periode untuk melakukan koreksi.</div>' : '<div id="koreksi-form-root"></div>'}`;
  if (isClosed) return;

  buildForm(document.getElementById('koreksi-form-root'), [
    { key: 'koreksi', label: 'Nominal Koreksi', type: 'number', required: true, hint: 'Boleh negatif. Ditambahkan ke Saldo Awal Otomatis.' },
    { key: 'alasan', label: 'Alasan Koreksi', type: 'textarea', required: true, fullWidth: true }
  ], { koreksi: '', alasan: '' }, null, async (values) => {
    const res = await postData('correctSaldoAwal', { period_id: period.id, koreksi: Number(values.koreksi) || 0, alasan: values.alasan });
    if (res.success) {
      toast('Koreksi Saldo Awal berhasil disimpan.', 'success');
      invalidateRecapCaches(period.id);
      render(document.getElementById('view'));
    }
  }, { submitLabel: 'Simpan Koreksi', cancelable: false });
}
