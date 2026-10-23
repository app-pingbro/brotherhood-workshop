// ============================================================================
// Logo perusahaan untuk Slip Gaji PNG.
// Logo disimpan di Drive (origin lain, tanpa header CORS) sehingga tidak bisa
// digambar ke <canvas> lalu diekspor. Backend menyediakan aksi baca-saja
// getLogoData (logo -> data URL). Hasilnya diperkecil (<=256px) dan disimpan di
// localStorage per fileId+updatedAt, jadi hanya diunduh sekali per logo.
// Semua kegagalan diam-diam: slip tetap jadi dengan inisial perusahaan.
// ============================================================================
import { getLookups } from '../state.js';
import { fetchData } from '../api.js';

const KEY = 'bw_slip_logo_v1';
const MAX_PX = 256;

export function logoRef() {
  const rows = getLookups() && getLookups().settings;
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r) => r.key === 'company_logo');
  if (!row || !row.value) return null;
  try {
    const ref = JSON.parse(row.value);
    return ref && ref.fileId ? ref : null;
  } catch (e) { return null; }
}

const idOf = (ref) => `${ref.fileId}|${ref.updatedAt || ''}`;

export function getCachedLogo() {
  const ref = logoRef();
  if (!ref) return '';
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && o.id === idOf(ref) && o.dataUrl) return o.dataUrl;
  } catch (e) { /* abaikan */ }
  return '';
}

function downscale(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const k = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/png'));
      } catch (e) { resolve(dataUrl.length < 300000 ? dataUrl : ''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

/** Data URL logo siap-canvas, atau '' bila tidak tersedia. */
export async function ensureLogo() {
  const ref = logoRef();
  if (!ref) return '';
  const hit = getCachedLogo();
  if (hit) return hit;
  try {
    const d = await fetchData('getLogoData', {}, { silent: true });
    if (d && d.dataUrl) {
      const small = await downscale(d.dataUrl);
      if (small) {
        try { localStorage.setItem(KEY, JSON.stringify({ id: idOf(ref), dataUrl: small })); } catch (e) { /* kuota */ }
        return small;
      }
    }
  } catch (e) { /* backend lama / jaringan: pakai cadangan */ }
  return '';
}
