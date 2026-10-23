// ============================================================================
// Bayar (Dashboard "Total Harus Dibayar") + Saldo Awal & Piutang Awal.
// All three kinds live in ONE backend sheet (OwnerLedger, see
// backend/OwnerLedger.gs) and are read/written through the same three actions:
//   getOwnerLedger / saveOwnerLedger / voidOwnerLedger.
//
//  - Bayar/Terima: openSettleModal() — opened from the Dashboard owner panels
//                  (Total > 0 -> Bayar, Total < 0 -> Terima).
//  - Saldo/Piutang: renderLedgerTab() — a Master Data tab ("Saldo & Piutang
//                  Awal") that also lists the full Riwayat Pembayaran.
//
// Nothing here is an operational transaction: it never touches Jahit/Sablon/
// Pengeluaran and is not part of Total Pemasukan / Total Biaya. Rows are never
// deleted — a wrong one is "Dibatalkan" (void) with a reason and stays visible
// in the history.
// ============================================================================
import { postData, newRequestId } from '../api.js';
import { fetchSWR, peek, invalidate } from '../cache.js';
import { buildForm } from './_shared.js';
import {
  formatCurrency, formatDate, escapeHtml, badge, emptyState, skeletonTable, toast,
  openModal, closeModal, confirmDialog, formatPeriodLabel
} from '../ui.js';
import { icon } from '../icons.js';
import { getLookups } from '../state.js';
import { ownerOptions, ownerName } from '../lookups.js';
import { EXPENSE_OWNERS } from '../config.js';

// Anything that changes a ledger row can change Total Harus Dibayar of THIS
// and LATER periods (the unpaid balance carries forward) and the saldo chain,
// so every cached recap variant is dropped, not just the visible period.
export function invalidateLedgerCaches() {
  invalidate('getOwnerLedger');
  invalidate('getMonthlyRecap');
}

function pad2(n) { return String(n).padStart(2, '0'); }

// <input type="date"> wants a local YYYY-MM-DD. A date cell read back from the
// sheet can arrive as an ISO timestamp, so convert via the local calendar day
// instead of slicing the string.
export function toDateInput(v) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s.slice(0, 10);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayInput() { return toDateInput(new Date().toISOString()); }

function periodLabelById(id) {
  const p = (getLookups()?.periods || []).find((x) => String(x.id) === String(id));
  return p ? formatPeriodLabel(p) : '-';
}

function periodOptions() {
  return (getLookups()?.periods || []).slice()
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .map((p) => ({ value: p.id, label: formatPeriodLabel(p) }));
}

function ownerCode(id) {
  return (getLookups()?.owners || []).find((o) => o.id === id)?.code || '';
}

function ownerTag(id) {
  const code = ownerCode(id);
  return `<span class="owner-tag"><span class="owner-dot owner-dot--${code.toLowerCase()}"></span>${escapeHtml(ownerName(getLookups(), id))}</span>`;
}

// ---------------------------------------------------------------------------
// Void (Batalkan) — reason is mandatory, row stays in history.
// ---------------------------------------------------------------------------
export function openVoidModal(entry, onDone) {
  openModal({
    title: 'Batalkan Catatan',
    bodyHtml: `<p class="mb-12">Catatan <strong>${escapeHtml(formatCurrency(entry.nominal))}</strong> (${escapeHtml(formatDate(entry.tanggal))}) akan dibatalkan dan tidak dihitung lagi. Catatan tetap tersimpan di histori.</p><div id="void-form-root"></div>`,
    onMount: (body) => {
      buildForm(body.querySelector('#void-form-root'), [
        { key: 'reason', label: 'Alasan Pembatalan', type: 'textarea', required: true, fullWidth: true }
      ], { reason: '' }, null, async (values) => {
        const res = await postData('voidOwnerLedger', { id: entry.id, reason: values.reason });
        if (res.success) {
          toast('Catatan dibatalkan.', 'success');
          invalidateLedgerCaches();
          closeModal();
          if (onDone) onDone();
        }
      }, { submitLabel: 'Batalkan Catatan' });
    }
  });
}

