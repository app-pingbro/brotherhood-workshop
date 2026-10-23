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
