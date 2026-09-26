// ============================================================================
// Gaji Harian & Lembur — combines DailyWorkerPayments and Overtime in one
// page (two sections). TARIF_DIGUNAKAN = tarif khusus pekerja jika ada,
// selain itu tarif default global (employees.tarif_harian/tarif_minggu/
// tarif_lembur override settings.default_*). Shows a "Custom" tag when the
// selected worker carries a per-worker override.
// ============================================================================
import { renderCrudPage } from './_shared.js';
import { formatCurrency, escapeHtml, badge } from '../ui.js';
import { getCurrentPeriod, getLookups } from '../state.js';
import { byId, nameById, toOptions } from '../lookups.js';
import { previewGajiHarian, previewLembur, resolveTarif } from '../pricing.js';

function getSetting(lookups, key, fallback = 0) {
  const row = (lookups?.settings || []).find((s) => s.key === key);
  return row ? Number(row.value) || 0 : fallback;
}

export async function render(container) {
  const period = getCurrentPeriod();
  container.innerHTML = `
    <div class="page-header">
      <div><h1>Gaji Harian &amp; Lembur</h1><div class="subtitle">Gaji Harian/Minggu dan Lembur per pekerja untuk periode berjalan.</div></div>
    </div>
    <div id="section-daily"></div>
    <div class="mt-20"></div>
    <div id="section-overtime"></div>
  `;

  await renderCrudPage(document.getElementById('section-daily'), {
    title: 'Gaji Harian & Minggu',
    subtitle: 'Total = (Hari Biasa × Tarif Harian) + (Hari Minggu × Tarif Minggu).',
    listAction: 'getDailyWorkerPayments',
    listParams: () => ({ period_id: period?.id }),
    localFilters: [{ key: 'employee_id', label: 'Pekerja', allLabel: 'Semua Pekerja', options: () => toOptions(getLookups()?.employees) }],
    emptyTitle: 'Belum ada Gaji Harian',
    emptyHint: 'Tambahkan data hari kerja pekerja untuk periode ini.',
    emptyIcon: '\u{1F4C6}',
    columns: [
      { key: 'employee_id', label: 'Pekerja', format: (r) => escapeHtml(nameById(getLookups()?.employees, r.employee_id)) },
      { key: 'jumlah_hari_biasa', label: 'Hari Biasa', align: 'num' },
      { key: 'tarif_harian', label: 'Tarif Harian', align: 'num', format: (r) => formatCurrency(r.tarif_harian) },
      { key: 'jumlah_hari_minggu', label: 'Hari Minggu', align: 'num' },
      { key: 'tarif_minggu', label: 'Tarif Minggu', align: 'num', format: (r) => formatCurrency(r.tarif_minggu) },
      { key: 'total', label: 'Total', align: 'num', format: (r) => `<strong>${formatCurrency(r.total)}</strong>` }
    ],
    saveAction: 'saveDailyWorkerPayment',
    deleteAction: 'deleteDailyWorkerPayment',
    canDuplicate: false,
    deleteMessage: (r) => `Hapus data Gaji Harian pekerja ini?`,
    formTitle: (mode) => mode === 'edit' ? 'Edit Gaji Harian' : 'Tambah Gaji Harian',
    formFields: [
      { key: 'employee_id', label: 'Pekerja', type: 'select', required: true, options: (v, lk) => toOptions(lk?.employees),
        onChange: (v, lk) => autoFillDaily(v, lk) },
      { key: 'jumlah_hari_biasa', label: 'Jumlah Hari Biasa', type: 'number', required: true, min: 0 },
      { key: 'tarif_harian', label: 'Tarif Harian', type: 'number', required: true, min: 0,
        default: () => '', hint: 'Terisi dari tarif pekerja / default global — bisa diubah manual.' },
      { key: 'jumlah_hari_minggu', label: 'Jumlah Hari Minggu', type: 'number', required: true, min: 0 },
      { key: 'tarif_minggu', label: 'Tarif Minggu', type: 'number', required: true, min: 0,
        hint: 'Terisi dari tarif pekerja / default global — bisa diubah manual.' },
      { key: 'tarif_tag', label: 'Sumber tarif pekerja', type: 'preview', render: (v) => tarifTag(v, 'tarif_harian', 'tarif_minggu') },
      { key: 'total_preview', label: 'Total (pratinjau)', type: 'preview',
        render: (v) => `<strong>${formatCurrency(previewGajiHarian({ hariBiasa: v.jumlah_hari_biasa, tarifHarian: v.tarif_harian, hariMinggu: v.jumlah_hari_minggu, tarifMinggu: v.tarif_minggu }))}</strong>` }
    ],
    buildPayload: (v) => ({
      period_id: period?.id,
      employee_id: v.employee_id,
      jumlah_hari_biasa: Number(v.jumlah_hari_biasa) || 0,
      tarif_harian: Number(v.tarif_harian) || 0,
      jumlah_hari_minggu: Number(v.jumlah_hari_minggu) || 0,
      tarif_minggu: Number(v.tarif_minggu) || 0
    }),
    mapRowToForm: (row) => ({ ...row })
  });

  await renderCrudPage(document.getElementById('section-overtime'), {
    title: 'Lembur',
    subtitle: 'Total = Jam × Tarif Lembur.',
    listAction: 'getOvertime',
    listParams: () => ({ period_id: period?.id }),
    localFilters: [{ key: 'employee_id', label: 'Pekerja', allLabel: 'Semua Pekerja', options: () => toOptions(getLookups()?.employees) }],
    emptyTitle: 'Belum ada data Lembur',
    emptyHint: 'Tambahkan jam lembur pekerja untuk periode ini.',
    emptyIcon: '⏱️',
    columns: [
      { key: 'employee_id', label: 'Pekerja', format: (r) => escapeHtml(nameById(getLookups()?.employees, r.employee_id)) },
      { key: 'jumlah_jam', label: 'Jumlah Jam', align: 'num' },
      { key: 'tarif_per_jam', label: 'Tarif/Jam', align: 'num', format: (r) => formatCurrency(r.tarif_per_jam) },
      { key: 'total', label: 'Total', align: 'num', format: (r) => `<strong>${formatCurrency(r.total)}</strong>` }
    ],
    saveAction: 'saveOvertime',
    deleteAction: 'deleteOvertime',
    canDuplicate: false,
    deleteMessage: () => 'Hapus data Lembur ini?',
    formTitle: (mode) => mode === 'edit' ? 'Edit Lembur' : 'Tambah Lembur',
    formFields: [
      { key: 'employee_id', label: 'Pekerja', type: 'select', required: true, options: (v, lk) => toOptions(lk?.employees),
        onChange: (v, lk) => autoFillOvertime(v, lk) },
      { key: 'jumlah_jam', label: 'Jumlah Jam', type: 'number', required: true, min: 0 },
      { key: 'tarif_per_jam', label: 'Tarif Lembur / Jam', type: 'number', required: true, min: 0,
        hint: 'Terisi dari tarif pekerja / default global — bisa diubah manual.' },
      { key: 'tarif_tag', label: 'Sumber tarif pekerja', type: 'preview', render: (v) => tarifTag(v, null, null, 'tarif_per_jam') },
      { key: 'total_preview', label: 'Total (pratinjau)', type: 'preview',
        render: (v) => `<strong>${formatCurrency(previewLembur({ jam: v.jumlah_jam, tarif: v.tarif_per_jam }))}</strong>` }
    ],
    buildPayload: (v) => ({
      period_id: period?.id,
      employee_id: v.employee_id,
      jumlah_jam: Number(v.jumlah_jam) || 0,
      tarif_per_jam: Number(v.tarif_per_jam) || 0
    }),
    mapRowToForm: (row) => ({ ...row })
  });
}