// ---------------------------------------------------------------------------
// BAYAR / TERIMA modal (Dashboard)
// opts: { ownerId, period, total, saldo, prefill?, reqId?, onSaved(entry, duplicate), onChanged() }
//   total = Total Harus Dibayar currently shown on the panel
//           > 0  -> Bayar   (perusahaan membayar Owner; Saldo Perusahaan turun)
//           < 0  -> Terima  (perusahaan menerima dari Owner; Saldo Perusahaan naik)
//   saldo = Saldo Perusahaan (Saldo Akhir periode ini) currently shown
// Flow: Total Harus Dibayar -> Bayar/Terima -> nominal -> Konfirmasi.
// ---------------------------------------------------------------------------
const EPS = 0.5;
const rp = (n) => formatCurrency(n);

function parseDigits(v) { return Number(String(v == null ? '' : v).replace(/[^0-9]/g, '')) || 0; }

export function openSettleModal(opts) {
  const { ownerId, period } = opts;
  const total = Number(opts.total) || 0;
  const saldo = Number(opts.saldo) || 0;
  if (Math.abs(total) < EPS) { toast('Tidak ada pembayaran: Total Harus Dibayar Rp0.', 'warning'); return; }
  const kind = total > 0 ? 'PAYMENT' : 'RECEIPT';
  const isPay = kind === 'PAYMENT';
  const absTotal = Math.abs(total);
  const name = ownerName(getLookups(), ownerId);
  const formReqId = opts.reqId || newRequestId(); // one per modal session => double-click can never save twice
  const values = opts.prefill || { nominal: '', tanggal: todayInput(), keterangan: '' };

  openModal({
    title: `${isPay ? 'Bayar' : 'Terima'} — ${name}`,
    bodyHtml: `
      <div class="bayar-summary">
        <div><div class="label">Owner</div><div class="value">${escapeHtml(name)}</div></div>
        <div><div class="label">Periode</div><div class="value">${escapeHtml(formatPeriodLabel(period))}</div></div>
        <div class="is-wide"><div class="label">Total Harus Dibayar</div>
          <div class="value" style="color:${isPay ? 'var(--status-success-fg)' : 'var(--status-critical-fg)'}">${escapeHtml(rp(total))}</div>
          <div class="sub">${isPay ? 'Perusahaan harus membayar ' + escapeHtml(name) : 'Perusahaan berhak menerima dari ' + escapeHtml(name)}</div></div>
        <div><div class="label">Saldo Perusahaan Sebelum</div><div class="value">${escapeHtml(rp(saldo))}</div></div>
        <div class="is-after"><div class="label">Saldo Perusahaan Sesudah</div><div class="value" id="settle-saldo-after">${escapeHtml(rp(saldo))}</div></div>
        <div class="is-wide is-after"><div class="label">Sisa Total Harus Dibayar Sesudah</div><div class="value" id="settle-sisa-after">${escapeHtml(rp(total))}</div></div>
      </div>
      <button type="button" class="bayar-quickfill" id="bayar-fill">Isi sesuai Total Harus Dibayar (${escapeHtml(rp(absTotal))})</button>
      <div id="bayar-form-root"></div>
      <h4 class="mt-16 mb-8">Riwayat (${escapeHtml(name)}, ${escapeHtml(formatPeriodLabel(period))})</h4>
      <div id="bayar-history">${skeletonTable(5, 2)}</div>`,
    onMount: (body) => {
      // Live preview of the numbers AFTER this entry (nothing is saved yet).
      const updatePreview = (raw) => {
        const n = parseDigits(raw);
        const saldoEl = body.querySelector('#settle-saldo-after');
        const sisaEl = body.querySelector('#settle-sisa-after');
        if (saldoEl) saldoEl.textContent = rp(saldo + (isPay ? -n : n));
        if (sisaEl) sisaEl.textContent = rp(total + (isPay ? -n : n));
      };
      updatePreview(values.nominal);

      buildForm(body.querySelector('#bayar-form-root'), [
        { key: 'nominal', label: isPay ? 'Nominal Pembayaran' : 'Nominal Diterima', type: 'number', required: true, min: 1,
          onChange: (vals) => updatePreview(vals.nominal),
          hint: isPay ? `Pembayaran mengurangi Total Harus Dibayar dan Saldo Perusahaan. Maksimal ${rp(absTotal)}.`
                      : `Penerimaan menambah Saldo Perusahaan dan menggeser Total Harus Dibayar ke Rp0. Maksimal ${rp(absTotal)}.` },
        { key: 'tanggal', label: isPay ? 'Tanggal Pembayaran' : 'Tanggal Penerimaan', type: 'date', required: true },
        { key: 'keterangan', label: 'Keterangan (opsional)', type: 'textarea', fullWidth: true }
      ], values, null, async (v) => {
        const nominal = Number(v.nominal) || 0;
        const flags = {};
        const payload = () => ({
          kind, owner_id: ownerId, period_id: period.id, tanggal: v.tanggal,
          nominal, keterangan: v.keterangan || '', req_id: formReqId, ...flags
        });
        let res = await postData('saveOwnerLedger', payload(), { silent: true });
        // Server asks for confirmation (nominal > Total, or Saldo Perusahaan would go negative).
        for (let guard = 0; guard < 3 && !res.success && (res.code === 'OVERPAY' || res.code === 'SALDO_KURANG'); guard++) {
          const ok = await confirmDialog(`${res.message} Tetap lanjutkan?`, { confirmLabel: 'Ya, lanjutkan', tone: 'primary' });
          if (!ok) { openSettleModal({ ...opts, prefill: { ...v }, reqId: formReqId }); return; } // keep what the user typed
          if (res.code === 'OVERPAY') flags.allow_over = true; else flags.allow_saldo_minus = true;
          res = await postData('saveOwnerLedger', payload(), { silent: true });
        }
        if (!res.success) {
          toast(res.message || 'Gagal menyimpan.', 'error');
          if (res.code === 'NO_DUE' || res.code === 'WRONG_DIRECTION') { closeModal(); if (opts.onChanged) opts.onChanged(); }
          return;
        }
        toast(res.data && res.data.duplicate
          ? 'Sudah tercatat sebelumnya — tidak dicatat dua kali.'
          : (isPay ? 'Pembayaran tersimpan.' : 'Penerimaan tersimpan.'), 'success');
        invalidateLedgerCaches();
        closeModal();
        if (opts.onSaved) opts.onSaved(res.data && res.data.entry, Boolean(res.data && res.data.duplicate));
      }, { submitLabel: isPay ? 'Konfirmasi Bayar' : 'Konfirmasi Terima' });

      body.querySelector('#bayar-fill').addEventListener('click', () => {
        const input = body.querySelector('input[name="nominal"]');
        if (!input) return;
        input.value = String(Math.round(absTotal));
        input.dispatchEvent(new Event('input', { bubbles: true })); // runs the shared currency-mask handler (+ live preview)
        input.focus();
      });

      loadHistory(body.querySelector('#bayar-history'), ownerId, period, opts);
    }
  });
}

