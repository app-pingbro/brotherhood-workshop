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
