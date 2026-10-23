// ============================================================================
// Slip Gaji — tampilan DOM (preview layar + cetak PDF). Markup yang SAMA
// dipakai untuk preview dan hasil cetak; ukuran font & jumlah kolom tabel
// dihitung SEKALI oleh fitSlip() supaya seluruh slip selalu muat 1 halaman A4
// tanpa menghilangkan baris data. Semua ukuran di CSS memakai satuan `em`
// yang bertumpu pada --sg-fs, jadi mengecilkan font = mengecilkan seluruh
// layout secara proporsional (tabel, spacing, padding).
// ============================================================================
import { escapeHtml } from '../ui.js';
import { icon } from '../icons.js';
import { rupiah, qtyId } from './model.js';

// Area isi A4 setelah @page margin 10mm = 190mm x 277mm. Kita sisakan margin
// pengaman ~3mm supaya pembulatan mesin cetak tidak pernah memunculkan
// halaman ke-2.
export const SHEET_W_MM = 190;
export const SHEET_H_MM = 274;
// Tinggi isi yang boleh dipakai: 274mm dikurangi 8mm sudut dekoratif kiri-bawah
// (agar footer tidak pernah tertimpa sudut emas saat slip penuh).
export const FIT_H_MM = 266;

const SAFE_PX_FALLBACK = 1035;

/** Format font-size yang dipakai: [kolom, fsMaks, fsMin] — dicoba berurutan. */
const FIT_PLAN = [
  { cols: 1, max: 12.5, min: 8.5 },
  { cols: 2, max: 10, min: 6.5 },
  { cols: 3, max: 8, min: 4.5 },
  { cols: 4, max: 6, min: 2 }
];

function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || 'B')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
}

function orderCard(title, iconName, rows, cols) {
  if (!rows.length) return '';
  const per = Math.ceil(rows.length / cols);
  const chunks = [];
  for (let i = 0; i < rows.length; i += per) chunks.push(rows.slice(i, i + per));
  const table = (chunk) => `
    <table class="sg-table">
      <colgroup><col class="c-no"><col class="c-nm"><col class="c-jn"><col class="c-qt"><col class="c-hg"><col class="c-tt"></colgroup>
      <thead><tr><th>No</th><th>Nama Order</th><th>Jenis</th><th>Jumlah</th><th>Harga Borongan</th><th>Total</th></tr></thead>
      <tbody>${chunk.map((r) => `<tr><td class="n">${r.no}</td><td class="nm">${escapeHtml(r.nama)}</td><td>${escapeHtml(r.jenis)}</td><td class="n">${qtyId(r.jumlah)}</td><td class="n">${rupiah(r.harga)}</td><td class="n b">${rupiah(r.total)}</td></tr>`).join('')}</tbody>
    </table>`;
  return `
    <section class="sg-card">
      <div class="sg-card__h">${icon(iconName, 16)}<span>${escapeHtml(title)}</span></div>
      <div class="sg-multi sg-multi--${chunks.length}">${chunks.map(table).join('')}</div>
    </section>`;
}

/**
 * @param {object} model  hasil buildSlipModel
 * @param {object} o      {theme:'light'|'dark', cols, fs, logoSrc}
 */
