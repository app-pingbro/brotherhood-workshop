// ============================================================================
// Slip Gaji — worker selector + printable payroll slip (professional
// document layout: header with company logo/name, worker info chips, an
// itemized "Rincian Penghasilan" table with Jumlah/Tarif/Total per income
// component, an itemized "Rincian Potongan" table with per-entry keterangan,
// and a highlighted "Total Diterima"). Shows a locked/"SNAPSHOT CLOSED"
// banner when the period is closed (server serves the frozen snapshot_json
// instead of a live computation — see BUILD-SPEC's Slip Gaji state machine).
// Print via window.print() with the print stylesheet in css/style.css.
//
// Every number on this page still comes from the SAME backend fields/formula
// as before (SalarySlip.gs's computeSalarySlipCore() — gajiKotor/
// totalPotongan/gajiBersih are read straight off the API response, never
// recomputed here). The Jumlah/Tarif breakdown and the per-entry Potongan
// rows are built client-side from the raw worker-payment/deduction rows the
// API already returns under slip.detail.* — no backend change was needed,
// since that detail (jumlah_hari_biasa, tarif_harian, jumlah_jam, tarif_per_jam,
// each deduction's own keterangan, etc) was already being sent, just not
// rendered. See aggregatePieceRate/aggregateDailyComponent/aggregateOvertime
// below — these only aggregate for DISPLAY and are verified by test to sum
// back to the exact same gajiKotor/totalPotongan the slip already showed.
// ============================================================================
import { fetchSWR, peek, invalidate } from '../cache.js';
import { postData } from '../api.js';
import { formatCurrency, escapeHtml, skeletonKpis, pick, formatPeriodLabel, toast } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups, getCompanyLogoUrl, getCompanyName } from '../state.js';
import { toOptions, ownerOptions } from '../lookups.js';
import { EXPENSE_OWNERS } from '../config.js';

let selectedEmployeeId = '';

const DEDUCTION_GROUPS = [
  { jenis: 'kasbon', label: 'Kasbon' },
  { jenis: 'hutang_cicilan', label: 'Cicilan Hutang' },
  { jenis: 'potongan_lain', label: 'Potongan Lain' }
];