// Backwards-compatible name (older imports).
export const openBayarModal = openSettleModal;

const SETTLE_KINDS = ['PAYMENT', 'RECEIPT'];
const kindTag = (k) => `<span class="kind-tag kind-tag--${escapeHtml(k)}">${k === 'RECEIPT' ? 'Terima' : 'Bayar'}</span>`;

function loadHistory(root, ownerId, period, opts) {
  const params = { owner_id: ownerId, period_id: period.id };
  const paint = (all) => {
    if (!root.isConnected) return;
    const rows = (all || []).filter((r) => SETTLE_KINDS.includes(r.kind));
    if (!rows.length) { root.innerHTML = '<div class="text-low" style="font-size:13px">Belum ada pembayaran/penerimaan untuk periode ini.</div>'; return; }
    root.innerHTML = historyTable(rows, true);
    wireVoidButtons(root, rows, () => {
      // after a void: the open modal is replaced by the reason modal, so refresh via the caller.
      if (opts.onChanged) opts.onChanged();
    });
  };
  const cached = peek('getOwnerLedger', params);
  if (cached !== undefined) paint(cached);
  fetchSWR('getOwnerLedger', params, paint, { ttlMs: 5000 }).catch(() => {
    if (root.isConnected && cached === undefined) root.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat riwayat.</div>`;
  });
}

function historyTable(rows, compact) {
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr>${compact ? '' : '<th>Owner</th><th>Periode</th>'}<th>Jenis</th><th>Tanggal</th><th class="num">Nominal</th><th>Keterangan</th><th>Status</th><th class="num">Aksi</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr data-i="${i}" class="${r.status === 'void' ? 'ledger-row--void' : ''}">
        ${compact ? '' : `<td>${ownerTag(r.owner_id)}</td><td>${escapeHtml(periodLabelById(r.period_id))}</td>`}
        <td>${kindTag(r.kind)}</td>
        <td>${escapeHtml(formatDate(r.tanggal))}</td>
        <td class="num"><strong>${escapeHtml(formatCurrency(r.nominal))}</strong></td>
        <td>${escapeHtml(r.keterangan || '-')}</td>
        <td>${r.status === 'void' ? `<span title="${escapeHtml(r.void_reason || '')}">${badge('Dibatalkan', 'neutral')}</span>` : badge('Tercatat', 'success')}</td>
        <td class="row-actions">${r.status === 'void' ? '' : `<button class="btn btn-outline btn-sm" data-act="void">Batalkan</button>`}</td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function wireVoidButtons(root, rows, afterVoid) {
  root.querySelectorAll('[data-act="void"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const row = rows[Number(btn.closest('tr').dataset.i)];
      if (row) openVoidModal(row, afterVoid);
    });
  });
}

// ---------------------------------------------------------------------------
// Master Data tab: "Saldo & Piutang Awal" (+ full Riwayat Pembayaran)
// ---------------------------------------------------------------------------
const KIND_META = {
  SALDO_AWAL: {
    title: 'Saldo Awal',
    hint: 'Saldo kas sebelum aplikasi dipakai (umumnya BROTHERHOOD). Dihitung SEKALI pada periode yang dipilih, lalu terbawa ke periode berikutnya lewat Saldo Akhir. Bukan transaksi — tidak mengubah Pemasukan, Biaya, maupun transaksi yang sudah ada.',
    owners: () => ownerOptions(getLookups()),
    defaultOwner: () => (getLookups()?.owners || []).find((o) => o.code === 'BROTHERHOOD')?.id || '',
    allowNegative: true
  },
  PIUTANG_AWAL: {
    title: 'Piutang Awal',
    hint: 'Piutang PINGBRO / SUNRISE sebelum aplikasi dipakai. Menambah "Total Harus Dibayar" owner pada periode yang dipilih; sisa yang belum dibayar terbawa ke periode berikutnya. Bukan transaksi operasional.',
    owners: () => ownerOptions(getLookups(), EXPENSE_OWNERS),
    defaultOwner: () => '',
    allowNegative: false
  }
};

export function renderLedgerTab(body) {
  body.innerHTML = `
    ${['SALDO_AWAL', 'PIUTANG_AWAL'].map((kind) => `
      <div class="card mb-16" id="led-${kind}">
        <div class="ledger-section-head">
          <h3>${KIND_META[kind].title}</h3>
          <button class="btn btn-primary" data-add="${kind}">${icon('plus', 15)} Tambah ${KIND_META[kind].title}</button>
        </div>
        <p class="ledger-hint">${escapeHtml(KIND_META[kind].hint)}</p>
        <div data-list>${skeletonTable(6, 2)}</div>
      </div>`).join('')}
    <div class="card" id="led-PAYMENT">
      <div class="ledger-section-head"><h3>Riwayat Pembayaran &amp; Penerimaan</h3></div>
      <p class="ledger-hint">Semua Bayar / Terima "Total Harus Dibayar" yang dicatat dari Dashboard. Yang salah dapat dibatalkan — catatannya tetap tersimpan di sini. Bayar/Terima memindahkan kas (Saldo Perusahaan), bukan Pengeluaran.</p>
      <div data-list>${skeletonTable(7, 2)}</div>
    </div>`;

  body.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => openEntryForm(btn.dataset.add, null, reload));
  });

  const paint = (rows) => {
    if (!body.isConnected) return;
    const all = Array.isArray(rows) ? rows : [];
    ['SALDO_AWAL', 'PIUTANG_AWAL'].forEach((kind) => paintOpening(body, kind, all.filter((r) => r.kind === kind)));
    paintPayments(body, all.filter((r) => SETTLE_KINDS.includes(r.kind)));
  };

  function reload() {
    return fetchSWR('getOwnerLedger', {}, paint, { force: true }).catch(() => {});
  }

  const cached = peek('getOwnerLedger', {});
  if (cached !== undefined) paint(cached);
  fetchSWR('getOwnerLedger', {}, paint).catch(() => {
    if (cached === undefined && body.isConnected) {
      body.querySelectorAll('[data-list]').forEach((el) => { el.innerHTML = `<div class="notice notice-critical">${icon('alert')} Gagal memuat data.</div>`; });
    }
  });

  body.__reloadLedger = reload;
}

function paintOpening(body, kind, rows) {
  const root = body.querySelector(`#led-${kind} [data-list]`);
  if (!root) return;
  if (!rows.length) { root.innerHTML = emptyState(`Belum ada ${KIND_META[kind].title}`, 'Tambahkan dengan tombol di kanan atas.', '\u{1F4D2}'); return; }
  root.innerHTML = `<div class="table-wrap"><table class="data-table">
    <thead><tr><th>Owner</th><th>Periode Awal</th><th>Tanggal</th><th class="num">Nominal</th><th>Keterangan</th><th>Status</th><th class="num">Aksi</th></tr></thead>
    <tbody>${rows.map((r, i) => `
      <tr data-i="${i}" class="${r.status === 'void' ? 'ledger-row--void' : ''}">
        <td>${ownerTag(r.owner_id)}</td>
        <td>${escapeHtml(periodLabelById(r.period_id))}</td>
        <td>${escapeHtml(formatDate(r.tanggal))}</td>
        <td class="num"><strong>${escapeHtml(formatCurrency(r.nominal))}</strong></td>
        <td>${escapeHtml(r.keterangan || '-')}</td>
        <td>${r.status === 'void' ? `<span title="${escapeHtml(r.void_reason || '')}">${badge('Dibatalkan', 'neutral')}</span>` : badge('Aktif', 'success')}</td>
        <td class="row-actions">${r.status === 'void' ? '' : `
          <button class="btn btn-outline btn-sm btn-icon" data-act="edit" title="Edit">${icon('edit', 15)}</button>
          <button class="btn btn-outline btn-sm" data-act="void">Batalkan</button>`}</td>
      </tr>`).join('')}</tbody></table></div>`;
  const reload = () => body.__reloadLedger && body.__reloadLedger();
  root.querySelectorAll('[data-act="edit"]').forEach((btn) => btn.addEventListener('click', () => {
    openEntryForm(kind, rows[Number(btn.closest('tr').dataset.i)], reload);
  }));
  wireVoidButtons(root, rows, reload);
}

function paintPayments(body, rows) {
  const root = body.querySelector('#led-PAYMENT [data-list]');
  if (!root) return;
  if (!rows.length) { root.innerHTML = emptyState('Belum ada pembayaran', 'Bayar / Terima dicatat dari tombol di panel Dashboard.', '\u{1F4B3}'); return; }
  root.innerHTML = historyTable(rows, false);
  wireVoidButtons(root, rows, () => body.__reloadLedger && body.__reloadLedger());
}

function openEntryForm(kind, entry, onSaved) {
  const meta = KIND_META[kind];
  const periods = periodOptions();
  const formReqId = newRequestId();
  const editing = Boolean(entry);
  const values = editing
    ? { owner_id: entry.owner_id, period_id: entry.period_id, tanggal: toDateInput(entry.tanggal), nominal: String(entry.nominal), keterangan: entry.keterangan || '' }
    : { owner_id: meta.defaultOwner(), period_id: periods[0]?.value || '', tanggal: todayInput(), nominal: '', keterangan: '' };

  openModal({
    title: `${editing ? 'Edit' : 'Tambah'} ${meta.title}`,
    bodyHtml: `<p class="ledger-hint">${escapeHtml(meta.hint)}</p><div id="led-form-root"></div>`,
    onMount: (body) => {
      buildForm(body.querySelector('#led-form-root'), [
        { key: 'owner_id', label: 'Owner', type: 'select', required: true, options: () => meta.owners() },
        { key: 'period_id', label: 'Periode Awal', type: 'select', required: true, options: () => periods,
          hint: 'Periode tempat nilai ini mulai dihitung.' },
        { key: 'tanggal', label: 'Tanggal Awal', type: 'date', required: true },
        { key: 'nominal', label: 'Nominal', type: 'number', required: true,
          validate: (v) => (Number(v) === 0 ? 'Nominal tidak boleh 0.' : (!meta.allowNegative && Number(v) < 0 ? 'Nominal harus lebih dari 0.' : null)) },
        { key: 'keterangan', label: 'Keterangan (opsional)', type: 'textarea', fullWidth: true }
      ], values, getLookups(), async (v) => {
        const res = await postData('saveOwnerLedger', {
          ...(editing ? { id: entry.id } : {}),
          kind, owner_id: v.owner_id, period_id: v.period_id, tanggal: v.tanggal,
          nominal: Number(v.nominal) || 0, keterangan: v.keterangan || '', req_id: formReqId
        });
        if (res.success) {
          toast(res.data && res.data.duplicate ? 'Data ini sudah tercatat sebelumnya — tidak dicatat dua kali.' : `${meta.title} tersimpan.`, 'success');
          invalidateLedgerCaches();
          closeModal();
          if (onSaved) onSaved();
        }
      }, { submitLabel: 'Simpan' });
    }
  });
}
