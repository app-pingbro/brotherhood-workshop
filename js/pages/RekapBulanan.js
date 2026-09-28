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
import { formatCurrency, escapeHtml, skeletonKpis, skeletonTable, toast, openModal, closeModal, confirmDialog, pick, formatPeriodLabel } from '../ui.js';
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
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="page-icon">${icon('dashboard', 20)}</div>
        <div><h1>Rekap Bulanan</h1><div class="subtitle">${period ? escapeHtml(formatPeriodLabel(period)) : 'Pilih periode di kanan atas'}</div></div>
      </div>
      <div class="page-header__actions" id="period-actions"></div>
    </div>
    <div id="ringkasan-section" class="mt-16">${skeletonKpis(5)}</div>
    <div id="saldo-section" class="mt-16">${skeletonKpis(3)}</div>
    <div class="card mt-16">
      <h3 style="display:flex; align-items:center; gap:8px;">${icon('list', 18)} Rincian Perhitungan</h3>
      <div id="matrix-section" class="mt-12">${skeletonTable(7, 7)}</div>
    </div>
    <div class="card mt-16" id="formula-section"></div>
    <div class="card mt-16" id="koreksi-section"></div>
  `;

  // Kartu formula bersifat statis (tidak tergantung data recap) — dirender
  // langsung, tidak perlu menunggu fetch selesai.
  renderFormulaCard();

  if (!period) {
    document.getElementById('ringkasan-section').innerHTML = '';
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
  //
  // Feature F #1 (Total Kasbon/Potongan di Rincian Gaji & Lembur): the
  // matrix also needs PAYROLL_DEDUCTIONS for this period (same action/params
  // Kasbon.js already uses — getPayrollDeductions({period_id}) returns ALL
  // employees' rows for the period, no new backend action needed). Fetched
  // independently of getMonthlyRecap (own try/catch) so a hiccup fetching
  // deductions never blocks the core recap/saldo from rendering — worst
  // case Total Kasbon/Potongan just show 0 until it loads/retries.
  let painted = false;
  let latestRecap = null;
  let latestDeductions = [];
  const repaintMatrix = () => { if (latestRecap) renderMatrix(latestRecap, latestDeductions); };

  const recapPromise = fetchSWR('getMonthlyRecap', { period_id: period.id }, (recap) => {
    painted = true;
    latestRecap = recap;
    renderRingkasan(recap);
    renderSaldo(recap, period);
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

  await Promise.all([recapPromise, deductionsPromise]);
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

// Feature F #3 (perbaikan tampilan, referensi mockup dari user): 5 kartu
// ringkasan berwarna di atas tabel rinci — Omzet Jahit/Sablon, Total
// Pemasukan, Total Pengeluaran, Hasil Bersih. Semua nilai diambil dari
// computeTotals()/recap langsung (tidak ada angka baru/dummy).
function renderRingkasan(recap) {
  const root = document.getElementById('ringkasan-section');
  if (!root) return;
  if (!recap) { root.innerHTML = ''; return; }
  const t = computeTotals(recap);
  const cards = [
    { label: 'Omzet Jahit', value: t.omzetJahit, iconName: 'scissors', tone: 'success' },
    { label: 'Omzet Sablon', value: t.omzetSablon, iconName: 'droplet', tone: 'success' },
    { label: 'Total Pemasukan', value: recap.totalPemasukan, iconName: 'wallet', tone: 'info' },
    { label: 'Total Pengeluaran', value: recap.totalBiaya, iconName: 'receipt', tone: 'critical' },
    { label: 'Hasil Bersih', value: recap.hasilBulan, iconName: 'target', tone: 'highlight' }
  ];
  root.innerHTML = `<div class="grid grid-kpi">${cards.map((c) => `
    <div class="card ringkasan-card ringkasan-card--${c.tone}">
      <div class="stat-icon stat-icon--${c.tone}">${icon(c.iconName, 18)}</div>
      <div><div class="label">${escapeHtml(c.label)}</div><div class="value">${formatCurrency(c.value)}</div></div>
    </div>`).join('')}</div>`;
}

// Kartu "Formula Perhitungan" statis di bawah tabel — teks disesuaikan
// dengan rumus yang BENAR-BENAR berjalan di sistem saat ini (Total Biaya =
// Pengeluaran PINGBRO+SUNRISE, dikonfirmasi bersama user sebelumnya), bukan
// rumus lama "Rekap = (Rekap Bulanan + Omzet Sablon) - (Pengeluaran - Gaji...)"
// yang sempat dipakai di draft awal — menampilkan rumus yang tidak sesuai
// angka yang sebenarnya dihitung justru akan membingungkan, bukan membantu.
function renderFormulaCard() {
  const root = document.getElementById('formula-section');
  if (!root) return;
  root.innerHTML = `
    <div class="formula-card">
      <div class="formula-card__icon">${icon('info', 18)}</div>
      <div class="formula-card__body">
        <strong>Formula Perhitungan:</strong>
        <div class="formula-card__formula">
          Hasil Bulan = Total Pemasukan &minus; Total Biaya<br>
          Total Biaya = Pengeluaran PINGBRO + Pengeluaran SUNRISE
        </div>
      </div>
      <ul class="formula-card__notes">
        <li>Semua Gaji &amp; Lembur sudah tercatat di Pengeluaran (dibayar oleh Owner PINGBRO/SUNRISE), sehingga tidak dihitung dua kali di Total Biaya.</li>
        <li>Kasbon &amp; Potongan adalah potongan Slip Gaji pekerja, bukan biaya Owner &mdash; "Total Bersih" di Rincian Gaji &amp; Lembur murni informasi dan tidak memengaruhi Total Biaya/Hasil Bulan.</li>
        <li>Semua angka mengikuti Owner dan periode yang sedang dipilih.</li>
      </ul>
    </div>`;
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
  <p class="subtitle mt-8">Gaji &amp; Lembur dibayar dari tenaga kerja bersama (shared labor pool) sehingga tidak dapat diatribusikan ke satu Owner — selalu tampil di kolom Biaya Bersama sebagai rincian informasi. Gaji &amp; Lembur sudah tercatat sebagai baris Pengeluaran (dibayar oleh Owner PINGBRO/SUNRISE) sehingga <strong>tidak dijumlahkan lagi</strong> ke "Total Biaya" — Pengeluaran = Total Biaya, agar tidak dihitung dua kali. Kasbon &amp; Potongan (dari halaman Kasbon &amp; Potongan) adalah potongan Slip Gaji pekerja, bukan biaya Owner — "Total Bersih" di rincian ini hanya informasi gaji-setelah-potongan per pekerja secara agregat, dan tidak memengaruhi Total Biaya/Hasil Bulan di bawah. Pengeluaran hanya berlaku untuk PINGBRO &amp; SUNRISE (BROTHERHOOD tidak menanggung Pengeluaran operasional).</p>`;
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
