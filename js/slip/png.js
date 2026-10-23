// ============================================================================
// Slip Gaji -> PNG (Canvas 2D). Memakai model yang SAMA dengan preview/PDF
// (buildSlipModel), jadi angka dan baris identik. Lebar logis 800px, dirender
// 2x (retina) agar tajam saat dikirim lewat WhatsApp; tinggi mengikuti jumlah
// baris order sehingga tidak pernah terpotong. Teks panjang dibungkus, tidak
// dipotong.
// ============================================================================
import { icon } from '../icons.js';
import { rupiah, qtyId, slipFileName } from './model.js';

const W = 800;
const PAD = 32;
const CW = W - PAD * 2;
const FONT_BODY = "Inter, 'Segoe UI', Roboto, Arial, sans-serif";
const FONT_DISP = "Manrope, Inter, 'Segoe UI', Roboto, Arial, sans-serif";
const MAX_AREA = 14e6;   // batas aman luas canvas (iOS Safari ~16,7 juta)
const MAX_SIDE = 16000;

const PAL = {
  light: { bg: '#ffffff', card: '#ffffff', tx: '#17140d', mu: '#6f6858', ln: '#e8e2d2', hd: '#fdf3d8', gd: '#f5b82e', gdtx: '#94650a', st: '#fdebb8', paybg: '#fff8e5', paybd: '#f0c75e', okfg: '#1e7a3a', okbg: '#d5f2da', offfg: '#8a2a22', offbg: '#fbe0e0', neg: '#b42318', negbg: '#fbe9e7', ongd: '#1a1405' },
  dark: { bg: '#0b0d10', card: '#11141a', tx: '#f5f5f2', mu: '#9aa0a6', ln: '#2a2d32', hd: '#17140d', gd: '#f5b82e', gdtx: '#f5b82e', st: '#2b2209', paybg: '#17130a', paybd: '#8a6a1e', okfg: '#7be0a0', okbg: '#1f5c33', offfg: '#ff8a8a', offbg: '#3a1518', neg: '#ff8a8a', negbg: '#2a1517', ongd: '#1a1405' }
};

