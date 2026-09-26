<<<<<<< HEAD
// ============================================================================
// Shared application state — single source of truth for the logged-in
// session, the global period/owner filters in the top bar, and a tiny
// pub/sub so pages can react when those filters change (per spec: the
// month/period selector and owner filter live once, not duplicated per page).
// ============================================================================

const listeners = new Set();

const state = {
  token: null,
  user: null,          // {id, name, role}
  periods: [],          // from getLookups/getPeriods
  currentPeriodId: null,
  ownerFilter: 'ALL',   // 'ALL' | 'PINGBRO' | 'SUNRISE' | 'BROTHERHOOD'
  lookups: null         // cached getLookups() payload
};

export function getState() {
  return state;
}

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(key) {
  listeners.forEach((fn) => {
    try { fn(key, state); } catch (e) { console.error(e); }
  });
}

// ---- Auth/session -----------------------------------------------------
export function getToken() {
  if (state.token) return state.token;
  try {
    const raw = sessionStorage.getItem('bw_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      state.token = parsed.token;
      state.user = parsed.user;
      return state.token;
    }
  } catch (e) { /* sessionStorage unavailable */ }
  return null;
}

export function getUser() {
  if (!state.user) getToken();
  return state.user;
}

export function setSession(token, user) {
  state.token = token;
  state.user = user;
  try {
    sessionStorage.setItem('bw_session', JSON.stringify({ token, user }));
  } catch (e) { /* ignore quota/private-mode errors */ }
  emit('session');
}

export function clearSession() {
  state.token = null;
  state.user = null;
  try { sessionStorage.removeItem('bw_session'); } catch (e) { /* ignore */ }
  emit('session');
}

// ---- Global filters -----------------------------------------------------
export function setPeriods(periods) {
  state.periods = periods || [];
  if (!state.currentPeriodId && state.periods.length) {
    const open = state.periods.find((p) => (p.status || '').toLowerCase() === 'open');
    state.currentPeriodId = (open || state.periods[state.periods.length - 1]).id;
  }
  emit('periods');
}

export function getCurrentPeriod() {
  return state.periods.find((p) => p.id === state.currentPeriodId) || null;
}

export function setCurrentPeriodId(id) {
  state.currentPeriodId = id;
  emit('period');
}

export function setOwnerFilter(code) {
  state.ownerFilter = code;
  emit('owner');
}

export function getOwnerFilter() {
  return state.ownerFilter;
}

export function setLookups(lookups) {
  state.lookups = lookups;
  if (lookups && lookups.periods) setPeriods(lookups.periods);
  emit('lookups');
}

export function getLookups() {
  return state.lookups;
}
=======
// ============================================================
// STATE — status aplikasi di memori (Instant UX prinsip 1 & 3: SPA + cache client-side)
// Data master & dashboard disimpan di sini supaya berpindah menu TIDAK perlu ambil ulang ke server
// selama "epoch" belum berubah (epoch naik otomatis di server setiap ada transaksi baru).
// ============================================================

const S = {
  user: null,                // { userId, username, nama, role }
  master: null,              // hasil master.get / app.init (unit, pihak, pelanggan, karyawan, harga, dst.)
  epoch: -1,                 // epoch server terakhir diketahui — dipakai membatalkan cache halaman
  section: 'dashboard',
  unitFilter: '',            // '' = semua unit
  periodeMode: 'bulan',      // hari | minggu | bulan | rentang
  dari: '', sampai: '',
  theme: 'light',
  _cache: {},                // cache generik per-kunci: { data, epoch, waktu }
  _loadingCount: 0
};

const Cache = {
  /** Ambil dari cache bila epoch masih sama dengan server (data belum basi). null bila tidak ada / basi. */
  get(key) {
    const c = S._cache[key];
    if (!c) return null;
    if (c.epoch !== S.epoch) return null;
    return c.data;
  },
  set(key, data) { S._cache[key] = { data: data, epoch: S.epoch, waktu: Date.now() }; },
  invalidateAll() { S._cache = {}; },
  invalidatePrefix(prefix) { Object.keys(S._cache).forEach(k => { if (k.indexOf(prefix) === 0) delete S._cache[k]; }); },
  /** Batalkan beberapa prefix sekaligus — dipakai setelah simpan agar HANYA data yang benar-benar
   *  terdampak yang diambil ulang (Instant UX: bukan seluruh cache dibuang di setiap transaksi). */
  invalidateMany(prefixes) { prefixes.forEach(p => this.invalidatePrefix(p)); }
};

/** Preferensi ringan per-perangkat (BUKAN data transaksi) — aman disimpan di localStorage. */
const Pref = {
  get(k, def) { try { const v = localStorage.getItem('bw_pref_' + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem('bw_pref_' + k, JSON.stringify(v)); } catch (e) { /* abaikan (mode privat/kuota penuh) */ } }
};

function unitById(id) { return (S.master && S.master.units || []).filter(u => u.id === id)[0]; }
function karyawanById(id) { return (S.master && S.master.karyawan || []).filter(k => k.id === id)[0]; }
function isOwner() { return S.user && S.user.role === 'Owner'; }
>>>>>>> 5f42973feb501a493914b033fc6c15a9cc0baf2e
