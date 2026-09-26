// ============================================================================
// Slip Gaji — worker selector + slip detail (Gaji Kotor, breakdown, Total
// Potongan, Gaji Bersih). Shows a locked/"SNAPSHOT CLOSED" banner when the
// period is closed (server serves the frozen snapshot_json instead of a
// live computation — see BUILD-SPEC's Slip Gaji state machine). Print via
// window.print() with the print stylesheet in css/style.css.
// ============================================================================
import { fetchSWR, peek } from '../cache.js';
import { formatCurrency, escapeHtml, skeletonKpis, pick } from '../ui.js';
import { icon } from '../icons.js';
import { getCurrentPeriod, getLookups } from '../state.js';
import { toOptions } from '../lookups.js';

let selectedEmployeeId = '';

export async function render(container) {
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header no-print">
      <div><h1>Slip Gaji</h1><div class="subtitle">${period ? escapeHtml(period.label || '') : 'Pilih periode di kanan atas'}</div></div>
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

async function loadSlip(period, employeeId) {
  const root = document.getElementById('slip-body');
  const params = { period_id: period.id, employee_id: employeeId };
  // Instant UX: re-picking a worker already viewed this session paints
  // their slip immediately from cache, then quietly refreshes.
  const cached = peek('getSalarySlip', params);
  if (cached === undefined) root.innerHTML = skeletonKpis(2);

  try {
    await fetchSWR('getSalarySlip', params, (slip) => renderSlip(slip, period, employeeId));
  } catch (e) {
    if (cached === undefined) {
      root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat Slip Gaji.</div>`;
    }
  }
}

function renderSlip(slip, period, employeeId) {
  const root = document.getElementById('slip-body');
  const lk = getLookups();
  const employee = (lk?.employees || []).find((e) => e.id === employeeId);
  const locked = Boolean(pick(slip, ['locked'], false));

  const gajiJahit = pick(slip, ['gajiJahitBorongan', 'gaji_jahit_borongan']);
  const gajiSablon = pick(slip, ['gajiSablonBorongan', 'gaji_sablon_borongan']);
  const gajiHarian = pick(slip, ['gajiHarian', 'gaji_harian']);
  const totalLembur = pick(slip, ['totalLembur', 'total_lembur']);
  const gajiKotor = pick(slip, ['gajiKotor', 'gaji_kotor'], gajiJahit + gajiSablon + gajiHarian + totalLembur);

  // Backend (SalarySlip.gs) nests the deduction breakdown one level down
  // under slip.potongan.* (not top-level fields) — confirmed against the
  // actual backend source, same nesting pattern as getMonthlyRecap.gaji.
  const potongan = slip.potongan || {};
  const kasbon = pick(potongan, ['kasbon']);
  const cicilan = pick(potongan, ['cicilanHutangBulanIni', 'cicilan_hutang_bulan_ini']);
  const potonganLain = pick(potongan, ['potonganLain', 'potongan_lain']);
  const totalPotongan = pick(potongan, ['total', 'totalPotongan', 'total_potongan'], kasbon + cicilan + potonganLain);
  const gajiBersih = pick(slip, ['gajiBersih', 'gaji_bersih'], gajiKotor - totalPotongan);

  root.innerHTML = `
    <div class="slip-sheet">
      ${locked ? `<div class="slip-locked-banner">${icon('lock', 15)} SNAPSHOT CLOSED &mdash; nilai dibekukan saat periode ditutup, tidak dihitung ulang.</div>` : ''}
      <div class="card">
        <div class="flex-between no-print">
          <div>
            <h3>${escapeHtml(employee ? employee.name : '-')}</h3>
            <div class="subtitle">${escapeHtml(period.label || '')} &middot; ${locked ? 'Terkunci (Snapshot)' : 'Live'}</div>
          </div>
          <div class="flex gap-8">
            <button class="btn btn-secondary btn-sm" id="slip-print">${icon('print', 15)} Cetak / Ekspor</button>
          </div>
        </div>
        <div class="mt-16">
          <h4>Rincian Gaji Kotor</h4>
          <div class="slip-line"><span>Gaji Jahit Borongan</span><span class="num">${formatCurrency(gajiJahit)}</span></div>
          <div class="slip-line"><span>Gaji Sablon Borongan</span><span class="num">${formatCurrency(gajiSablon)}</span></div>
          <div class="slip-line"><span>Gaji Harian</span><span class="num">${formatCurrency(gajiHarian)}</span></div>
          <div class="slip-line"><span>Total Lembur</span><span class="num">${formatCurrency(totalLembur)}</span></div>
          <div class="slip-line total"><span>Gaji Kotor</span><span class="num">${formatCurrency(gajiKotor)}</span></div>
        </div>
        <div class="mt-16">
          <h4>Rincian Potongan</h4>
          <div class="slip-line negative"><span>Kasbon</span><span class="num">-${formatCurrency(kasbon)}</span></div>
          <div class="slip-line negative"><span>Cicilan Hutang Bulan Ini</span><span class="num">-${formatCurrency(cicilan)}</span></div>
          <div class="slip-line negative"><span>Potongan Lain</span><span class="num">-${formatCurrency(potonganLain)}</span></div>
          <div class="slip-line total"><span>Total Potongan</span><span class="num">-${formatCurrency(totalPotongan)}</span></div>
        </div>
        <div class="mt-16">
          <div class="slip-line total" style="font-size:18px">
            <span>Gaji Bersih</span><span class="num">${formatCurrency(gajiBersih)}</span>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('slip-print')?.addEventListener('click', () => window.print());
}