export function slipHtml(model, { theme = 'light', cols = 1, fs = 12, logoSrc = '' } = {}) {
  const m = model;
  const logo = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="" />`
    : `<span class="sg-logo__ini">${escapeHtml(initials(m.company.name))}</span>`;
  const potVisible = m.potRows.filter((r, i) => i !== 1 || r.amount !== 0);

  return `
  <div class="sg sg--${theme}" style="--sg-fs:${fs}">
    <header class="sg-head">
      <div class="sg-brand">
        <div class="sg-logo">${logo}</div>
        <div class="sg-brand__t">
          <div class="sg-co">${escapeHtml(m.company.name)}</div>
          ${m.company.tagline1 ? `<div class="sg-tag">${escapeHtml(m.company.tagline1)}</div>` : ''}
          <div class="sg-tag">${escapeHtml(m.company.tagline2)}</div>
        </div>
      </div>
      <div class="sg-title">
        <div class="sg-title__t">SLIP GAJI</div>
        <span class="sg-badge">${escapeHtml(m.badge)}</span>
      </div>
    </header>

    <section class="sg-info">
      <div class="sg-info__c"><span class="sg-lbl">Periode</span><span class="sg-val">${escapeHtml(m.periodLabel)}</span></div>
      <div class="sg-info__c"><span class="sg-lbl">Nama Pekerja</span><span class="sg-val">${escapeHtml(m.employeeName)}</span></div>
      <div class="sg-info__c"><span class="sg-lbl">Status</span><span class="sg-chip ${m.status === 'Aktif' ? 'sg-chip--ok' : 'sg-chip--off'}">${escapeHtml(m.status)}</span></div>
      <div class="sg-info__c"><span class="sg-lbl">Tanggal Cetak</span><span class="sg-val">${escapeHtml(m.printedDate)}</span><span class="sg-sub">${escapeHtml(m.printedTime)}</span></div>
      <div class="sg-info__c"><span class="sg-lbl">Dibayarkan Oleh</span><span class="sg-val">${escapeHtml(m.payer || '-')}</span></div>
    </section>

    ${orderCard('Rincian Order Jahit', 'shirt', m.jahitRows, cols)}
    ${orderCard('Rincian Order Sablon', 'droplet', m.sablonRows, cols)}

    <section class="sg-two">
      <div class="sg-box">
        <div class="sg-card__h">${icon('wallet', 16)}<span>Rincian Penghasilan</span></div>
        <div class="sg-box__b">
          ${m.income.map((r) => `
          <div class="sg-row"><span class="sg-row__l">${escapeHtml(r.label)}</span><span class="sg-row__m">${escapeHtml([r.qty, r.rate].filter(Boolean).join(' '))}</span><span class="sg-row__r">${rupiah(r.amount)}</span></div>`).join('')}
        </div>
        <div class="sg-strip"><span>TOTAL PENGHASILAN</span><b>${rupiah(m.totalPenghasilan)}</b></div>
      </div>
      <div class="sg-box">
        <div class="sg-card__h">${icon('minus', 16)}<span>Rincian Potongan</span></div>
        <div class="sg-box__b">
          ${potVisible.map((r) => `
          <div class="sg-row"><span class="sg-row__l">${escapeHtml(r.label)}${r.entries.length ? `<small>${escapeHtml(r.entries.map((e) => e.keterangan).join(' · '))}</small>` : ''}</span><span class="sg-row__m"></span><span class="sg-row__r">${rupiah(r.amount)}</span></div>`).join('')}
        </div>
        <div class="sg-strip sg-strip--neg"><span>TOTAL POTONGAN</span><b>${rupiah(m.totalPotongan)}</b></div>
      </div>
    </section>

    <section class="sg-pay">
      <div class="sg-pay__main">
        <div class="sg-pay__lbl">GAJI YANG DIBAYARKAN</div>
        <div class="sg-pay__amt">${rupiah(m.net)}</div>
        <div class="sg-pay__terb"><span>Terbilang:</span> ${escapeHtml(m.terbilang)}</div>
      </div>
      <div class="sg-pay__coin">${icon('coins', 26)}</div>
    </section>

    <footer class="sg-foot">
      <div class="sg-notes">
        <div class="sg-lbl">Catatan</div>
        <ul>${m.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
      </div>
      <div class="sg-sign">
        <div class="sg-sign__d">${escapeHtml(m.signDate)}</div>
        <div class="sg-sign__cols">
          <div><div class="sg-sign__ln"></div><span>Admin</span></div>
          <div><div class="sg-sign__ln"></div><span>${escapeHtml(m.employeeName)}</span></div>
        </div>
      </div>
    </footer>
  </div>`;
}

// ---- Fit: cari font terbesar yang membuat slip muat 1 halaman A4 -------------
function availablePx() {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:-99999px;top:0;width:1px;height:${FIT_H_MM}mm;`;
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h > 100 ? h : SAFE_PX_FALLBACK;
}

/**
 * @returns {{fs:number, cols:number, fits:boolean, height:number, avail:number}}
 * Pengukuran dilakukan pada kontainer 190mm (lebar isi A4) yang sama dengan
 * preview dan area cetak, jadi hasilnya identik di ketiganya.
 */
export function fitSlip(model, { logoSrc = '' } = {}) {
  const avail = availablePx();
  const box = document.createElement('div');
  box.className = 'sg-measure';
  document.body.appendChild(box);
  const heightOf = (cols, fs) => {
    box.innerHTML = slipHtml(model, { theme: 'light', cols, fs, logoSrc });
    return box.firstElementChild.offsetHeight;
  };
  let result = null;
  try {
    for (const plan of FIT_PLAN) {
      if (heightOf(plan.cols, plan.min) > avail) {
        if (plan === FIT_PLAN[FIT_PLAN.length - 1]) {
          result = { fs: plan.min, cols: plan.cols, fits: false, height: heightOf(plan.cols, plan.min), avail };
        }
        continue;
      }
      let lo = plan.min, hi = plan.max;
      if (heightOf(plan.cols, hi) <= avail) lo = hi;
      else {
        for (let i = 0; i < 9; i++) {
          const mid = (lo + hi) / 2;
          if (heightOf(plan.cols, mid) <= avail) lo = mid; else hi = mid;
        }
      }
      const fs = Math.floor(lo * 20) / 20; // grid 0,05px (selalu <= nilai yang terbukti muat)
      result = { fs, cols: plan.cols, fits: true, height: heightOf(plan.cols, fs), avail };
      break;
    }
    if (!result) {
      // tidak mungkin mencapai sini (rencana terakhir selalu mengisi result), pengaman saja
      const last = FIT_PLAN[FIT_PLAN.length - 1];
      result = { fs: last.min, cols: last.cols, fits: false, height: heightOf(last.cols, last.min), avail };
    }
  } finally {
    box.remove();
  }
  return result;
}

// ---- Host cetak --------------------------------------------------------------
const HOST_ID = 'slip-print-host';

export function mountPrintHost(model, fit, logoSrc = '') {
  unmountPrintHost();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = `<div class="sg-sheet sg-sheet--light">${slipHtml(model, { theme: 'light', cols: fit.cols, fs: fit.fs, logoSrc })}</div>`;
  document.body.appendChild(host);
  document.body.classList.add('has-slip-print');
}

export function unmountPrintHost() {
  const old = document.getElementById(HOST_ID);
  if (old) old.remove();
  document.body.classList.remove('has-slip-print');
}

export function hasPrintHost() { return Boolean(document.getElementById(HOST_ID)); }

// ---- Preview -----------------------------------------------------------------
/** Isi `el` dengan kertas A4 ber-skala berisi slip. Kembalikan fungsi layout(). */
export function mountPreview(el, model, fit, theme, logoSrc = '') {
  el.innerHTML = `
    <div class="sg-stage">
      <div class="sg-paperwrap">
        <div class="sg-paper sg-paper--${theme}">
          <div class="sg-sheet sg-sheet--${theme}">${slipHtml(model, { theme, cols: fit.cols, fs: fit.fs, logoSrc })}</div>
        </div>
      </div>
    </div>`;
  const wrap = el.querySelector('.sg-paperwrap');
  const paper = el.querySelector('.sg-paper');
  const layout = () => {
    const natural = paper.offsetWidth; // 210mm dalam px
    const w = el.clientWidth || natural;
    const s = Math.min(1, w / natural);
    paper.style.transform = `scale(${s})`;
    wrap.style.width = `${Math.round(natural * s)}px`;
    wrap.style.height = `${Math.round(paper.offsetHeight * s)}px`;
  };
  layout();
  return layout;
}

export function setPreviewTheme(el, theme) {
  const other = theme === 'dark' ? 'light' : 'dark';
  el.querySelectorAll('.sg, .sg-sheet, .sg-paper').forEach((n) => {
    n.className = n.className.replace(new RegExp(`(sg|sg-sheet|sg-paper)--${other}`), `$1--${theme}`);
  });
}