const font = (weight, size, fam = FONT_BODY, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px ${fam}`;

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

function setLS(ctx, px) { try { ctx.letterSpacing = `${px}px`; } catch (e) { /* tidak didukung */ } }

/** Pecah teks menjadi baris <= maxW (kata panjang dipecah per huruf). */
function wrap(ctx, text, maxW) {
  const out = [];
  const paras = String(text == null ? '' : text).split('\n');
  for (const para of paras) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = '';
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width <= maxW) { line = trial; continue; }
      if (line) { out.push(line); line = ''; }
      if (ctx.measureText(word).width <= maxW) { line = word; continue; }
      let chunk = '';
      for (const ch of word) {
        if (ctx.measureText(chunk + ch).width > maxW && chunk) { out.push(chunk); chunk = ch; } else chunk += ch;
      }
      line = chunk;
    }
    if (line) out.push(line);
  }
  return out.length ? out : [''];
}

/** Gambar teks; mengembalikan lebar. align: left|right|center. */
function txt(ctx, s, x, y, { size = 12, weight = 400, color = '#000', align = 'left', fam = FONT_BODY, italic = false, ls = 0 } = {}) {
  ctx.font = font(weight, size, fam, italic);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  setLS(ctx, ls);
  ctx.fillText(s, x, y);
  const w = ctx.measureText(s).width;
  setLS(ctx, 0);
  return w;
}

function measureW(ctx, s, size, weight = 400, fam = FONT_BODY, ls = 0, italic = false) {
  ctx.font = font(weight, size, fam, italic);
  setLS(ctx, ls);
  const w = ctx.measureText(s).width;
  setLS(ctx, 0);
  return w;
}

// ---- Gambar (ikon & logo) ----------------------------------------------------
function loadImage(src, cross = false) {
  return new Promise((resolve) => {
    const img = new Image();
    if (cross) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img.naturalWidth ? img : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function iconImage(name, color) {
  const svg = icon(name, 96).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace(/currentColor/g, color);
  return loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
}

async function loadLogo(sources) {
  for (const s of sources) {
    if (!s) continue;
    const img = await loadImage(s, !String(s).startsWith('data:'));
    if (img) return img;
  }
  return null;
}

// ---- Lukis -------------------------------------------------------------------
function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  return ((w[0] || 'B')[0] + (w[1] ? w[1][0] : '')).toUpperCase();
}

function rowMetrics(ctx, r, w) {
  const amtW = measureW(ctx, r.amt, 12.5, 800);
  const midW = r.mid ? measureW(ctx, r.mid, 11, 400) : 0;
  const labelW = Math.max(60, w - 28 - amtW - (midW ? midW + 12 : 0) - 12);
  ctx.font = font(600, 12.5);
  const lines = wrap(ctx, r.label, labelW);
  ctx.font = font(400, 10.5);
  const subLines = r.sub ? wrap(ctx, r.sub, labelW) : [];
  return { amtW, midW, lines, subLines, h: lines.length * 17 + subLines.length * 14 + 14 };
}

function paint(ctx, m, theme, imgs) {
  const P = PAL[theme] || PAL.light;
  let y = 0;

  // latar
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, 200000); // kanvas nyata dipotong sesuai tinggi

  // ---- Header
  y = PAD;
  const LOGO = 58;
  ctx.save();
  rr(ctx, PAD, y, LOGO, LOGO, 12);
  ctx.clip();
  if (imgs.logo) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(PAD, y, LOGO, LOGO);
    const k = Math.min(LOGO / imgs.logo.width, LOGO / imgs.logo.height);
    const lw = imgs.logo.width * k, lh = imgs.logo.height * k;
    ctx.drawImage(imgs.logo, PAD + (LOGO - lw) / 2, y + (LOGO - lh) / 2, lw, lh);
  } else {
    ctx.fillStyle = P.gd;
    ctx.fillRect(PAD, y, LOGO, LOGO);
    txt(ctx, initials(m.company.name), PAD + LOGO / 2, y + LOGO / 2 + 8, { size: 22, weight: 800, color: P.ongd, align: 'center', fam: FONT_DISP });
  }
  ctx.restore();
  rr(ctx, PAD, y, LOGO, LOGO, 12);
  ctx.strokeStyle = P.ln; ctx.lineWidth = 1; ctx.stroke();

  const tx0 = PAD + LOGO + 16;
  const titleW = Math.max(measureW(ctx, 'SLIP GAJI', 26, 800, FONT_DISP, 1.2), 120);
  const coMax = W - PAD - titleW - 16 - tx0;
  ctx.font = font(800, 24, FONT_DISP);
  const coLines = wrap(ctx, m.company.name, coMax);
  let ty = y + 22;
  coLines.forEach((ln) => { txt(ctx, ln, tx0, ty, { size: 24, weight: 800, color: P.tx, fam: FONT_DISP }); ty += 27; });
  ty -= 27;
  if (m.company.tagline1) { ty += 18; txt(ctx, m.company.tagline1, tx0, ty, { size: 10.5, weight: 700, color: P.gdtx, ls: 1.6 }); }
  ty += 15; txt(ctx, m.company.tagline2, tx0, ty, { size: 10.5, weight: 700, color: P.mu, ls: 1.6 });

  txt(ctx, 'SLIP GAJI', W - PAD, y + 26, { size: 26, weight: 800, color: P.tx, align: 'right', fam: FONT_DISP, ls: 1.2 });
  const bw = measureW(ctx, m.badge, 11, 800, FONT_BODY, 1.8) + 30;
  ctx.fillStyle = P.gd;
  rr(ctx, W - PAD - bw, y + 36, bw, 24, 12); ctx.fill();
  txt(ctx, m.badge, W - PAD - bw / 2 + 0.9, y + 52, { size: 11, weight: 800, color: P.ongd, align: 'center', ls: 1.8 });

  y = Math.max(y + LOGO, ty + 6, y + 62) + 14;
  ctx.fillStyle = P.gd; ctx.fillRect(PAD, y, CW, 2.5);
  y += 2.5 + 16;

  // ---- Info
  const cells = [
    { k: 'PERIODE', v: m.periodLabel, f: 1.15 },
    { k: 'NAMA PEKERJA', v: m.employeeName, f: 1.6 },
    { k: 'STATUS', v: m.status, f: 0.8, chip: true },
    { k: 'TANGGAL CETAK', v: m.printedDate, sub: m.printedTime, f: 1.05 },
    { k: 'DIBAYARKAN OLEH', v: m.payer || '-', f: 1.2 }
  ];
  const fsum = cells.reduce((s, c) => s + c.f, 0);
  let cx = PAD;
  cells.forEach((c) => { c.w = CW * c.f / fsum; c.x = cx; cx += c.w; });
  let infoH = 0;
  cells.forEach((c) => {
    ctx.font = font(800, 13);
    c.lines = c.chip ? [c.v] : wrap(ctx, c.v, c.w - 24);
    c.h = 16 + 16 + c.lines.length * 17 + (c.sub ? 15 : 0) + 12;
    infoH = Math.max(infoH, c.h);
  });
  ctx.fillStyle = P.card; rr(ctx, PAD, y, CW, infoH, 10); ctx.fill();
  ctx.strokeStyle = P.ln; ctx.lineWidth = 1; ctx.stroke();
  cells.forEach((c, i) => {
    if (i > 0) { ctx.fillStyle = P.ln; ctx.fillRect(c.x, y, 1, infoH); }
    txt(ctx, c.k, c.x + 12, y + 20, { size: 9, weight: 700, color: P.mu, ls: 1 });
    if (c.chip) {
      const on = m.status === 'Aktif';
      const cw = measureW(ctx, c.v, 12, 700) + 22;
      ctx.fillStyle = on ? P.okbg : P.offbg; rr(ctx, c.x + 12, y + 28, cw, 22, 11); ctx.fill();
      txt(ctx, c.v, c.x + 12 + cw / 2, y + 43, { size: 12, weight: 700, color: on ? P.okfg : P.offfg, align: 'center' });
    } else {
      c.lines.forEach((ln, li) => txt(ctx, ln, c.x + 12, y + 40 + li * 17, { size: 13, weight: 800, color: P.tx }));
      if (c.sub) txt(ctx, c.sub, c.x + 12, y + 40 + c.lines.length * 17 + 1, { size: 10.5, weight: 400, color: P.mu });
    }
  });
  y += infoH + 16;

  // ---- Kartu header generik
  const cardHeader = (x, yy, w, title, iconKey) => {
    ctx.fillStyle = P.hd; ctx.fillRect(x, yy, w, 34);
    ctx.fillStyle = P.ln; ctx.fillRect(x, yy + 34, w, 1);
    if (imgs[iconKey]) ctx.drawImage(imgs[iconKey], x + 14, yy + 9, 16, 16);
    txt(ctx, title, x + 38, yy + 22, { size: 11, weight: 800, color: P.tx, ls: 1.3 });
  };

  // ---- Tabel order
  const COL = { no: 44, jenis: 134, qty: 70, harga: 120, total: 132 };
  COL.nama = CW - COL.no - COL.jenis - COL.qty - COL.harga - COL.total;
  // Banyak baris (>40) -> baris dirapatkan supaya PNG tidak terlalu panjang.
  const dense = (m.jahitRows.length + m.sablonRows.length) > 40;
  const LH = dense ? 15 : 17, PADV = dense ? 9 : 16;
  const orderCard = (title, iconKey, rows) => {
    if (!rows.length) return;
    // ukur baris
    const metrics = rows.map((r) => {
      ctx.font = font(700, 12.5); const nm = wrap(ctx, r.nama, COL.nama - 20);
      ctx.font = font(400, 12); const jn = wrap(ctx, r.jenis, COL.jenis - 16);
      return { nm, jn, h: Math.max(nm.length, jn.length) * LH + PADV };
    });
    const bodyH = metrics.reduce((s, r) => s + r.h, 0);
    const H = 34 + 1 + 28 + bodyH;
    ctx.fillStyle = P.card; rr(ctx, PAD, y, CW, H, 10); ctx.fill();
    ctx.save(); rr(ctx, PAD, y, CW, H, 10); ctx.clip();
    cardHeader(PAD, y, CW, title, iconKey);
    let yy = y + 35;
    // judul kolom
    const xs = { no: PAD, nama: PAD + COL.no, jenis: PAD + COL.no + COL.nama, qty: PAD + COL.no + COL.nama + COL.jenis };
    xs.harga = xs.qty + COL.qty; xs.total = xs.harga + COL.harga;
    const hy = yy + 18;
    txt(ctx, 'NO', xs.no + 14, hy, { size: 9, weight: 700, color: P.mu, ls: 1 });
    txt(ctx, 'NAMA ORDER', xs.nama + 4, hy, { size: 9, weight: 700, color: P.mu, ls: 1 });
    txt(ctx, 'JENIS', xs.jenis + 8, hy, { size: 9, weight: 700, color: P.mu, ls: 1 });
    txt(ctx, 'JUMLAH', xs.qty + COL.qty - 10, hy, { size: 9, weight: 700, color: P.mu, ls: 1, align: 'right' });
    txt(ctx, 'HARGA BORONGAN', xs.harga + COL.harga - 10, hy, { size: 9, weight: 700, color: P.mu, ls: 1, align: 'right' });
    txt(ctx, 'TOTAL', xs.total + COL.total - 14, hy, { size: 9, weight: 700, color: P.mu, ls: 1, align: 'right' });
    yy += 28;
    ctx.fillStyle = P.ln; ctx.fillRect(PAD, yy - 1, CW, 1);
    rows.forEach((r, i) => {
      const mt = metrics[i];
      const by = yy + PADV / 2 + 12.5 - (dense ? 1 : 0); // baseline baris pertama
      txt(ctx, String(r.no), xs.no + 14, by, { size: 12, weight: 400, color: P.mu });
      mt.nm.forEach((ln, li) => txt(ctx, ln, xs.nama + 4, by + li * LH, { size: 12.5, weight: 700, color: P.tx }));
      mt.jn.forEach((ln, li) => txt(ctx, ln, xs.jenis + 8, by + li * LH, { size: 12, weight: 400, color: P.tx }));
      txt(ctx, qtyId(r.jumlah), xs.qty + COL.qty - 10, by, { size: 12.5, weight: 400, color: P.tx, align: 'right' });
      txt(ctx, rupiah(r.harga), xs.harga + COL.harga - 10, by, { size: 12.5, weight: 400, color: P.tx, align: 'right' });
      txt(ctx, rupiah(r.total), xs.total + COL.total - 14, by, { size: 12.5, weight: 800, color: P.tx, align: 'right' });
      yy += mt.h;
      if (i < rows.length - 1) { ctx.fillStyle = P.ln; ctx.fillRect(PAD, yy - 0.5, CW, 1); }
    });
    ctx.restore();
    rr(ctx, PAD, y, CW, H, 10); ctx.strokeStyle = P.ln; ctx.lineWidth = 1; ctx.stroke();
    y += H + 16;
  };
  orderCard('RINCIAN ORDER JAHIT', 'shirt', m.jahitRows);
  orderCard('RINCIAN ORDER SABLON', 'droplet', m.sablonRows);

  // ---- Dua kotak: penghasilan | potongan
  const BW = (CW - 14) / 2;
  const incomeRows = m.income.map((r) => ({ label: r.label, mid: [r.qty, r.rate].filter(Boolean).join(' '), amt: rupiah(r.amount) }));
  const potRows = m.potRows.filter((r, i) => i !== 1 || r.amount !== 0)
    .map((r) => ({ label: r.label, sub: r.entries.map((e) => e.keterangan).join(' · '), mid: '', amt: rupiah(r.amount) }));
  const bodyOf = (rows) => rows.map((r) => rowMetrics(ctx, r, BW));
  const mi = bodyOf(incomeRows), mp = bodyOf(potRows);
  const bodyH = Math.max(mi.reduce((s, r) => s + r.h, 0), mp.reduce((s, r) => s + r.h, 0)) + 8;
  const STRIP = 42;
  const boxH = 35 + bodyH + STRIP;
  const drawBox = (x, title, iconKey, rows, mets, stripLabel, stripVal, neg) => {
    ctx.fillStyle = P.card; rr(ctx, x, y, BW, boxH, 10); ctx.fill();
    ctx.save(); rr(ctx, x, y, BW, boxH, 10); ctx.clip();
    cardHeader(x, y, BW, title, iconKey);
    let yy = y + 35 + 4;
    rows.forEach((r, i) => {
      const mt = mets[i];
      const by = yy + 7 + 12.5;
      mt.lines.forEach((ln, li) => txt(ctx, ln, x + 14, by + li * 17, { size: 12.5, weight: 600, color: P.tx }));
      mt.subLines.forEach((ln, li) => txt(ctx, ln, x + 14, by + mt.lines.length * 17 - 2 + li * 14 + 2, { size: 10.5, weight: 400, color: P.mu }));
      txt(ctx, r.amt, x + BW - 14, by, { size: 12.5, weight: 800, color: P.tx, align: 'right' });
      if (r.mid) txt(ctx, r.mid, x + BW - 14 - mt.amtW - 12, by, { size: 11, weight: 400, color: P.mu, align: 'right' });
      yy += mt.h;
      if (i < rows.length - 1) {
        ctx.strokeStyle = P.ln; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x + 14, yy); ctx.lineTo(x + BW - 14, yy); ctx.stroke(); ctx.setLineDash([]);
      }
    });
    ctx.fillStyle = neg ? P.negbg : P.st; ctx.fillRect(x, y + boxH - STRIP, BW, STRIP);
    txt(ctx, stripLabel, x + 14, y + boxH - STRIP / 2 + 4, { size: 10.5, weight: 800, color: P.tx, ls: 0.8 });
    txt(ctx, stripVal, x + BW - 14, y + boxH - STRIP / 2 + 6, { size: 16, weight: 800, color: neg ? P.neg : P.tx, align: 'right' });
    ctx.restore();
    rr(ctx, x, y, BW, boxH, 10); ctx.strokeStyle = P.ln; ctx.lineWidth = 1; ctx.stroke();
  };
  drawBox(PAD, 'RINCIAN PENGHASILAN', 'wallet', incomeRows, mi, 'TOTAL PENGHASILAN', rupiah(m.totalPenghasilan), false);
  drawBox(PAD + BW + 14, 'RINCIAN POTONGAN', 'minus', potRows, mp, 'TOTAL POTONGAN', rupiah(m.totalPotongan), true);
  y += boxH + 16;

  // ---- Gaji dibayarkan
  const COIN = 64;
  const payTextW = CW - 40 - COIN - 20;
  ctx.font = font(400, 12.5);
  const terbFull = `Terbilang: ${m.terbilang}`;
  const tl = wrap(ctx, terbFull, payTextW);
  const payH = 22 + 14 + 8 + 48 + 8 + tl.length * 18 + 20;
  ctx.fillStyle = P.paybg; rr(ctx, PAD, y, CW, payH, 16); ctx.fill();
  ctx.strokeStyle = P.paybd; ctx.lineWidth = 2; ctx.stroke();
  let py = y + 22 + 6;
  txt(ctx, 'GAJI YANG DIBAYARKAN', PAD + 20, py, { size: 11, weight: 800, color: P.gdtx, ls: 2.2 });
  py += 8 + 40;
  txt(ctx, rupiah(m.net), PAD + 20, py, { size: 38, weight: 800, color: P.tx, fam: FONT_DISP });
  py += 8 + 14;
  tl.forEach((ln, li) => {
    if (li === 0 && ln.startsWith('Terbilang:')) {
      const pw = txt(ctx, 'Terbilang:', PAD + 20, py, { size: 12.5, weight: 800, italic: true, color: P.tx });
      txt(ctx, ln.slice('Terbilang:'.length), PAD + 20 + pw, py, { size: 12.5, weight: 400, color: P.mu });
    } else txt(ctx, ln, PAD + 20, py, { size: 12.5, weight: 400, color: P.mu });
    py += 18;
  });
  const coinX = PAD + CW - 20 - COIN / 2, coinY = y + payH / 2;
  ctx.fillStyle = P.gd; ctx.beginPath(); ctx.arc(coinX, coinY, COIN / 2, 0, Math.PI * 2); ctx.fill();
  if (imgs.coinsDark) ctx.drawImage(imgs.coinsDark, coinX - 17, coinY - 17, 34, 34);
  y += payH + 22;

  // ---- Footer: catatan | tanda tangan
  const half = CW / 2 - 10;
  ctx.font = font(400, 11);
  const noteLines = m.notes.map((n) => wrap(ctx, n, half - 16));
  const notesH = 16 + noteLines.reduce((s, l) => s + l.length * 15 + 3, 0);
  const signH = 18 + 62 + 22;
  const footH = Math.max(notesH, signH);
  txt(ctx, 'CATATAN', PAD, y + 10, { size: 9, weight: 700, color: P.mu, ls: 1 });
  let ny = y + 28;
  noteLines.forEach((ls) => {
    ls.forEach((ln, li) => {
      if (li === 0) txt(ctx, '•', PAD + 2, ny, { size: 11, weight: 700, color: P.gdtx });
      txt(ctx, ln, PAD + 16, ny, { size: 11, weight: 400, color: P.mu });
      ny += 15;
    });
    ny += 3;
  });
  const sx = PAD + CW / 2 + 10;
  txt(ctx, m.signDate, sx + half / 2, y + 12, { size: 11.5, weight: 400, color: P.mu, align: 'center' });
  const colW = (half - 24) / 2;
  [['Admin', sx], [m.employeeName, sx + colW + 24]].forEach(([label, bx]) => {
    ctx.fillStyle = P.tx; ctx.fillRect(bx, y + 12 + 62, colW, 1);
    ctx.font = font(600, 11.5);
    const ls = wrap(ctx, label, colW);
    ls.forEach((ln, li) => txt(ctx, ln, bx + colW / 2, y + 12 + 62 + 16 + li * 14, { size: 11.5, weight: 600, color: P.tx, align: 'center' }));
  });
  const nameExtra = (() => { ctx.font = font(600, 11.5); return (wrap(ctx, m.employeeName, colW).length - 1) * 14; })();
  y += Math.max(footH, 12 + 62 + 16 + nameExtra + 8) + 24;

  // sudut emas kiri-bawah
  const H = y + 14;
  ctx.fillStyle = P.gd;
  ctx.beginPath(); ctx.moveTo(0, H - 40); ctx.lineTo(40, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
  return H;
}

/**
 * @param {object} model       buildSlipModel()
 * @param {object} o           {theme:'light'|'dark', logoSources:[dataUrl|url,...]}
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderSlipCanvas(model, { theme = 'light', logoSources = [] } = {}) {
  try {
    await Promise.all([
      document.fonts.load("800 24px Manrope"),
      document.fonts.load("700 13px Inter"),
      document.fonts.load("400 13px Inter"),
      document.fonts.load("italic 800 13px Inter")
    ]);
  } catch (e) { /* font cadangan sistem */ }
  const P = PAL[theme] || PAL.light;
  const [shirt, droplet, wallet, minus, coinsDark, logo] = await Promise.all([
    iconImage('shirt', P.gdtx), iconImage('droplet', P.gdtx), iconImage('wallet', P.gdtx), iconImage('minus', P.gdtx),
    iconImage('coins', P.ongd), loadLogo(logoSources)
  ]);
  const imgs = { shirt, droplet, wallet, minus, coinsDark, logo };

  // lintasan 1: ukur tinggi pada kanvas sementara
  const probe = document.createElement('canvas');
  probe.width = W; probe.height = 6000;
  const H = Math.ceil(paint(probe.getContext('2d'), model, theme, imgs));

  const scale = Math.max(1, Math.min(2, Math.sqrt(MAX_AREA / (W * H)), MAX_SIDE / H));
  const c = document.createElement('canvas');
  c.width = Math.round(W * scale);
  c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  paint(ctx, model, theme, imgs);
  c._logical = { w: W, h: H, scale };
  return c;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal membuat PNG'))), 'image/png');
  });
}

export async function downloadSlipPng(model, opts) {
  const canvas = await renderSlipCanvas(model, opts);
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = slipFileName(model, 'png');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { width: canvas.width, height: canvas.height, bytes: blob.size, name: a.download };
}