export async function render(container) {
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
    loadSlip(period, selectedEmployeeId);
  });

  if (!period) {
    document.getElementById('slip-body').innerHTML = '<div class="notice notice-info">Pilih periode terlebih dahulu.</div>';
    return;
  }
  if (selectedEmployeeId) loadSlip(period, selectedEmployeeId);
  else document.getElementById('slip-body').innerHTML = '<div class="empty-state">' + icon('file', 26) + '<div class="empty-state__title mt-8">Pilih pekerja untuk melihat Slip Gaji</div></div>';
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
  if (cached === undefined) root.innerHTML = skeletonKpis(2);

  try {
    await fetchSWR('getSalarySlip', params, (slip) => {
      if (reqId !== slipRequestId || !root.isConnected) return;
      renderSlip(slip, period, employeeId);
    });
  } catch (e) {
    if (cached === undefined && reqId === slipRequestId && root.isConnected) {
      root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat Slip Gaji.</div>`;
    }
  }
}

// ---- Pure aggregation helpers (display-only — never feed back into the
// authoritative gajiKotor/totalPotongan/gajiBersih totals, which always come
// straight from the API response) --------------------------------------

// Jahit/Sablon Borongan: piece-rate, often several job types/orders per
// period each with its own harga_borongan — so a single "Tarif" is only
// meaningful when every row shares the same rate. tarif:null means "varies".
function aggregatePieceRate(rows) {
  let jumlah = 0;
  let total = 0;
  const rates = new Set();
  (rows || []).forEach((r) => {
    const j = Number(pick(r, ['jumlah'], 0)) || 0;
    const h = Number(pick(r, ['harga_borongan'], 0)) || 0;
    const t = Number(pick(r, ['total'], j * h)) || 0;
    jumlah += j;
    total += t;
    if (j > 0) rates.add(h);
  });
  return { jumlah, tarif: rates.size === 1 ? [...rates][0] : null, total };
}

// Gaji Hari Biasa / Gaji Hari Minggu: DAILY_WORKER_PAYMENTS stores both
// components combined into one 'total' per row (per SalarySlip.gs's own
// comment), so the per-component total is recomputed here the same way the
// backend computes it (jumlah * tarif), then summed across rows. The
// effective Tarif shown is this total divided by the Jumlah (so Jumlah x
// Tarif always reconciles to the Total shown), which only differs from the
// stored rate if an employee's rate changed mid-period across rows.
function aggregateDailyComponent(rows, jumlahKey, tarifKey) {
  let jumlah = 0;
  let total = 0;
  (rows || []).forEach((r) => {
    const j = Number(pick(r, [jumlahKey], 0)) || 0;
    const t = Number(pick(r, [tarifKey], 0)) || 0;
    jumlah += j;
    total += j * t;
  });
  return { jumlah, tarif: jumlah > 0 ? total / jumlah : 0, total };
}

// Gaji Lembur: OVERTIME stores jumlah_jam/tarif_per_jam/total per row already
// — total is taken straight from the stored field (matching how the backend
// sums totalLembur), jumlah_jam summed, effective tarif derived the same way.
function aggregateOvertime(rows) {
  let jumlah = 0;
  let total = 0;
  (rows || []).forEach((r) => {
    const j = Number(pick(r, ['jumlah_jam'], 0)) || 0;
    const rate = Number(pick(r, ['tarif_per_jam'], 0)) || 0;
    const t = Number(pick(r, ['total'], j * rate)) || 0;
    jumlah += j;
    total += t;
  });
  return { jumlah, tarif: jumlah > 0 ? total / jumlah : 0, total };
}

// Rincian Potongan: one row per deduction entry, grouped by jenis, carrying
// that entry's own "keterangan" (already stored per-row — Kasbon.js's form
// has always captured it, it just wasn't shown on the slip before). A jenis
// with zero entries still renders one placeholder row at Rp 0, matching the
// page's previous always-show-all-3-categories behavior (nothing that used
// to be visible disappears just because this period has no entries for it).
function buildDeductionRows(deductions, jenis) {
  const rows = (deductions || []).filter((d) => d.jenis === jenis);
  if (!rows.length) return [{ keterangan: '-', amount: 0 }];
  return rows.map((r) => ({
    keterangan: (r.keterangan && String(r.keterangan).trim()) || '-',
    amount: jenis === 'hutang_cicilan' ? Number(pick(r, ['nominal_cicilan'], 0)) || 0 : Number(pick(r, ['nominal'], 0)) || 0
  }));
}

function tarifCell(tarif) {
  if (tarif === null) return '<span class="text-low">Variatif</span>';
  if (!tarif) return '<span class="text-low">-</span>';
  return formatCurrency(tarif);
}

function jumlahCell(jumlah, unit) {
  if (!jumlah) return '<span class="text-low">-</span>';
  return `${jumlah.toLocaleString('id-ID')}${unit ? ' ' + unit : ''}`;
}

function renderSlip(slip, period, employeeId) {
  const root = document.getElementById('slip-body');
  const lk = getLookups();
  const employee = (lk?.employees || []).find((e) => e.id === employeeId);
  const locked = Boolean(pick(slip, ['locked'], false));

  const detail = slip.detail || {};
  const jahit = aggregatePieceRate(detail.sewingWorkerPayments);
  const sablon = aggregatePieceRate(detail.printingWorkerPayments);
  const biasa = aggregateDailyComponent(detail.dailyWorkerPayments, 'jumlah_hari_biasa', 'tarif_harian');
  const minggu = aggregateDailyComponent(detail.dailyWorkerPayments, 'jumlah_hari_minggu', 'tarif_minggu');
  const lembur = aggregateOvertime(detail.overtime);

  // Authoritative totals — always read straight from the API, never
  // recomputed from the breakdown above (that breakdown is display-only).
  const gajiKotor = pick(slip, ['gajiKotor', 'gaji_kotor'], jahit.total + sablon.total + biasa.total + minggu.total + lembur.total);
  const potongan = slip.potongan || {};
  const totalPotongan = pick(potongan, ['total', 'totalPotongan', 'total_potongan'], 0);
  const gajiBersih = pick(slip, ['gajiBersih', 'gaji_bersih'], gajiKotor - totalPotongan);

  const incomeRows = [
    { label: 'Gaji Jahit Borongan', agg: jahit, unit: 'pcs' },
    { label: 'Gaji Sablon Borongan', agg: sablon, unit: 'pcs' },
    { label: 'Gaji Hari Biasa', agg: biasa, unit: 'hari' },
    { label: 'Gaji Hari Minggu', agg: minggu, unit: 'hari' },
    { label: 'Gaji Lembur', agg: lembur, unit: 'jam' }
  ];

  const deductions = detail.deductions || [];
  const deductionGroupRows = DEDUCTION_GROUPS.flatMap((g) =>
    buildDeductionRows(deductions, g.jenis).map((row) => ({ label: g.label, ...row }))
  );

  const logoUrl = getCompanyLogoUrl();
  const companyName = getCompanyName();

  // Fitur: Slip Gaji - Pilih Pembayar ("Dibayarkan Oleh" PINGBRO/SUNRISE).
  // slip.payer ({owner_id, owner_code, owner_name, expense_id} | null) comes
  // straight from computeSalarySlipCore (SalarySlip.gs) — the SAME object a
  // CLOSED period's frozen snapshot_json carries, so this reads identically
  // whether the slip is live or locked. The chosen payer's NAME is shown as
  // a 4th info chip (prints with the slip, per "pilihan pembayar harus
  // terlihat pada Slip Gaji"); the select+Simpan control below it is the
  // no-print editor, hidden once the period is locked (assertPeriodOpen on
  // the backend already blocks the save either way — this just avoids
  // showing a control that would only error out).
  const payer = slip.payer || null;
  const payerOwnerName = payer ? payer.owner_name : '-';
  const payerOwnerId = payer ? payer.owner_id : '';

  root.innerHTML = `
    <div class="slip-sheet">
      ${locked ? `<div class="slip-locked-banner">${icon('lock', 15)} SNAPSHOT CLOSED &mdash; nilai dibekukan saat periode ditutup, tidak dihitung ulang.</div>` : ''}
      <div class="card slip-card">
        <div class="slip-header">
          <div class="slip-header__brand">
            <div class="slip-logo">${logoUrl ? `<img src="${logoUrl}" alt="Logo perusahaan" />` : icon('building', 22)}</div>
            <div>
              <div class="slip-company">${escapeHtml(companyName)}</div>
            </div>
          </div>
          <div class="slip-title-badge">Slip Gaji</div>
        </div>

        <div class="slip-info-row">
          <div class="slip-info-chip"><span class="slip-info-chip__label">Periode</span><span class="slip-info-chip__value">${escapeHtml(formatPeriodLabel(period))}</span></div>
          <div class="slip-info-chip"><span class="slip-info-chip__label">Nama Pekerja</span><span class="slip-info-chip__value">${escapeHtml(employee ? employee.name : '-')}</span></div>
          <div class="slip-info-chip"><span class="slip-info-chip__label">Status</span><span class="slip-info-chip__value">${locked ? 'Terkunci (Snapshot)' : 'Live'}</span></div>
          <div class="slip-info-chip"><span class="slip-info-chip__label">Dibayarkan Oleh</span><span class="slip-info-chip__value">${escapeHtml(payerOwnerName)}</span></div>
        </div>

        <div class="slip-card__body">
        <div class="flex-between no-print">
          <div></div>
          <button class="btn btn-secondary btn-sm" id="slip-print">${icon('print', 15)} Cetak / Ekspor</button>
        </div>

        <div class="no-print mt-16" id="slip-payer-editor">
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

        <div class="mt-20">
          <div class="slip-section-title">${icon('wallet', 15)} Rincian Penghasilan</div>
          <table class="slip-table">
            <thead><tr><th>Rincian</th><th class="num">Jumlah</th><th class="num">Tarif</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${incomeRows.map((r) => `
                <tr>
                  <td>${escapeHtml(r.label)}</td>
                  <td class="num">${jumlahCell(r.agg.jumlah, r.unit)}</td>
                  <td class="num">${tarifCell(r.agg.tarif)}</td>
                  <td class="num">${formatCurrency(r.agg.total)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr class="slip-table__total"><td colspan="3">TOTAL PENGHASILAN</td><td class="num">${formatCurrency(gajiKotor)}</td></tr>
            </tfoot>
          </table>
        </div>

        <div class="mt-20">
          <div class="slip-section-title">${icon('minus', 15)} Rincian Potongan</div>
          <table class="slip-table">
            <thead><tr><th>Rincian</th><th>Keterangan</th><th class="num">Total</th></tr></thead>
            <tbody>
              ${deductionGroupRows.map((r) => `
                <tr>
                  <td>${escapeHtml(r.label)}</td>
                  <td class="text-medium">${escapeHtml(r.keterangan)}</td>
                  <td class="num">${r.amount ? '-' + formatCurrency(r.amount) : formatCurrency(0)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr class="slip-table__total"><td colspan="2">TOTAL POTONGAN</td><td class="num">-${formatCurrency(totalPotongan)}</td></tr>
            </tfoot>
          </table>
        </div>

        <div class="slip-grand-total mt-20">
          <div class="slip-grand-total__icon">${icon('wallet', 20)}</div>
          <div class="slip-grand-total__label">TOTAL DITERIMA</div>
          <div class="slip-grand-total__value">${formatCurrency(gajiBersih)}</div>
        </div>

        <div class="slip-signatures no-print-spacer">
          <div class="slip-signature"><span>Penerima</span><div class="slip-signature__line"></div></div>
          <div class="slip-signature"><span>Administrasi</span><div class="slip-signature__line"></div></div>
        </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('slip-print')?.addEventListener('click', () => window.print());

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
      toast(ownerId ? 'Pembayar gaji disimpan.' : 'Pembayar gaji dikosongkan.', 'success');
      loadSlip(period, employeeId);
    }
  });
}
