// ============================================================================
// Logo perusahaan untuk Slip Gaji PNG.
// Logo disimpan di Drive (origin lain, tanpa header CORS) sehingga tidak bisa
// digambar ke <canvas> lalu diekspor. Backend menyediakan aksi baca-saja
// getLogoData (logo -> data URL). Hasilnya diperkecil (<=256px) dan disimpan di
// localStorage per fileId+updatedAt, jadi hanya diunduh sekali per logo.
// Semua kegagalan diam-diam: slip tetap jadi dengan inisial perusahaan.
// ============================================================================
import { getLookups, getCompanyLogoUrl } from '../state.js';
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

let inflight = null;
let failedUntil = 0;

/** Data URL logo siap-canvas, atau '' bila tidak tersedia. Permintaan ganda
 * berbagi satu request; kegagalan diingat 2 menit (tidak menunggu ulang tiap klik). */
export function ensureLogo() {
  const ref = logoRef();
  if (!ref) return Promise.resolve('');
  const hit = getCachedLogo();
  if (hit) return Promise.resolve(hit);
  if (Date.now() < failedUntil) return Promise.resolve('');
  if (!inflight) {
    inflight = (async () => {
      let result = '';
      try {
        const d = await fetchData('getLogoData', {}, { silent: true });
        if (d && d.dataUrl) {
          const small = await downscale(d.dataUrl);
          if (small) {
            try { localStorage.setItem(KEY, JSON.stringify({ id: idOf(ref), dataUrl: small })); } catch (e) { /* kuota */ }
            result = small;
          }
        }
      } catch (e) { /* backend lama / jaringan: pakai cadangan */ }
      if (!result) failedUntil = Date.now() + 120000;
      return result;
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

/**
 * Sumber logo untuk PNG: data URL bila tersedia (instan, tanpa jaringan);
 * jika tidak, URL gambar jaringan sebagai cadangan. Menunggu getLogoData
 * paling lama `wait` ms agar klik tidak tertahan oleh server yang lambat.
 */
export async function logoSources({ wait = 4000 } = {}) {
  const ref = logoRef();
  if (!ref) return [];
  const ensured = await Promise.race([ensureLogo(), new Promise((r) => setTimeout(() => r(''), wait))]);
  if (ensured) return [ensured];
  const out = [`https://lh3.googleusercontent.com/d/${ref.fileId}=w512`];
  const stored = getCompanyLogoUrl();
  if (stored) out.push(stored);
  return out;
}