function autoFillDaily(values, lk) {
  const employee = byId(lk?.employees, values.employee_id);
  if (!employee) return;
  if (values.tarif_harian === '' || values.tarif_harian === undefined) {
    values.tarif_harian = String(resolveTarif(employee, 'tarif_harian', getSetting(lk, 'default_tarif_harian')).value);
  }
  if (values.tarif_minggu === '' || values.tarif_minggu === undefined) {
    values.tarif_minggu = String(resolveTarif(employee, 'tarif_minggu', getSetting(lk, 'default_tarif_minggu')).value);
  }
}

function autoFillOvertime(values, lk) {
  const employee = byId(lk?.employees, values.employee_id);
  if (!employee) return;
  if (values.tarif_per_jam === '' || values.tarif_per_jam === undefined) {
    values.tarif_per_jam = String(resolveTarif(employee, 'tarif_lembur', getSetting(lk, 'default_tarif_lembur')).value);
  }
}

function tarifTag(values, harianKey, mingguKey, lemburKey) {
  const lk = getLookups();
  const employee = byId(lk?.employees, values.employee_id);
  if (!employee) return '<span class="text-low">Pilih pekerja untuk melihat sumber tarif.</span>';
  const parts = [];
  if (harianKey) {
    const r = resolveTarif(employee, 'tarif_harian', getSetting(lk, 'default_tarif_harian'));
    parts.push(`Harian: ${formatCurrency(r.value)} ${r.isCustom ? badge('Custom', 'warning') : badge('Default', 'neutral')}`);
  }
  if (mingguKey) {
    const r = resolveTarif(employee, 'tarif_minggu', getSetting(lk, 'default_tarif_minggu'));
    parts.push(`Minggu: ${formatCurrency(r.value)} ${r.isCustom ? badge('Custom', 'warning') : badge('Default', 'neutral')}`);
  }
  if (lemburKey) {
    const r = resolveTarif(employee, 'tarif_lembur', getSetting(lk, 'default_tarif_lembur'));
    parts.push(`Lembur: ${formatCurrency(r.value)} ${r.isCustom ? badge('Custom', 'warning') : badge('Default', 'neutral')}`);
  }
  return parts.join(' &middot; ') + '<div class="hint">Field tarif di atas sudah otomatis terisi — ubah manual bila perlu untuk baris ini saja.</div>';
}
