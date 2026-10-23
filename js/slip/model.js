// ============================================================================
// Slip Gaji — SATU sumber data untuk preview layar, cetak PDF, dan PNG.
// Modul ini murni (tanpa DOM): menerima respons getSalarySlip + lookups lalu
// menghasilkan model siap-tampil. Total (gajiKotor, total potongan, gaji
// bersih) SELALU dibaca dari API — rincian di bawahnya hanya untuk tampilan,
// persis seperti SlipGaji.js sebelumnya, tidak pernah dihitung ulang sebagai
// angka otoritatif.
// ============================================================================

export const SLIP_CITY = 'Denpasar';
export const SLIP_NOTES = [
  'Slip gaji ini dibuat otomatis dari data order pada sistem.',
  'Jika ada perbedaan, segera hubungi admin.',
  'Terima kasih atas kerja kerasnya.'
];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const pad2 = (n) => String(n).padStart(2, '0');

/** "Rp1.234.567" — format Rupiah Indonesia (pemisah ribuan titik). */
export function rupiah(n) {
  return 'Rp' + Math.round(num(n)).toLocaleString('id-ID');
}
export function intId(n) { return Math.round(num(n)).toLocaleString('id-ID'); }
/** jumlah (bisa desimal, mis. 2,5 jam) tanpa nol berlebih */
export function qtyId(n) {
  const v = num(n);
  return Number.isInteger(v) ? v.toLocaleString('id-ID') : v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

// ---- Terbilang ---------------------------------------------------------------
const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function tiga(n) {
  if (n < 12) return SATUAN[n];
  if (n < 20) return SATUAN[n - 10] + ' belas';
  if (n < 100) return SATUAN[Math.floor(n / 10)] + ' puluh' + (n % 10 ? ' ' + SATUAN[n % 10] : '');
  if (n < 200) return 'seratus' + (n % 100 ? ' ' + tiga(n % 100) : '');
  return SATUAN[Math.floor(n / 100)] + ' ratus' + (n % 100 ? ' ' + tiga(n % 100) : '');
}
function kata(n) {
  if (n === 0) return 'nol';
  const scales = [[1e12, 'triliun'], [1e9, 'miliar'], [1e6, 'juta'], [1e3, 'ribu']];
  const out = [];
  let rest = n;
  for (const [s, name] of scales) {
    const q = Math.floor(rest / s);
    if (q > 0) {
      out.push(s === 1e3 && q === 1 ? 'seribu' : kata(q) + ' ' + name);
      rest -= q * s;
    }
  }
  if (rest > 0) out.push(tiga(rest));
  return out.join(' ');
}
/** 1124000 -> "Satu Juta Seratus Dua Puluh Empat Ribu Rupiah" */
export function terbilang(n) {
  const v = Math.round(num(n));
  const words = kata(Math.abs(v)).split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return (v < 0 ? 'Minus ' : '') + words + ' Rupiah';
}

// ---- Tanggal -----------------------------------------------------------------
export function tzLabel(date) {
  const off = -date.getTimezoneOffset();
  if (off === 420) return 'WIB';
  if (off === 480) return 'WITA';
  if (off === 540) return 'WIT';
  const h = Math.floor(Math.abs(off) / 60);
  return `GMT${off >= 0 ? '+' : '-'}${h}`;
}
export function dateLong(d) { return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; }
export function dateShort(d) { return `${pad2(d.getDate())} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; }
export function timeLabel(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())} ${tzLabel(d)}`; }

function nameById(list, id) {
  const hit = (list || []).find((x) => String(x.id) === String(id));
  return hit && hit.name ? String(hit.name) : '-';
}

// ---- Model -------------------------------------------------------------------
/**
 * @param {object} o
 *  slip       respons getSalarySlip (live atau snapshot)
 *  periodLabel  "September 2026"
 *  employee   {id,name,active}
 *  lookups    {sewingJobTypes, inkTypes}
 *  company    {name, owners:[...], logoUrl}
 *  now        Date
 */
export function buildSlipModel({ slip, periodLabel, employee, lookups, company, now = new Date() }) {
  const detail = (slip && slip.detail) || {};
  const lk = lookups || {};

  const jahitRows = (detail.sewingWorkerPayments || []).map((r, i) => {
    const jumlah = num(r.jumlah), harga = num(r.harga_borongan);
    return { no: i + 1, nama: String(r.nama_order || '').trim() || '-', jenis: nameById(lk.sewingJobTypes, r.sewing_job_type_id), jumlah, harga, total: r.total === '' || r.total == null ? jumlah * harga : num(r.total) };
  });
  const sablonRows = (detail.printingWorkerPayments || []).map((r, i) => {
    const jumlah = num(r.jumlah), harga = num(r.harga_borongan), warna = num(r.jumlah_warna);
    const ink = nameById(lk.inkTypes, r.ink_type_id);
    return { no: i + 1, nama: String(r.nama_desain || '').trim() || '-', jenis: warna > 0 ? `${ink} · ${qtyId(warna)} warna` : ink, jumlah, harga, total: r.total === '' || r.total == null ? jumlah * harga : num(r.total) };
  });
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

  // Harian / Minggu / Lembur — agregasi tampilan (sama dengan SlipGaji.js sebelumnya)
  let hBiasa = 0, tBiasa = 0, hMinggu = 0, tMinggu = 0;
  (detail.dailyWorkerPayments || []).forEach((r) => {
    hBiasa += num(r.jumlah_hari_biasa); tBiasa += num(r.jumlah_hari_biasa) * num(r.tarif_harian);
    hMinggu += num(r.jumlah_hari_minggu); tMinggu += num(r.jumlah_hari_minggu) * num(r.tarif_minggu);
  });
  let jamLembur = 0, tLembur = 0;
  (detail.overtime || []).forEach((r) => { jamLembur += num(r.jumlah_jam); tLembur += r.total === '' || r.total == null ? num(r.jumlah_jam) * num(r.tarif_per_jam) : num(r.total); });

  const incomeAll = [
    { key: 'jahit', label: 'Total Order Jahit', qty: `${qtyId(sum(jahitRows, 'jumlah'))} pcs`, rate: '', amount: sum(jahitRows, 'total'), has: jahitRows.length > 0 },
    { key: 'sablon', label: 'Total Order Sablon', qty: `${qtyId(sum(sablonRows, 'jumlah'))} pcs`, rate: '', amount: sum(sablonRows, 'total'), has: sablonRows.length > 0 },
    { key: 'biasa', label: 'Gaji Hari Biasa', qty: `${qtyId(hBiasa)} hari`, rate: hBiasa > 0 ? `@${rupiah(tBiasa / hBiasa)}` : '', amount: tBiasa, has: hBiasa > 0 || tBiasa !== 0 },
    { key: 'minggu', label: 'Gaji Hari Minggu', qty: `${qtyId(hMinggu)} hari`, rate: hMinggu > 0 ? `@${rupiah(tMinggu / hMinggu)}` : '', amount: tMinggu, has: hMinggu > 0 || tMinggu !== 0 },
    { key: 'lembur', label: 'Uang Lembur', qty: `${qtyId(jamLembur)} jam`, rate: jamLembur > 0 ? `@${rupiah(tLembur / jamLembur)}` : '', amount: tLembur, has: jamLembur > 0 || tLembur !== 0 }
  ];
  let income = incomeAll.filter((r) => r.has);
  if (!income.length) income = [{ key: 'none', label: 'Belum ada penghasilan', qty: '', rate: '', amount: 0 }];

  // Authoritative totals — langsung dari API
  const gajiKotor = num(pick(slip, ['gajiKotor', 'gaji_kotor'], sum(jahitRows, 'total') + sum(sablonRows, 'total') + tBiasa + tMinggu + tLembur));
  const pot = (slip && slip.potongan) || {};
  const totalPotongan = num(pick(pot, ['total', 'totalPotongan', 'total_potongan'], 0));
  const gajiBersih = num(pick(slip, ['gajiBersih', 'gaji_bersih'], gajiKotor - totalPotongan));

  const deductions = detail.deductions || [];
  const entriesOf = (jenis) => deductions.filter((d) => d.jenis === jenis)
    .map((d) => ({ keterangan: String(d.keterangan || '').trim(), amount: jenis === 'hutang_cicilan' ? num(d.nominal_cicilan) : num(d.nominal) }))
    .filter((e) => e.keterangan && e.keterangan !== '-');
  const potRows = [
    { label: 'Kasbon', amount: num(pot.kasbon), entries: entriesOf('kasbon') },
    { label: 'Cicilan Hutang', amount: num(pot.cicilanHutangBulanIni), entries: entriesOf('hutang_cicilan') },
    { label: 'Lain-lain', amount: num(pot.potonganLain), entries: entriesOf('potongan_lain') }
  ];

  const types = [];
  if (jahitRows.length) types.push('JAHIT');
  if (sablonRows.length) types.push('SABLON');
  if (hBiasa > 0 || hMinggu > 0 || tBiasa > 0 || tMinggu > 0) types.push('HARIAN');
  if (!types.length && (jamLembur > 0 || tLembur > 0)) types.push('LEMBUR');

  const payer = slip && slip.payer ? slip.payer.owner_name || '' : '';
  const owners = (company && company.owners) || [];
  return {
    company: {
      name: (company && company.name) || 'Brotherhood Workshop',
      tagline1: owners.map((o) => String(o).toUpperCase()).join(' • '),
      tagline2: 'KONVEKSI & SABLON',
      logoUrl: (company && company.logoUrl) || ''
    },
    badge: types.length ? types.join(' & ') : 'SLIP',
    periodLabel: periodLabel || '-',
    employeeName: (employee && employee.name) || (slip && slip.employee_name) || '-',
    status: employee && employee.active === false ? 'Nonaktif' : 'Aktif',
    payer: payer || '',
    locked: Boolean(slip && slip.locked),
    printedDate: dateShort(now),
    printedTime: timeLabel(now),
    signDate: `${SLIP_CITY}, ${dateLong(now)}`,
    jahitRows, sablonRows,
    income, totalPenghasilan: gajiKotor,
    potRows, totalPotongan,
    net: gajiBersih,
    terbilang: terbilang(gajiBersih),
    notes: SLIP_NOTES.slice()
  };
}

function pick(obj, keys, dflt) {
  for (const k of keys) if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  return dflt;
}

export function slipFileName(model, ext = 'png') {
  const clean = (s) => String(s).normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  return `Slip-Gaji-${clean(model.employeeName)}-${clean(model.periodLabel)}.${ext}`;
}
