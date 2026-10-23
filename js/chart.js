// ============================================================================
// Minimal inline-SVG line/area chart — no charting library. Good enough for
// a small monthly trend on the Dashboard; reads CSS custom properties so it
// restyles automatically with the theme toggle.
// ============================================================================
import { escapeHtml, formatCurrency } from './ui.js';

/**
 * @param {{label:string, value:number}[]} points
 * @param {{width?:number, height?:number, colorVar?:string}} opts
 */
export function lineAreaChart(points, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 200;
  const padL = 8, padR = 8, padT = 16, padB = 28;
  const colorVar = opts.colorVar || '--color-primary';

  if (!points || points.length < 2) {
    return `<div class="notice notice-info">Data belum cukup untuk menampilkan grafik tren (minimal 2 periode).</div>`;
  }

  const values = points.map((p) => Number(p.value) || 0);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const coords = points.map((p, i) => {
    const x = padL + (i / (points.length - 1)) * innerW;
    const y = padT + innerH - ((Number(p.value) - min) / range) * innerH;
    return { x, y, ...p };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const zeroY = padT + innerH - ((0 - min) / range) * innerH;
  const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} L${coords[0].x.toFixed(1)},${zeroY.toFixed(1)} Z`;

  const dots = coords.map((c) => `
    <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.2" fill="var(${colorVar})" stroke="var(--color-surface)" stroke-width="1.5">
      <title>${escapeHtml(c.label)}: ${formatCurrency(c.value)}</title>
    </circle>`).join('');

  const labels = coords.map((c) => `<text x="${c.x.toFixed(1)}" y="${height - 8}" font-size="10" text-anchor="middle" fill="var(--color-text-low)">${escapeHtml(c.label)}</text>`).join('');
  const zeroLine = min < 0 && max > 0 ? `<line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${width - padR}" y2="${zeroY.toFixed(1)}" stroke="var(--color-border-strong)" stroke-dasharray="3,3" />` : '';

  return `
    <div class="chart-svg-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Grafik tren Hasil Bulan">
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(${colorVar})" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(${colorVar})" stop-opacity="0" />
          </linearGradient>
        </defs>
        ${zeroLine}
        <path d="${areaPath}" fill="url(#areaFill)" stroke="none" />
        <path d="${linePath}" fill="none" stroke="var(${colorVar})" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
        ${labels}
      </svg>
    </div>
  `;
}

// ============================================================================
// Dashboard charts (Tren Omzet + Komposisi Pengeluaran) — inline SVG, tanpa
// library. Semua warna lewat class CSS (token tema), jadi Dark/Light otomatis.
// ============================================================================
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function shortMonthLabel(year, month) {
  return `${SHORT_MONTHS[(Number(month) || 1) - 1]} ${String(year).slice(2)}`;
}

/** 1.250.000 -> "1,25 jt", 500.000 -> "500 rb". */
export function compactRupiah(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  const f = (x) => String(Number(x.toFixed(2))).replace('.', ',');
  if (a >= 1e9) return `${f(n / 1e9)} M`;
  if (a >= 1e6) return `${f(n / 1e6)} jt`;
  if (a >= 1e3) return `${f(n / 1e3)} rb`;
  return String(Math.round(n));
}

function niceCeil(v) {
  if (!(v > 0)) return 4;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  const n = [1, 2, 3, 4, 6, 8, 10].find((x) => f <= x + 1e-9);
  return n * e;
}

/**
 * Multi-series line chart.
 * @param {{label:string}[]} points   x-axis items (oldest -> newest)
 * @param {{key:string, values:number[], cls:string, width?:number}[]} series
 * @param {{width:number, height?:number}} opts
 * @returns {{svg:string, xs:number[], padT:number, innerH:number}}
 */
export function multiLineChart(points, series, opts = {}) {
  const width = Math.max(260, Math.round(opts.width || 600));
  const height = opts.height || 250;
  const padL = 46, padR = 14, padT = 12, padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = points.length;
  const maxVal = Math.max(0, ...series.flatMap((s) => s.values.map((v) => Number(v) || 0)));
  const top = niceCeil(maxVal);
  const y = (v) => padT + innerH - ((Number(v) || 0) / top) * innerH;
  const xs = points.map((_, i) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW));

  const grid = [0, 1, 2, 3, 4].map((i) => {
    const val = (top / 4) * i;
    const yy = y(val);
    return `<line class="tc-grid${i === 0 ? ' tc-grid--base' : ''}" x1="${padL}" y1="${yy.toFixed(1)}" x2="${width - padR}" y2="${yy.toFixed(1)}"/>` +
      `<text class="tc-ylabel" x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end">${compactRupiah(val)}</text>`;
  }).join('');
  const xlabels = points.map((p, i) => `<text class="tc-xlabel" x="${xs[i].toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHtml(p.label)}</text>`).join('');

  const lines = series.map((s) => {
    const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = s.area
      ? `<path class="tc-area ${s.cls}" d="${d} L${xs[n - 1].toFixed(1)},${y(0).toFixed(1)} L${xs[0].toFixed(1)},${y(0).toFixed(1)} Z"/>`
      : '';
    const dots = s.values.map((v, i) => `<circle class="tc-dot ${s.cls}" data-i="${i}" cx="${xs[i].toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === n - 1 ? 4.5 : 3.2}"/>`).join('');
    return `${area}<path class="tc-line ${s.cls}" d="${d}"/>${dots}`;
  }).join('');

  const svg = `<svg class="tc-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false">
    ${grid}
    <line class="tc-guide" x1="0" y1="${padT}" x2="0" y2="${padT + innerH}" style="display:none"/>
    ${lines}
    ${xlabels}
  </svg>`;
  return { svg, xs, padT, innerH, width, height };
}

/**
 * Donut chart. slices: [{value, cls}] (value >= 0). Returns an SVG string with
 * the center text slot filled by the caller-provided label/value.
 */
export function donutChart(slices, { size = 176, stroke = 24, centerLabel = '', centerValue = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const total = slices.reduce((s, x) => s + (Number(x.value) || 0), 0);
  let offset = 0;
  const live = slices.filter((x) => Number(x.value) > 0);
  const gap = live.length > 1 ? 2.5 : 0;
  const arcs = total > 0 ? slices.map((s, i) => {
    const v = Number(s.value) || 0;
    if (!(v > 0)) return '';
    const len = (v / total) * circ;
    const seg = Math.max(0.01, len - gap);
    const el = `<circle class="dn-seg ${s.cls}" data-i="${i}" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${seg.toFixed(2)} ${(circ - seg).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})"><title>${escapeHtml(s.title || '')}</title></circle>`;
    offset += len;
    return el;
  }).join('') : '';
  const valueLen = String(centerValue).length;
  const vSize = valueLen > 13 ? 12 : (valueLen > 11 ? 13 : 15);
  return `<svg class="dn-svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeHtml(centerLabel)} ${escapeHtml(centerValue)}">
    <circle class="dn-track" cx="${c}" cy="${c}" r="${r}" fill="none" stroke-width="${stroke}"/>
    ${arcs}
    <text class="dn-center-label" x="${c}" y="${c - 6}" text-anchor="middle">${escapeHtml(centerLabel)}</text>
    <text class="dn-center-value" x="${c}" y="${c + 14}" text-anchor="middle" style="font-size:${vSize}px">${escapeHtml(centerValue)}</text>
  </svg>`;
}
