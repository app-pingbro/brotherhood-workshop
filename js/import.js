// ============================================================
// IMPOR EXCEL — parsing .xlsx dilakukan di BROWSER (SheetJS), bukan di Apps Script.
// Backend hanya menerima baris yang SUDAH dipetakan (mapping) sebagai JSON, lalu memvalidasi ulang
// sebelum menyimpan. Alur wajib: Upload → baca struktur → Preview → Mapping Kolom → Validasi → Konfirmasi → Simpan.
// ============================================================

const Impor = (() => {
  const SKEMA = {
    order: {
      judul: 'Impor Order (Jahit/Sablon)',
      kolomSistem: [
        { key: 'tanggal_order', label: 'Tanggal Order', wajib: true, tipe: 'tanggal' },
        { key: 'unit', label: 'Unit (PB/SR/BH atau nama unit)', wajib: true, tipe: 'teks' },
        { key: 'pelanggan_nama', label: 'Nama Pelanggan', wajib: true, tipe: 'teks' },
        { key: 'tipe', label: 'Tipe (Jahit/Sablon)', wajib: true, tipe: 'teks' },
        { key: 'jenis_tinta', label: 'Jenis/Deskripsi Item', wajib: true, tipe: 'teks' },
        { key: 'warna', label: 'Jumlah Warna (khusus Sablon)', wajib: false, tipe: 'angka' },
        { key: 'qty', label: 'Qty (pcs)', wajib: true, tipe: 'angka' },
        { key: 'harga', label: 'Harga per pcs', wajib: true, tipe: 'rupiah' },
        { key: 'keterangan', label: 'Keterangan', wajib: false, tipe: 'teks' }
      ],
      previewAction: 'impor.previewOrder', commitAction: 'impor.commitOrder',
      templates: [
        {
          nama: 'Template Import Order – Jahit', file: 'Template_Import_Order_Jahit.xlsx',
          contoh: [
            ['2026-08-05', 'PB', 'Toko Melati', 'Jahit', 'Kemeja Lengan Panjang', '', 50, 75000, 'Contoh baris — hapus/ganti dengan data asli sebelum diunggah'],
            ['2026-08-06', 'SR', 'Bu Ratna', 'Jahit', 'Celana Kerja', '', 20, 90000, '']
          ]
        },
        {
          nama: 'Template Import Order – Sablon', file: 'Template_Import_Order_Sablon.xlsx',
          contoh: [
            ['2026-08-05', 'BH', 'CV Sinar Jaya', 'Sablon', 'Kaos Oblong Sablon Depan-Belakang', 2, 100, 25000, 'Contoh baris — hapus/ganti dengan data asli sebelum diunggah'],
            ['2026-08-06', 'PB', 'Toko Melati', 'Sablon', 'Kaos Sablon 1 Warna', 1, 40, 20000, '']
          ]
        }
      ]
    },
    pengeluaran: {
      judul: 'Impor Pengeluaran',
      kolomSistem: [
        { key: 'tanggal', label: 'Tanggal', wajib: true, tipe: 'tanggal' },
        { key: 'unit', label: 'Unit (kosongkan bila Biaya Bersama)', wajib: false, tipe: 'teks' },
        { key: 'kategori', label: 'Kategori', wajib: true, tipe: 'teks' },
        { key: 'nominal', label: 'Nominal', wajib: true, tipe: 'rupiah' },
        { key: 'vendor', label: 'Vendor', wajib: false, tipe: 'teks' },
        { key: 'keterangan', label: 'Keterangan', wajib: false, tipe: 'teks' }
      ],
      previewAction: 'impor.previewPengeluaran', commitAction: 'impor.commitPengeluaran',
      templates: [
        {
          nama: 'Template Import Pengeluaran', file: 'Template_Import_Pengeluaran.xlsx',
          contoh: [
            ['2026-08-03', 'PB', 'Bahan Baku', 350000, 'Toko Kain Sentosa', 'Beli kain katun 20 meter — contoh baris, hapus/ganti sebelum diunggah'],
            ['2026-08-04', '', 'Transportasi', 75000, '', 'Bensin dan parkir (Biaya Bersama)']
          ]
        }
      ]
    },
    pekerjaan: {
      judul: 'Impor Pekerjaan (Borongan Karyawan)',
      kolomSistem: [
        { key: 'tanggal', label: 'Tanggal', wajib: true, tipe: 'tanggal' },
        { key: 'karyawan', label: 'Karyawan (nama persis sesuai master Karyawan)', wajib: true, tipe: 'teks' },
        { key: 'unit', label: 'Unit (PB/SR/BH atau nama unit)', wajib: false, tipe: 'teks' },
        { key: 'tipe', label: 'Jenis Pekerjaan (Jahit/Sablon/Lainnya)', wajib: false, tipe: 'teks' },
        { key: 'jenis_tinta', label: 'Jenis Produksi/Deskripsi', wajib: true, tipe: 'teks' },
        { key: 'qty', label: 'Jumlah/Pcs', wajib: true, tipe: 'angka' },
        { key: 'upah_snapshot', label: 'Harga/Upah per Satuan', wajib: true, tipe: 'rupiah' },
        { key: 'keterangan', label: 'Keterangan', wajib: false, tipe: 'teks' }
      ],
      previewAction: 'impor.previewPekerjaan', commitAction: 'impor.commitPekerjaan',
      templates: [
        {
          nama: 'Template Import Pekerjaan', file: 'Template_Import_Pekerjaan.xlsx',
          contoh: [
            ['2026-08-05', 'Galih', 'PB', 'Jahit', 'Borongan Jahit Kemeja', 50, 15000, 'Contoh baris — hapus/ganti dengan data asli sebelum diunggah'],
            ['2026-08-06', 'Made Yasa', 'SR', 'Sablon', 'Borongan Sablon Kaos', 30, 8000, '']
          ]
        }
      ]
    }
  };

  let state = { tipe: null, langkah: 1, kolomFile: [], rows: [], mapping: {}, namaFile: '', hasil: null };

  function stepperHtml() {
    const langkah = ['Upload', 'Mapping Kolom', 'Validasi', 'Konfirmasi'];
    return `<div class="stepper">${langkah.map((l, i) => {
      const n = i + 1; const cls = n === state.langkah ? 'on' : (n < state.langkah ? 'done' : '');
      return `<div class="step ${cls}"><span class="n">${n < state.langkah ? '✓' : n}</span> ${l}</div>` + (i < langkah.length - 1 ? '<span class="sep">›</span>' : '');
    }).join('')}</div>`;
  }

  function mulai(tipe) {
    state = { tipe: tipe, langkah: 1, kolomFile: [], rows: [], mapping: {}, namaFile: '', hasil: null };
    render();
  }

  function render() {
    const skema = SKEMA[state.tipe];
    const el = $('imporBody');
    el.innerHTML = `<div class="card-x"><h2 class="h3 mb-16">${skema.judul}</h2>${stepperHtml()}<div id="imporStepBody"></div></div>`;
    if (state.langkah === 1) renderUpload();
    else if (state.langkah === 2) renderMapping();
    else if (state.langkah === 3) renderValidasi();
    else renderKonfirmasi();
  }

  function renderUpload() {
    const skema = SKEMA[state.tipe];
    const tombolTemplate = (skema.templates || []).map((t, i) =>
      `<button class="btn-pill btn-ghost sm" onclick="Impor.unduhTemplate('${state.tipe}', ${i})"><i class="bi bi-file-earmark-excel"></i> Download ${esc(t.nama)}</button>`).join('');
    $('imporStepBody').innerHTML = `
      ${tombolTemplate ? `<div class="notice notice-neutral mb-16"><i class="bi bi-download"></i><div><b>Belum punya file?</b> Unduh template Excel di bawah ini, isi datanya, lalu unggah kembali.
        <div class="gap-row mt-12" style="flex-wrap:wrap">${tombolTemplate}</div></div></div>` : ''}
      <div class="dropzone" id="dzUpload"><i class="bi bi-file-earmark-arrow-up"></i>
        <div class="h3">Seret file .xlsx ke sini, atau klik untuk memilih</div>
        <div class="caption mt-12">Baris pertama file harus berupa judul kolom (header). Kolom bertanda * wajib diisi.</div>
        <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" class="hide"></div>`;
    const dz = $('dzUpload'), inp = $('fileInput');
    dz.addEventListener('click', () => inp.click());
    ['dragover', 'dragleave', 'drop'].forEach(evt => dz.addEventListener(evt, e => { e.preventDefault(); dz.classList.toggle('drag', evt === 'dragover'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer.files[0]) bacaFile(e.dataTransfer.files[0]); });
    inp.addEventListener('change', e => { if (e.target.files[0]) bacaFile(e.target.files[0]); });
  }

  /** Bangun & unduh file .xlsx template siap-isi untuk satu jenis impor (kolom sesuai struktur yang
   *  sudah ditetapkan di PRD — TIDAK mengubah struktur database, hanya menyalin nama & urutan kolomnya). */
  function unduhTemplate(tipe, i) {
    const skema = SKEMA[tipe];
    const tpl = skema.templates[i];
    const header = skema.kolomSistem.map(k => k.label + (k.wajib ? ' *' : ' (opsional)'));
    const aoa = [header].concat(tpl.contoh);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = skema.kolomSistem.map(k => ({ wch: Math.max(16, k.label.length) }));
    // Format kolom tanggal & angka/Rupiah supaya Excel menampilkannya dengan format yang benar.
    skema.kolomSistem.forEach((k, ci) => {
      for (let ri = 1; ri <= tpl.contoh.length; ri++) {
        const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
        const cell = ws[ref];
        if (!cell || cell.v === '' || cell.v === undefined) continue;
        if (k.tipe === 'tanggal') {
          const p = String(cell.v).split('-');
          if (p.length === 3) { cell.t = 'd'; cell.v = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); cell.z = 'yyyy-mm-dd'; }
        } else if (k.tipe === 'rupiah') { cell.z = '#,##0'; }
        else if (k.tipe === 'angka') { cell.z = '0'; }
      }
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const petunjuk = [
      ['Petunjuk Pengisian — ' + tpl.nama],
      [''],
      ['1. Jangan mengubah judul kolom pada baris pertama sheet "Template".'],
      ['2. Kolom bertanda * WAJIB diisi. Kolom bertanda (opsional) boleh dikosongkan.'],
      ['3. Format tanggal: YYYY-MM-DD (contoh 2026-08-05) atau format tanggal Excel biasa.'],
      ['4. Kolom angka/Rupiah diisi angka murni tanpa "Rp" atau titik ribuan (contoh 75000, bukan "Rp 75.000").'],
      ['5. Hapus atau timpa baris contoh sebelum mengisi data asli — baris contoh ikut ditolak sistem sebagai duplikat bila dibiarkan.'],
      ['6. Setelah selesai, simpan file lalu unggah kembali di halaman Impor Excel → Upload → Preview → Validasi → Konfirmasi.']
    ];
    const wsP = XLSX.utils.aoa_to_sheet(petunjuk);
    wsP['!cols'] = [{ wch: 90 }];
    XLSX.utils.book_append_sheet(wb, wsP, 'Petunjuk');
    XLSX.writeFile(wb, tpl.file);
    showToast('ok', 'Template Diunduh', tpl.nama + ' berhasil diunduh.');
  }

  function bacaFile(file) {
    state.namaFile = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
        if (!rows.length) { showToast('err', 'Kosong', 'File tidak memiliki baris data.'); return; }
        state.kolomFile = rows[0].map(String);
        state.rows = rows.slice(1).filter(r => r.some(c => c !== ''));
        if (!state.rows.length) { showToast('err', 'Kosong', 'Tidak ada baris data di bawah header.'); return; }
        showToast('ok', 'Terbaca', state.rows.length + ' baris ditemukan pada "' + file.name + '".');
        state.langkah = 2;
        render();
      } catch (err) {
        showToast('err', 'Gagal membaca file', err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function renderMapping() {
    const skema = SKEMA[state.tipe];
    const opsiKolom = ['— Tidak dipetakan —'].concat(state.kolomFile);
    $('imporStepBody').innerHTML = `
      <div class="notice notice-neutral mb-16"><i class="bi bi-info-circle"></i>Cocokkan kolom pada file Excel Anda dengan kolom yang dibutuhkan sistem.</div>
      ${skema.kolomSistem.map(k => `<div class="map-row">
        <div><b>${esc(k.label)}</b>${k.wajib ? ' <span class="chip chip-belum">wajib</span>' : ''}</div>
        <div class="arrow"><i class="bi bi-arrow-left-right"></i></div>
        <select class="select-pill sm" id="map_${k.key}">${opsiKolom.map((c, i) => `<option value="${i - 1}" ${autoMatch_(k, c)}>${esc(c)}</option>`).join('')}</select>
      </div>`).join('')}
      <div class="gap-row mt-16">
        <button class="btn-pill btn-ghost" onclick="Impor.kembali()">Kembali</button>
        <button class="btn-pill btn-lime" onclick="Impor.terapkanMapping()">Lanjut ke Validasi</button>
      </div>`;
  }
  function autoMatch_(k, kolomFile) {
    if (kolomFile === state.kolomFile[0] && false) return '';
    const norm = s => String(s).toLowerCase().replace(/[^a-z]/g, '');
    return norm(kolomFile) === norm(k.label) || norm(kolomFile).indexOf(norm(k.key)) >= 0 ? 'selected' : '';
  }
  function kembali() { state.langkah = Math.max(1, state.langkah - 1); render(); }

  /** Sel Excel bertipe tanggal terbaca SheetJS sebagai objek Date (cellDates:true) — ubah ke
   *  "YYYY-MM-DD" (UTC, sama seperti ymdToDate/dateToYmd di ui.js) sebelum dikirim sebagai JSON,
   *  supaya tidak berubah jadi string ISO datetime yang tidak dikenali validator tanggal backend. */
  function normalisasiSel_(v) {
    if (v instanceof Date) return dateToYmd(v);
    return v;
  }

  function terapkanMapping() {
    const skema = SKEMA[state.tipe];
    const mapping = {};
    let kurang = [];
    skema.kolomSistem.forEach(k => {
      const idx = Number($('map_' + k.key).value);
      mapping[k.key] = idx;
      if (k.wajib && idx < 0) kurang.push(k.label);
    });
    if (kurang.length) { showToast('warn', 'Mapping belum lengkap', 'Kolom wajib belum dipetakan: ' + kurang.join(', ')); return; }
    state.mapping = mapping;
    state.baris = state.rows.map(r => {
      const o = {};
      skema.kolomSistem.forEach(k => { o[k.key] = mapping[k.key] >= 0 ? normalisasiSel_(r[mapping[k.key]]) : ''; });
      return o;
    });
    state.langkah = 3;
    validasiKeServer();
  }

  async function validasiKeServer() {
    $('imporStepBody').innerHTML = `<div class="empty"><div class="spin"></div><div class="mt-12">Memvalidasi ${state.baris.length} baris ke server...</div></div>`;
    const skema = SKEMA[state.tipe];
    const res = await Api.post(skema.previewAction, { baris: state.baris });
    if (!res.success) { $('imporStepBody').innerHTML = emptyState('bi-exclamation-triangle', res.message) + `<button class="btn-pill btn-ghost" onclick="Impor.kembali()">Kembali</button>`; return; }
    state.hasil = res.data.hasil;
    state.ringkasan = res.data.ringkasan;
    render();
  }

  function renderValidasi() {
    const r = state.ringkasan;
    $('imporStepBody').innerHTML = `
      <div class="stat-grid mb-16">
        <div class="kpi kpi-small kpi-white"><div class="kpi-label">Total Baris</div><div class="kpi-value">${r.total}</div></div>
        <div class="kpi kpi-small kpi-lime"><div class="kpi-label">Valid</div><div class="kpi-value">${r.valid}</div></div>
        <div class="kpi kpi-small kpi-white" style="background:var(--coral-bg)"><div class="kpi-label">Error</div><div class="kpi-value">${r.error}</div></div>
        <div class="kpi kpi-small kpi-white" style="background:var(--amber-bg)"><div class="kpi-label">Kemungkinan Duplikat</div><div class="kpi-value">${r.duplikat}</div></div>
      </div>
      <div class="card-x flush mb-16" style="max-height:420px;overflow:auto">
        ${state.hasil.map(h => {
          if (h.errors.length) return `<div class="val-row err" style="margin:10px"><i class="bi bi-x-octagon-fill"></i><div><b>Baris ${h.baris}:</b> ${h.errors.map(esc).join('; ')}</div></div>`;
          if (h.warnings.length) return `<div class="val-row warn" style="margin:10px"><i class="bi bi-exclamation-triangle-fill"></i><div><b>Baris ${h.baris}</b> (${esc(h.data.pelanggan_nama || h.data.kategori || h.data.karyawan_nama || '')}): ${h.warnings.map(esc).join('; ')}</div></div>`;
          return `<div class="val-row ok" style="margin:10px"><i class="bi bi-check-circle-fill"></i><div>Baris ${h.baris}: siap diimpor.</div></div>`;
        }).join('')}
      </div>
      <div class="gap-row">
        <button class="btn-pill btn-ghost" onclick="Impor.kembali()">Kembali ke Mapping</button>
        <button class="btn-pill btn-lime" ${r.valid === 0 ? 'disabled' : ''} onclick="Impor.lanjutKonfirmasi()">Lanjut Konfirmasi (${r.valid} baris valid)</button>
      </div>`;
  }

  function lanjutKonfirmasi() { state.langkah = 4; render(); }
  function renderKonfirmasi() {
    const validRows = state.hasil.filter(h => !h.errors.length).map(h => h.data);
    $('imporStepBody').innerHTML = `
      <div class="notice notice-amber mb-16"><i class="bi bi-exclamation-triangle"></i>Anda akan mengimpor <b>${validRows.length}</b> baris. ${
        state.tipe === 'order' ? 'Order akan berstatus "Perlu Konfirmasi" sampai dikonfirmasi Owner di halaman Piutang.'
        : state.tipe === 'pekerjaan' ? 'Baris tanpa unit akan ditandai "Unit Perlu Konfirmasi" pada halaman Pekerjaan.'
        : 'Kategori baru akan otomatis ditambahkan bila belum terdaftar.'
      }</div>
      <div class="gap-row">
        <button class="btn-pill btn-ghost" onclick="Impor.kembali()">Kembali</button>
        <button class="btn-pill btn-black" id="btnKomitImpor"><i class="bi bi-cloud-upload"></i> Simpan ke Google Sheets</button>
      </div>`;
    $('btnKomitImpor').addEventListener('click', async () => {
      const btn = $('btnKomitImpor'); btn.disabled = true; btn.textContent = 'Menyimpan...';
      const skema = SKEMA[state.tipe];
      const res = await Api.post(skema.commitAction, { baris: validRows, namaFile: state.namaFile });
      btn.disabled = false;
      if (!res.success) { showToast('err', 'Gagal', res.message); return; }
      Cache.invalidateAll();
      showToast('ok', 'Berhasil Diimpor', res.message);
      $('imporStepBody').innerHTML = `<div class="empty"><i class="bi bi-check-circle" style="color:var(--lime)"></i>${esc(res.message)}</div><button class="btn-pill btn-lime w-100 mt-12" onclick="Impor.mulai('${state.tipe}')">Impor File Lain</button>`;
    });
  }

  return { mulai, terapkanMapping, kembali, lanjutKonfirmasi, unduhTemplate };
})();
