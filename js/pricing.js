// ============================================================================
// CLIENT-SIDE PREVIEW ONLY. Mirrors BUILD-SPEC.md formulas so the UI can
// show a live "what will this cost" hint while a form is being filled in.
// The server always recomputes and snapshots harga/total on save — these
// helpers are never sent to the backend and never treated as final.
//
//   TOTAL (Jahit)  = JUMLAH x HARGA
//   HARGA (Sablon) = HARGA_DASAR(price_group) + (JUMLAH_WARNA-1) x TAMBAHAN_PER_WARNA(price_group)
//   TOTAL (Sablon) = JUMLAH x HARGA
//   Borongan Jahit/Sablon: identical formulas, but the matching price_rules
//   row always has price_group_id = null (global, no per-owner/per-worker
//   override) per BUILD-SPEC section "Formulas".
// ============================================================================
import { PRICE_CATEGORY } from './config.js';

/** Find the owner's price_group_id from lookups.owners. */
export function ownerPriceGroupId(lookups, ownerId) {
  const owner = (lookups?.owners || []).find((o) => o.id === ownerId || o.code === ownerId);
  return owner ? owner.price_group_id : null;
}

/** Locate the matching price_rules row for a category/ref/price_group. */
export function findPriceRule(lookups, { category, refId, priceGroupId }) {
  const rules = lookups?.priceRules || [];
  const isGlobal = category === PRICE_CATEGORY.JAHIT_BORONGAN || category === PRICE_CATEGORY.SABLON_BORONGAN;
  return rules.find((r) => {
    if (r.category !== category) return false;
    if (r.ref_id !== refId) return false;
    if (isGlobal) return r.price_group_id === null || r.price_group_id === undefined || r.price_group_id === '';
    return r.price_group_id === priceGroupId;
  }) || null;
}

/** Jahit (jual & borongan): TOTAL = JUMLAH x HARGA */
export function previewJahit({ lookups, category, refId, priceGroupId, jumlah }) {
  const rule = findPriceRule(lookups, { category, refId, priceGroupId });
  if (!rule) return { harga: null, total: null, rule: null };
  const harga = Number(rule.base_price) || 0;
  const total = harga * (Number(jumlah) || 0);
  return { harga, total, rule };
}

/** Sablon (jual & borongan): HARGA = DASAR + (WARNA-1) x TAMBAHAN */
export function previewSablon({ lookups, category, refId, priceGroupId, jumlahWarna, jumlah }) {
  const rule = findPriceRule(lookups, { category, refId, priceGroupId });
  if (!rule) return { harga: null, total: null, rule: null };
  const dasar = Number(rule.base_price) || 0;
  const tambahan = Number(rule.increment_price) || 0;
  const warna = Math.max(1, Number(jumlahWarna) || 1);
  const harga = dasar + (warna - 1) * tambahan;
  const total = harga * (Number(jumlah) || 0);
  return { harga, total, rule };
}

/** Gaji Harian: (HARI_BIASA x TARIF_HARIAN) + (HARI_MINGGU x TARIF_MINGGU) */
export function previewGajiHarian({ hariBiasa, tarifHarian, hariMinggu, tarifMinggu }) {
  return (Number(hariBiasa) || 0) * (Number(tarifHarian) || 0) + (Number(hariMinggu) || 0) * (Number(tarifMinggu) || 0);
}

/** Lembur: JAM x TARIF */
export function previewLembur({ jam, tarif }) {
  return (Number(jam) || 0) * (Number(tarif) || 0);
}

/** TARIF_DIGUNAKAN = override pekerja jika ada, selain itu default global. */
export function resolveTarif(employee, field, globalDefault) {
  const custom = employee ? employee[field] : null;
  const hasOverride = custom !== null && custom !== undefined && custom !== '';
  return { value: hasOverride ? Number(custom) : Number(globalDefault) || 0, isCustom: hasOverride };
}
