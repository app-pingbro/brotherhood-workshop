// ============================================================================
// Branding: nama aplikasi + logo Brotherhood yang SAMA di header (sidebar), layar
// login, splash awal, dan favicon. Tidak ada aset logo baru — sumbernya satu:
// logo perusahaan yang diunggah di Master Data (Settings 'company_logo'), persis
// seperti yang dipakai Slip Gaji. Bila yang tersedia hanya URL Drive, dipakai URL
// itu; begitu data-URL logo (dipakai Slip Gaji, diunduh sekali & disimpan di
// localStorage) tersedia, itulah yang dipakai agar tajam dan instan tanpa jaringan.
// Cadangan bila belum ada logo sama sekali: tanda teks "BW" seperti sebelumnya.
// ============================================================================
import { getLookups, getCompanyLogoUrl } from './state.js';
import { logoRef, getCachedLogo, ensureLogo } from './slip/logo.js';

export const BRAND_NAME = 'BROTHERHOOD WORKSHOP MANAGEMENT';
const URL_KEY = 'bw_brand_url_v1';     // {url, id} — agar logo tampil sejak layar pertama (sebelum login / sebelum lookups)
const SLIP_KEY = 'bw_slip_logo_v1';    // cache data-URL milik slip/logo.js

const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

/** Sumber logo sebelum lookups termuat (layar login, splash, sidebar saat reload). */
export function preloadLogoSrc() {
  const b = lsGet(URL_KEY);
  if (!b || !b.url) return '';
  const s = lsGet(SLIP_KEY);
  return (s && s.id === b.id && s.dataUrl) ? s.dataUrl : b.url;
}

/** Sumber logo setelah lookups termuat (mengikuti logo terbaru). */
export function currentLogoSrc() {
  const ref = logoRef();
  if (!ref) return '';
  return getCachedLogo() || getCompanyLogoUrl() || '';
}

function lookupsLoaded() {
  const l = getLookups();
  return !!(l && Array.isArray(l.settings));
}

function rememberLogo() {
  try {
    const ref = logoRef();
    if (!ref) { localStorage.removeItem(URL_KEY); return; }
    const url = getCompanyLogoUrl();
    if (url) localStorage.setItem(URL_KEY, JSON.stringify({ url, id: `${ref.fileId}|${ref.updatedAt || ''}` }));
  } catch (e) { /* localStorage penuh/diblokir: abaikan */ }
}

/** Isi sebuah kotak logo: <img> (rasio asli, tidak dipotong) atau teks "BW". */
export function fillMark(el, src) {
  if (!el) return;
  if (!src) { el.classList.remove('has-logo'); el.textContent = 'BW'; return; }
  if (el.firstElementChild && el.firstElementChild.tagName === 'IMG' && el.firstElementChild.getAttribute('src') === src) return;
  el.classList.add('has-logo');
  el.textContent = '';
  const img = new Image();
  img.alt = 'Logo ' + BRAND_NAME;
  img.decoding = 'async';
  img.draggable = false;
  img.onerror = () => { el.classList.remove('has-logo'); el.textContent = 'BW'; };
  img.src = src;
  el.appendChild(img);
}

/** Favicon = logo yang sama, dipas ke kanvas persegi (tanpa gepeng). Cadangan: favicon bawaan. */
export function applyFavicon(src) {
  if (!src) return;
  const link = document.querySelector('link[rel~="icon"]');
  if (!link) return;
  const img = new Image();
  img.onload = () => {
    try {
      const S = 64, c = document.createElement('canvas'); c.width = S; c.height = S;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
      const k = Math.min(S / img.naturalWidth, S / img.naturalHeight);
      const w = img.naturalWidth * k, h = img.naturalHeight * k;
      g.drawImage(img, (S - w) / 2, (S - h) / 2, w, h);
      link.type = 'image/png'; link.href = c.toDataURL('image/png');
    } catch (e) { link.removeAttribute('type'); link.href = src; } // kanvas "tainted" (URL Drive): pakai URL langsung
  };
  img.onerror = () => { /* biarkan favicon bawaan */ };
  img.src = src;
}

/** Sinkronkan semua tempat logo. Dipanggil saat shell dibangun dan tiap lookups berubah. */
export function updateBrand(markEl) {
  const loaded = lookupsLoaded();
  const src = loaded ? currentLogoSrc() : preloadLogoSrc();
  fillMark(markEl, src);
  applyFavicon(src);
  if (loaded) {
    rememberLogo();
    if (logoRef() && !getCachedLogo()) {
      ensureLogo().then((d) => { if (d) { fillMark(markEl, currentLogoSrc()); applyFavicon(currentLogoSrc()); } }).catch(() => {});
    }
  }
}

/** Tutup splash awal (index.html). */
export function hideSplash() {
  const el = document.getElementById('boot-splash');
  if (!el) return;
  el.classList.add('is-out');
  setTimeout(() => el.remove(), 320);
}
