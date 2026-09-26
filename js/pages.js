// ============================================================
// PAGES — render tiap modul. SPA: setiap fungsi hanya mengisi innerHTML div body-nya sendiri,
// TIDAK PERNAH reload halaman. Cache.get() dipakai supaya berpindah menu bolak-balik tidak
// mengambil ulang data yang epoch-nya belum berubah (Instant UX prinsip 3).
// ============================================================

const Pages = (() => {

  function filterRingkas() {
    return `<span class="caption">${fmtTgl(S.dari)} – ${fmtTgl(S.sampai)}${S.unitFilter ? ' · ' + (unitById(S.unitFilter) || {}).nama : ' · Semua Unit'}</span>`;
  }

  // ── DASHBOARD ──
  let chartTren = null;
  async function renderDashboard() {
    const key = 'dash_' + S.dari + '_' + S.sampai + '_' + S.unitFilter;
    // Data awal dari app.init() (prefetch saat login) dipakai sebagai isian cache pertama — instan, 0 request.
    if (!Cache.get(key) && S._initDashboard && S.dari === periodeIni() + '-01' && !S.unitFilter) {
      Cache.set(key, S._initDashboard);
    }
    await loadInto(key,
      () => Api.get('dashboard.get', { dari: S.dari, sampai: S.sampai, unit_id: S.unitFilter }),
      drawDashboard,
      () => { $('body-dashboard').innerHTML = `<div class="page-head"><div><h1>Dashboard</h1><div class="sub">Memuat...</div></div></div><div class="stat-grid mb-16">${skeletonKpi(3)}</div>${skeletonRows(3)}`; }
    );
  }

  function drawDashboard(d) {
    const el = $('body-dashboard');
    el.innerHTML = `
      <div class="page-head">
        <div><h1>Dashboard</h1><div class="sub">Omzet, Kas Diterima, dan Piutang dihitung terpisah — ${filterRingkas()}</div></div>
        <div class="gap-row no-print"><button class="btn-pill btn-lime" onclick="Pages.bukaFormOrder()"><i class="bi bi-plus-lg"></i> Order Baru</button></div>
      </div>
      <div class="grid-3 mb-16">
        <div class="kpi kpi-hero"><div class="kpi-label"><i class="bi bi-graph-up-arrow"></i> OMZET</div><div class="kpi-value">${rp(d.omzet)}</div><div class="kpi-note">${d.jumlahOrder} order · ${d.pcsJahit} pcs jahit · ${d.pcsSablon} pcs sablon${d.omzetPerluKonfirmasi ? '<br>+' + rp(d.omzetPerluKonfirmasi) + ' perlu konfirmasi (impor)' : ''}</div></div>
        <div class="kpi kpi-lime"><div class="kpi-label"><i class="bi bi-cash-coin"></i> KAS DITERIMA</div><div class="kpi-value">${rp(d.kasDiterima)}</div><div class="kpi-note">Dari tanggal bayar, bukan tanggal order</div></div>
        <div class="kpi kpi-white"><div class="kpi-label"><i class="bi bi-hourglass-split"></i> PIUTANG AKHIR</div><div class="kpi-value">${rp(d.piutangAkhir)}</div><div class="kpi-note">${d.orderBelumLunas} order belum lunas</div></div>
      </div>
      <div class="grid-3 mb-16">
        <div class="kpi kpi-small kpi-white"><div class="kpi-label">UPAH PRODUKSI</div><div class="kpi-value">${rp(d.upahProduksi)}</div></div>
        <div class="kpi kpi-small kpi-white"><div class="kpi-label">PENGELUARAN</div><div class="kpi-value">${rp(d.pengeluaran)}</div></div>
        <div class="kpi kpi-small kpi-white"><div class="kpi-label">MARGIN SEMENTARA</div><div class="kpi-value">${rp(d.marginSementara)}</div><div class="kpi-note">Omzet − Upah produksi (bukan laba bersih)</div></div>
      </div>
      <div class="row g-3 mb-16">
        <div class="col-12 col-lg-8">
          <div class="card-x" style="height:100%">
            <div class="card-title"><span class="h3">Tren Omzet vs Kas Diterima</span></div>
            <canvas id="trenChart" height="110"></canvas>
          </div>
        </div>
        <div class="col-12 col-lg-4">
          <div class="insight" style="min-height:100%">
            <h6><i class="bi bi-lightbulb-fill"></i> Sorotan</h6>
            <ul>${(d.insights || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
          </div>
        </div>
      </div>
      <div class="row g-3 mb-16">
        <div class="col-12 col-lg-6">
          <div class="card-x" style="height:100%">
            <div class="card-title"><span class="h3">Rekonsiliasi Piutang</span></div>
            <div class="recon">
              <span class="term">Awal ${rp(d.rekonsiliasi.awal)}</span><span class="op">+</span>
              <span class="term">Omzet ${rp(d.rekonsiliasi.omzet)}</span><span class="op">−</span>
              <span class="term">Kas ${rp(d.rekonsiliasi.kas)}</span><span class="op">=</span>
              <span class="term ${Math.abs(d.rekonsiliasi.selisih) < 1 ? 'recon-ok' : ''}">${rp(d.rekonsiliasi.akhir)}</span>
            </div>
            ${Math.abs(d.rekonsiliasi.selisih) >= 1 ? `<div class="notice notice-amber mt-12"><i class="bi bi-exclamation-triangle"></i>Selisih ${rp(d.rekonsiliasi.selisih)} — periksa data impor/konfirmasi.</div>` : ''}
          </div>
        </div>
        <div class="col-12 col-lg-6">
          <div class="card-x" style="height:100%">
            <div class="card-title"><span class="h3">Piutang Terbesar</span></div>
            ${d.topPiutang.length ? `<div class="kv-list">${d.topPiutang.map(p => `<div class="kv"><span class="k">${esc(p.nama)}</span><span class="v">${rp(p.sisa)} <span class="caption">(${p.umurMax}h)</span></span></div>`).join('')}</div>` : emptyState('bi-emoji-smile', 'Tidak ada piutang menonjol.')}
          </div>
        </div>
      </div>
      <div class="grid-3">
        ${d.perUnit.map(u => `<div class="card-x"><div class="card-title"><span class="h3">${chipUnit(u)}</span></div><div class="kv-list"><div class="kv"><span class="k">Omzet</span><span class="v">${rp(u.omzet)}</span></div><div class="kv"><span class="k">Kas Diterima</span><span class="v">${rp(u.kas)}</span></div><div class="kv"><span class="k">Piutang</span><span class="v">${rp(u.piutang)}</span></div></div></div>`).join('')}
      </div>`;
    try {
      if (chartTren) chartTren.destroy();
      chartTren = new Chart($('trenChart').getContext('2d'), {
        type: 'line',
        data: { labels: d.tren.labels, datasets: [
          { label: 'Omzet', data: d.tren.omzet, borderColor: '#0A0A0A', backgroundColor: 'rgba(10,10,10,0.06)', tension: .3, fill: true },
          { label: 'Kas Diterima', data: d.tren.kas, borderColor: '#8fae1c', backgroundColor: 'rgba(198,239,78,0.25)', tension: .3, fill: true }
        ] },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => nf(v) } } } }
      });
    } catch (e) { /* Chart.js gagal dimuat (offline) — abaikan, angka tetap tampil */ }
  }

  // ── ORDER ──
  let ordFilter = { q: '', status: '', jenis: '' };
  async function renderOrderList() {
    const el = $('body-order');
    el.innerHTML = `
      <div class="page-head">
        <div><h1>Order</h1><div class="sub">Jahit dan Sablon — ${filterRingkas()}</div></div>
        <div class="gap-row no-print"><button class="btn-pill btn-lime" onclick="Pages.bukaFormOrder()"><i class="bi bi-plus-lg"></i> Order Baru</button></div>
      </div>
      <div class="card-x mb-16"><div class="row g-2">
        <div class="col-12 col-md-5"><input id="ordQ" class="input-pill" type="search" placeholder="Cari no. order, pelanggan, jenis..." value="${esc(ordFilter.q)}"></div>
        <div class="col-6 col-md-3"><select id="ordStatus" class="select-pill">
          <option value="">Semua status bayar</option>
          ${['Belum Bayar', 'DP', 'Sebagian/Cicilan', 'Lunas', 'Perlu Konfirmasi'].map(s => `<option ${ordFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select></div>
        <div class="col-6 col-md-2"><select id="ordJenis" class="select-pill">
          <option value="">Jahit + Sablon</option><option value="Jahit" ${ordFilter.jenis === 'Jahit' ? 'selected' : ''}>Jahit</option><option value="Sablon" ${ordFilter.jenis === 'Sablon' ? 'selected' : ''}>Sablon</option>
        </select></div>
        <div class="col-12 col-md-2"><div class="caption" style="padding-top:14px" id="ordCount"></div></div>
      </div></div>
      <div class="card-x flush"><div id="orderListBody"></div></div>`;
    ['ordQ'].forEach(id => $(id).addEventListener('input', debounce(loadOrders, 350)));
    ['ordStatus', 'ordJenis'].forEach(id => $(id).addEventListener('change', loadOrders));
    loadOrders();
  }
  function drawOrderList(data) {
    $('ordCount').textContent = data.orders.length + (data.terpotong ? '+' : '') + ' order';
    const rowsD = data.orders.map(o => `<tr class="click" onclick="Pages.bukaOrderDetail('${o.id}')">
      <td>${fmtTglPendek(o.tanggal_order)}<span class="sub">${esc(o.no_order)}</span></td>
      <td>${chipUnit(o.unit_id)}</td>
      <td>${esc(o.pelanggan_nama)}<span class="sub">${esc(o.ringkas)}</span></td>
      <td class="r">${rp(o.nilai)}</td>
      <td>${chipStatus(o.status_bayar)}</td>
    </tr>`).join('');
    const rowsM = data.orders.map(o => `<div class="m-item" onclick="Pages.bukaOrderDetail('${o.id}')">
      <div class="r1"><div><div class="ttl">${esc(o.pelanggan_nama)}</div><div class="caption">${esc(o.no_order)} · ${fmtTglPendek(o.tanggal_order)}</div></div>${chipUnit(o.unit_id)}</div>
      <div class="r2"><div class="amt">${rp(o.nilai)}</div>${chipStatus(o.status_bayar)}</div></div>`).join('');
    $('orderListBody').innerHTML = data.orders.length
      ? tableResponsive('<th>Tanggal</th><th>Unit</th><th>Pelanggan</th><th class="r">Nilai</th><th>Status</th>', rowsD, rowsM)
      + `<div class="soft-well" style="margin:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px"><span>Total nilai: <b>${rp(data.ringkasan.nilai)}</b></span><span>Dibayar: <b>${rp(data.ringkasan.dibayar)}</b></span><span>Sisa: <b>${rp(data.ringkasan.sisa)}</b></span></div>`
      : emptyState('bi-receipt', 'Belum ada order pada filter ini.');
  }
  async function loadOrders() {
    ordFilter = { q: $('ordQ').value, status: $('ordStatus').value, jenis: $('ordJenis').value };
    const params = { dari: S.dari, sampai: S.sampai, unit_id: S.unitFilter, q: ordFilter.q, status: ordFilter.status, jenis: ordFilter.jenis };
    const key = 'ordlist_' + JSON.stringify(params);
    await loadInto(key, () => Api.get('order.list', params), drawOrderList, () => { $('orderListBody').innerHTML = skeletonRows(6); });
  }

  function itemCardHtml(idx, it) {
    it = it || { tipe: 'Jahit', jenis_tinta: '', deskripsi: '', warna: 1, qty: 1 };
    const jahitOpts = (S.master.hargaJahit || []).filter(h => h.unit_id === $('ofUnit') ? $('ofUnit').value : true);
    return `<div class="item-card" data-idx="${idx}">
      <div class="row g-2 align-items-end">
        <div class="col-12 col-md-2"><label class="lbl">Tipe</label>
          <div class="seg"><button type="button" class="${it.tipe === 'Jahit' ? 'on' : ''}" onclick="Pages.setItemTipe(${idx},'Jahit')">Jahit</button><button type="button" class="${it.tipe === 'Sablon' ? 'on' : ''}" onclick="Pages.setItemTipe(${idx},'Sablon')">Sablon</button></div>
        </div>
        <div class="col-12 col-md-3"><label class="lbl">${it.tipe === 'Sablon' ? 'Jenis Tinta' : 'Jenis Jahitan'}</label>
          ${it.tipe === 'Sablon'
            ? `<select class="select-pill it-jenis" onchange="Pages.hitungBaris(${idx})"><option value="">Pilih...</option>${['Waterbase', 'Dischager', 'Plastisol'].map(t => `<option ${it.jenis_tinta === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`
            : `<select class="select-pill it-jenis" onchange="Pages.hitungBaris(${idx})"><option value="">Pilih...</option>${(S.master.hargaJahit || []).map(h => h.jenis).filter((v, i, a) => a.indexOf(v) === i).map(j => `<option ${it.jenis_tinta === j ? 'selected' : ''}>${j}</option>`).join('')}</select>`}
        </div>
        <div class="col-6 col-md-2"><label class="lbl">Deskripsi</label><input class="input-pill it-desk" value="${esc(it.deskripsi)}"></div>
        ${it.tipe === 'Sablon' ? `<div class="col-6 col-md-2"><label class="lbl">Jumlah Warna</label><input type="number" min="1" class="input-pill it-warna" value="${it.warna || 1}" onchange="Pages.hitungBaris(${idx})"></div>` : ''}
        <div class="col-6 col-md-2"><label class="lbl">Qty (pcs)</label><input type="number" min="1" class="input-pill it-qty" value="${it.qty || 1}" onchange="Pages.hitungBaris(${idx})"></div>
        <div class="col-6 col-md-1 text-end"><button type="button" class="btn-icon-sm" onclick="Pages.hapusBarisItem(${idx})" title="Hapus baris"><i class="bi bi-trash"></i></button></div>
      </div>
      <div class="calc-line it-calc">—</div>
    </div>`;
  }

  let ofItems = [], ofEditingId = null;
  async function bukaFormOrder(id) {
    ofEditingId = id || null;
    // Instant UX: pindah section & tampil DULU (shell/skeleton), baru ambil data — bukan menunggu
    // dulu baru berpindah. Kalau detail order ini sudah pernah dibuka (cache 'orddet_'+id dari
    // bukaOrderDetail), langsung pakai itu — 0 request untuk buka form Ubah Order.
    App.navigateTo('orderForm');
    let order = id ? Cache.get('orddet_' + id) : null;
    if (id && !order) {
      $('body-orderForm').innerHTML = skeletonRows(6);
      const res = await Api.get('order.detail', { id });
      if (!res.success) { showToast('err', 'Gagal', res.message); App.navigateTo('order'); return; }
      order = res.data;
    }
    ofItems = order ? order.items.map(i => Object.assign({}, i)) : [{ tipe: 'Jahit', jenis_tinta: '', deskripsi: '', warna: 1, qty: 1 }];
    const el = $('body-orderForm');
    el.innerHTML = `
      <div class="page-head"><div><h1>${order ? 'Ubah Order ' + esc(order.no_order) : 'Order Baru'}</h1><div class="sub">Harga dan upah dihitung otomatis dan disimpan sebagai snapshot — perubahan Harga Aktif di kemudian hari tidak memengaruhi order ini.</div></div>
        <button class="btn-pill btn-ghost" onclick="App.navigateTo('order')"><i class="bi bi-arrow-left"></i> Kembali</button></div>
      <div class="card-x mb-16"><div class="form-grid">
        <div class="field"><label>Tanggal Order</label><input id="ofTanggal" type="date" class="input-pill" value="${order ? order.tanggal_order : todayYmd()}"></div>
        <div class="field"><label>Unit</label><select id="ofUnit" class="select-pill">${(S.master.units || []).map(u => `<option value="${u.id}" ${order && order.unit_id === u.id ? 'selected' : ''}>${esc(u.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Pelanggan</label><input id="ofPelanggan" class="input-pill" list="dlPelanggan" value="${order ? esc(order.pelanggan_nama) : ''}" placeholder="Ketik nama — otomatis dibuat bila belum ada"></div>
        <div class="field"><label>Keterangan</label><input id="ofKet" class="input-pill" value="${order ? esc(order.keterangan) : ''}"></div>
      </div>
      <datalist id="dlPelanggan">${(S.master.pelanggan || []).map(p => `<option value="${esc(p.nama)}">`).join('')}</datalist></div>
      <div class="card-x mb-16"><div class="card-title"><span class="h3">Baris Order</span><button type="button" class="btn-pill btn-ghost sm" onclick="Pages.tambahBarisItem()"><i class="bi bi-plus"></i> Tambah Baris</button></div>
        <div id="ofItemsWrap">${ofItems.map((it, i) => itemCardHtml(i, it)).join('')}</div>
      </div>
      ${!order ? `<div class="card-x mb-16"><div class="card-title"><span class="h3">Pembayaran Awal (opsional)</span></div><div class="form-grid">
        <div class="field"><label>Jumlah</label><input id="ofDp" type="number" class="input-pill" placeholder="0"></div>
        <div class="field"><label>Metode</label><select id="ofDpMetode" class="select-pill"><option>Tunai</option><option>Transfer</option><option>Lainnya</option></select></div>
      </div></div>` : ''}
      <div class="total-bar"><div><div class="lbl-s">Total Nilai Order</div><div class="tot" id="ofTotal">Rp 0</div></div><button class="btn-pill btn-lime" id="btnSimpanOrder" onclick="Pages.simpanOrder()">Simpan Order</button></div>`;
    ofItems.forEach((it, i) => hitungBaris(i));
  }
  function setItemTipe(idx, tipe) { ofItems[idx].tipe = tipe; ofItems[idx].jenis_tinta = ''; refreshItemCard(idx); }
  function tambahBarisItem() { ofItems.push({ tipe: 'Jahit', jenis_tinta: '', deskripsi: '', warna: 1, qty: 1 }); document.getElementById('ofItemsWrap').insertAdjacentHTML('beforeend', itemCardHtml(ofItems.length - 1, ofItems[ofItems.length - 1])); }
  function hapusBarisItem(idx) { if (ofItems.length <= 1) { showToast('warn', 'Tidak bisa', 'Minimal satu baris order.'); return; } ofItems.splice(idx, 1); document.getElementById('ofItemsWrap').innerHTML = ofItems.map((it, i) => itemCardHtml(i, it)).join(''); ofItems.forEach((it, i) => hitungBaris(i)); }
  function refreshItemCard(idx) { const wrap = document.querySelectorAll('.item-card')[idx]; wrap.outerHTML = itemCardHtml(idx, ofItems[idx]); hitungBaris(idx); }
  function bacaBarisDariDom(idx) {
    const card = document.querySelectorAll('.item-card')[idx];
    const it = ofItems[idx];
    it.jenis_tinta = card.querySelector('.it-jenis').value;
    it.deskripsi = card.querySelector('.it-desk').value;
    it.qty = Math.max(1, Math.floor(Number(card.querySelector('.it-qty').value) || 1));
    if (it.tipe === 'Sablon') it.warna = Math.max(1, Math.floor(Number(card.querySelector('.it-warna').value) || 1));
    return it;
  }
  function hitungBaris(idx) {
    const it = bacaBarisDariDom(idx);
    const card = document.querySelectorAll('.item-card')[idx];
    let harga = 0, upah = 0, ket = 'Pilih jenis untuk melihat harga.';
    if (it.tipe === 'Sablon' && it.jenis_tinta) {
      const hs = (S.master.hargaSablon || []).filter(x => x.tinta === it.jenis_tinta)[0];
      const us = (S.master.upahSablon || []).filter(x => x.tinta === it.jenis_tinta)[0];
      if (hs && us) { harga = hs.harga_dasar + (it.warna - 1) * hs.harga_tambahan_warna; upah = us.upah_dasar + (it.warna - 1) * us.upah_tambahan_warna; ket = `Harga ${rp(harga)}/pcs (rumus dasar+(warna−1)×tambahan) · Upah ${rp(upah)}/pcs`; }
    } else if (it.tipe === 'Jahit' && it.jenis_tinta) {
      const unitId = $('ofUnit').value;
      const hj = (S.master.hargaJahit || []).filter(x => x.unit_id === unitId && x.jenis === it.jenis_tinta)[0];
      const uj = (S.master.upahJahit || []).filter(x => x.jenis === it.jenis_tinta)[0];
      harga = hj ? Number(hj.harga_aktif) || 0 : 0; upah = uj ? Number(uj.upah_aktif) || 0 : 0;
      ket = harga ? `Harga Aktif ${rp(harga)}/pcs · Upah ${rp(upah)}/pcs` : 'Harga Aktif belum ditetapkan Owner — hubungi Owner di Master Harga.';
    }
    card.querySelector('.it-calc').innerHTML = `<span>${ket}</span><span>Subtotal <b>${rp(harga * it.qty)}</b></span>`;
    hitungTotalOrder();
  }
  function hitungTotalOrder() {
    let total = 0;
    document.querySelectorAll('.item-card').forEach((card, i) => {
      const it = ofItems[i]; if (!it || !it.jenis_tinta) return;
      let harga = 0;
      if (it.tipe === 'Sablon') { const hs = (S.master.hargaSablon || []).filter(x => x.tinta === it.jenis_tinta)[0]; if (hs) harga = hs.harga_dasar + (it.warna - 1) * hs.harga_tambahan_warna; }
      else { const hj = (S.master.hargaJahit || []).filter(x => x.unit_id === $('ofUnit').value && x.jenis === it.jenis_tinta)[0]; if (hj) harga = Number(hj.harga_aktif) || 0; }
      total += harga * it.qty;
    });
    $('ofTotal').textContent = rp(total);
  }
  async function simpanOrder() {
    document.querySelectorAll('.item-card').forEach((c, i) => bacaBarisDariDom(i));
    const payload = {
      id: ofEditingId, tanggal_order: $('ofTanggal').value, unit_id: $('ofUnit').value,
      pelanggan_nama: $('ofPelanggan').value, keterangan: $('ofKet').value,
      items: ofItems.map(it => ({ id: it.id, tipe: it.tipe, jenis_tinta: it.jenis_tinta, deskripsi: it.deskripsi, warna: it.warna, qty: it.qty, karyawan_id: it.karyawan_id || '' }))
    };
    if ($('ofDp') && Number($('ofDp').value) > 0) payload.pembayaran_awal = { jumlah: Number($('ofDp').value), metode: $('ofDpMetode').value, jenis: 'DP' };
    const btn = $('btnSimpanOrder'); const asal = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin spin-sm"></span> Menyimpan...'; }
    let res;
    try { res = await Api.post('order.simpan', payload); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = asal; } }
    if (!res.success) { showToast('err', 'Gagal', res.message); return; }
    // Satu request = satu transaksi. Invalidasi hanya cache yang terdampak (bukan seluruh cache),
    // lalu langsung ke Detail Order — TIDAK reload halaman.
    Cache.invalidateMany(['ordlist_', 'orddet_', 'dash_', 'piutang_', 'pekerjaan_', 'rekap_', 'lap_']);
    showToast('ok', 'Tersimpan', res.message);
    bukaOrderDetail(res.data.id);
  }

  let orderDetailId = null;
  async function bukaOrderDetail(id) {
    orderDetailId = id;
    App.navigateTo('orderDetail');
    await loadInto('orddet_' + id, () => Api.get('order.detail', { id }), drawOrderDetail, () => { $('body-orderDetail').innerHTML = skeletonRows(6); });
  }
  function drawOrderDetail(o) {
    const bisaHapus = o.pembayaran.length === 0;
    $('body-orderDetail').innerHTML = `
      <div class="page-head"><div><h1>${esc(o.no_order)}</h1><div class="sub">${esc(o.pelanggan_nama)} · ${chipUnit(o.unit_id)} · ${fmtTgl(o.tanggal_order)}</div></div>
        <button class="btn-pill btn-ghost" onclick="App.navigateTo('order')"><i class="bi bi-arrow-left"></i> Kembali</button></div>
      ${o.status_konfirmasi === 'Perlu Konfirmasi' ? `<div class="notice notice-amber mb-16"><i class="bi bi-exclamation-triangle"></i>Order hasil impor — berstatus <b>Perlu Konfirmasi</b>. Konfirmasi dahulu di halaman Piutang sebelum mencatat pembayaran baru.</div>` : ''}
      <div class="detail-grid mb-16">
        <div class="cell"><div class="k">Nilai</div><div class="v">${rp(o.nilai)}</div></div>
        <div class="cell"><div class="k">Dibayar</div><div class="v">${rp(o.dibayar)}</div></div>
        <div class="cell"><div class="k">Sisa</div><div class="v">${rp(o.sisa)}</div></div>
        <div class="cell"><div class="k">Upah Produksi</div><div class="v">${rp(o.upah)}</div></div>
        <div class="cell"><div class="k">Status</div><div class="v">${chipStatus(o.status_bayar)}</div></div>
      </div>
      <div class="card-x mb-16 flush"><table class="tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Harga</th><th class="r">Subtotal</th></tr></thead><tbody>
        ${o.items.map(i => `<tr><td>${esc(i.jenis_tinta)}${i.tipe === 'Sablon' ? ' (' + i.warna + ' warna)' : ''}<span class="sub">${esc(i.deskripsi)} · ${esc(i.harga_sumber)}</span></td><td class="r">${i.qty}</td><td class="r">${rp(i.harga_snapshot)}</td><td class="r">${rp(i.subtotal)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="card-x mb-16">
        <div class="card-title"><span class="h3">Riwayat Pembayaran</span>${o.sisa > 0 && o.status_konfirmasi !== 'Perlu Konfirmasi' ? `<button class="btn-pill btn-lime sm" onclick="Pages.bukaModalBayar('${o.id}',${o.sisa},'${o.tanggal_order}')"><i class="bi bi-plus"></i> Catat Pembayaran</button>` : ''}</div>
        ${o.pembayaran.length ? `<div class="kv-list">${o.pembayaran.map(p => `<div class="kv"><span class="k">${fmtTgl(p.tanggal_bayar)} · ${esc(p.metode)} · ${esc(p.jenis)}</span><span class="v">${rp(p.jumlah)} ${isOwner() ? `<button class="btn-icon-sm" style="width:24px;height:24px" onclick="Pages.hapusBayar('${p.id}')"><i class="bi bi-x"></i></button>` : ''}</span></div>`).join('')}</div>` : emptyState('bi-cash', 'Belum ada pembayaran.')}
      </div>
      <div class="gap-row no-print">
        <button class="btn-pill btn-ghost" onclick="Pages.bukaFormOrder('${o.id}')"><i class="bi bi-pencil"></i> Ubah Order</button>
        ${isOwner() ? `<button class="btn-pill btn-danger-x" ${!bisaHapus ? 'disabled title="Sudah ada pembayaran"' : ''} onclick="Pages.hapusOrder('${o.id}')"><i class="bi bi-trash"></i> Hapus Order</button>` : ''}
      </div>`;
  }

  function bukaModalBayar(orderId, sisa, tanggalOrder) {
    $('bayarBody').innerHTML = `
      <div class="field mb-16"><label>Jumlah (sisa ${rp(sisa)})</label><input id="byJumlah" type="number" class="input-pill" value="${sisa}"></div>
      <div class="form-grid">
        <div class="field"><label>Tanggal Bayar</label><input id="byTanggal" type="date" class="input-pill" min="${tanggalOrder}" value="${todayYmd() < tanggalOrder ? tanggalOrder : todayYmd()}"></div>
        <div class="field"><label>Metode</label><select id="byMetode" class="select-pill"><option>Tunai</option><option>Transfer</option><option>Lainnya</option></select></div>
      </div>
      <div class="field mt-12"><label>Keterangan (opsional)</label><input id="byKet" class="input-pill"></div>`;
    const btn = $('bayarSimpan'); const baru = btn.cloneNode(true); btn.parentNode.replaceChild(baru, btn);
    baru.addEventListener('click', async () => {
      const jumlah = Number($('byJumlah').value);
      const jenis = jumlah >= sisa ? 'Pelunasan' : 'Cicilan';
      baru.disabled = true;
      const res = await Api.post('bayar.tambah', { order_id: orderId, jumlah: jumlah, tanggal_bayar: $('byTanggal').value, metode: $('byMetode').value, jenis: jenis, keterangan: $('byKet').value });
      baru.disabled = false;
      if (!res.success) { showToast('err', 'Gagal', res.message); return; }
      Cache.invalidateAll(); M('modalBayar').hide(); showToast('ok', 'Tersimpan', res.message); bukaOrderDetail(orderId);
    });
    M('modalBayar').show();
  }
  function hapusBayar(id) {
    konfirmasi('Hapus Pembayaran', '<p>Yakin ingin menghapus pembayaran ini? Sisa tagihan akan bertambah kembali.</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('bayar.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Terhapus', res.message); if (orderDetailId) bukaOrderDetail(orderDetailId);
    });
  }
  function hapusOrder(id) {
    konfirmasi('Hapus Order', '<p>Yakin ingin menghapus order ini? Tindakan ini hanya untuk Owner dan tidak dapat dibatalkan.</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('order.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Terhapus', res.message); App.navigateTo('order');
    });
  }

  // ── PIUTANG ──
  async function renderPiutang() {
    const el = $('body-piutang');
    el.innerHTML = `
      <div class="page-head"><div><h1>Piutang</h1><div class="sub">Sisa tagihan yang belum dibayar, per tanggal yang dipilih.</div></div>
        <div class="gap-row no-print" style="max-width:520px">
          <input id="ptTanggal" class="input-pill sm" type="date" value="${todayYmd()}" style="width:170px">
          <input id="ptQ" class="input-pill sm" type="search" placeholder="Cari pelanggan / no. order" style="width:220px">
        </div></div>
      <div id="piutangBody"></div>`;
    $('ptTanggal').addEventListener('change', loadPiutang);
    $('ptQ').addEventListener('input', debounce(loadPiutang, 300));
    loadPiutang();
  }
  function drawPiutang(data) {
    const rowsD = data.baris.map(o => `<tr class="click" onclick="Pages.bukaOrderDetail('${o.id}')">
      <td>${esc(o.no_order)}<span class="sub">${fmtTglPendek(o.tanggal_order)} · umur ${o.umur}h</span></td>
      <td>${chipUnit(o.unit_id)}</td><td>${esc(o.pelanggan_nama)}</td>
      <td class="r">${rp(o.sisa_per)}</td><td>${o.bucket}</td></tr>`).join('');
    const rowsM = data.baris.map(o => `<div class="m-item" onclick="Pages.bukaOrderDetail('${o.id}')"><div class="r1"><div><div class="ttl">${esc(o.pelanggan_nama)}</div><div class="caption">${esc(o.no_order)} · umur ${o.umur}h</div></div>${chipUnit(o.unit_id)}</div><div class="r2"><div class="amt">${rp(o.sisa_per)}</div><span class="chip chip-piutang">${o.bucket}</span></div></div>`).join('');
    $('piutangBody').innerHTML = `
      ${data.perluKonfirmasi.jumlah ? `<div class="card-x mb-16 notice-amber" style="border:1px dashed var(--amber)">
        <div class="card-title"><span class="h3"><i class="bi bi-exclamation-triangle"></i> ${data.perluKonfirmasi.jumlah} Order Impor Perlu Konfirmasi (${rp(data.perluKonfirmasi.nilai)})</span>
        ${isOwner() ? `<button class="btn-pill btn-black sm" onclick="Pages.konfirmasiImpor()"><i class="bi bi-check2-all"></i> Konfirmasi Semua</button>` : ''}</div>
        <div class="caption">Order dari impor Excel tidak dihitung sebagai Kas maupun Piutang sampai dikonfirmasi Owner.</div>
      </div>` : ''}
      <div class="grid-3 mb-16">
        <div class="kpi kpi-hero kpi-small"><div class="kpi-label">TOTAL PIUTANG</div><div class="kpi-value">${rp(data.total)}</div><div class="kpi-note">${data.jumlahOrder} order</div></div>
        <div class="card-x kpi-small" style="grid-column: span 2">
          <div class="aging">${Object.keys(data.bucket).map(b => `<div class="aging-row"><span class="caption">${b}</span><div class="aging-track"><span style="width:${data.total ? Math.round(data.bucket[b] / data.total * 100) : 0}%"></span></div><b class="mono">${rp(data.bucket[b])}</b></div>`).join('')}</div>
        </div>
      </div>
      <div class="card-x flush">${data.baris.length ? tableResponsive('<th>No. Order</th><th>Unit</th><th>Pelanggan</th><th class="r">Sisa</th><th>Umur</th>', rowsD, rowsM) : emptyState('bi-emoji-smile', 'Tidak ada piutang pada tanggal ini.')}</div>`;
  }
  async function loadPiutang() {
    const sampai = $('ptTanggal').value, q = $('ptQ').value;
    const key = 'piutang_' + sampai + '_' + q + '_' + S.unitFilter;
    await loadInto(key, () => Api.get('piutang.get', { sampai, q, unit_id: S.unitFilter }), drawPiutang, () => { $('piutangBody').innerHTML = skeletonRows(5); });
  }
  function konfirmasiImpor() {
    konfirmasi('Konfirmasi Order Impor', '<p>Konfirmasi semua order impor yang berstatus "Perlu Konfirmasi" sebagai data yang sah?</p><div class="field mt-12"><label><input type="checkbox" id="ciLunas"> Tandai semua langsung Lunas (sesuai catatan Excel lama)</label></div>', 'Ya, Konfirmasi', async () => {
      const resPiutang = await Api.get('piutang.get', { sampai: todayYmd(), unit_id: S.unitFilter });
      const ids = resPiutang.data.perluKonfirmasi.orders.map(o => o.id);
      const res = await Api.post('order.konfirmasi', { ids, tandaiLunas: $('ciLunas').checked }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Dikonfirmasi', res.message); renderPiutang();
    });
  }

  // ── KARYAWAN + VENDOR ──
  let karyawanTab = 'karyawan';
  async function renderKaryawan() {
    const el = $('body-karyawan');
    el.innerHTML = `
      <div class="page-head"><div><h1>Karyawan</h1><div class="sub">Data karyawan, skema upah, dan vendor luar.</div></div>
        <button class="btn-pill btn-lime" onclick="${karyawanTab === 'karyawan' ? 'Pages.formKaryawan()' : 'Pages.formVendor()'}"><i class="bi bi-plus-lg"></i> Tambah</button></div>
      <div class="mb-16"><div class="tabs-pill">
        <button class="${karyawanTab === 'karyawan' ? 'on' : ''}" onclick="Pages.karyawanTabGo('karyawan')">Karyawan</button>
        <button class="${karyawanTab === 'vendor' ? 'on' : ''}" onclick="Pages.karyawanTabGo('vendor')">Vendor</button>
      </div></div>
      <div id="karyawanTabBody"></div>`;
    karyawanTab === 'karyawan' ? loadKaryawanList() : loadVendorList();
  }
  function karyawanTabGo(t) { karyawanTab = t; renderKaryawan(); }

  function drawKaryawanList(data) {
    const rowsD = data.map(k => `<tr class="click" onclick='Pages.formKaryawan(${jsAttr(k.id)})'>
      <td>${esc(k.nama)}<span class="sub">${esc(k.peran)}</span></td><td>${esc(k.skema)}</td>
      <td class="r">${k.tarif_harian_berlaku ? rp(k.tarif_harian_berlaku) + '/hari' : '—'}</td>
      <td>${esc(k.alokasi_metode)}</td></tr>`).join('');
    const rowsM = data.map(k => `<div class="m-item" onclick='Pages.formKaryawan(${jsAttr(k.id)})'><div class="r1"><div><div class="ttl">${esc(k.nama)}</div><div class="caption">${esc(k.peran)} · ${esc(k.skema)}</div></div></div><div class="r2"><div class="amt">${k.tarif_harian_berlaku ? rp(k.tarif_harian_berlaku) : '—'}</div></div></div>`).join('');
    $('karyawanTabBody').innerHTML = `<div class="card-x flush">${data.length ? tableResponsive('<th>Nama</th><th>Skema</th><th class="r">Tarif Harian</th><th>Alokasi Gaji</th>', rowsD, rowsM) : emptyState('bi-people', 'Belum ada karyawan.')}</div>`;
  }
  async function loadKaryawanList() {
    await loadInto('karyawan_list', () => Api.get('karyawan.list', {}), drawKaryawanList, () => { $('karyawanTabBody').innerHTML = skeletonRows(5); });
  }
  function formKaryawan(id) {
    const k = id ? (Cache.get('karyawan_list') || []).filter(x => x.id === id)[0] : null;
    if (id && !isOwner()) { showToast('warn', 'Hanya Owner', 'Hanya Owner yang dapat mengubah data karyawan.'); return; }
    const unitOpts = (S.master.units || []).map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('');
    openForm(k ? 'Ubah Karyawan' : 'Karyawan Baru', `
      <div class="form-grid">
        <div class="field"><label>Nama</label><input id="kNama" class="input-pill" value="${k ? esc(k.nama) : ''}"></div>
        <div class="field"><label>Peran</label><input id="kPeran" class="input-pill" value="${k ? esc(k.peran) : ''}" placeholder="Tukang jahit, Sablon, Helper..."></div>
        <div class="field"><label>Skema Upah</label><select id="kSkema" class="select-pill">${['Harian', 'Borongan', 'Borongan + Lembur', 'Gaji Pokok + Lembur'].map(s => `<option ${k && k.skema === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="field"><label>Tarif Harian Aktif</label><input id="kTarif" type="number" class="input-pill" value="${k ? k.tarif_harian_aktif || '' : ''}" placeholder="${k ? k.tarif_harian_excel : '0'}"></div>
        <div class="field"><label>Metode Alokasi Gaji ke Unit</label><select id="kAlokasi" class="select-pill" onchange="Pages.toggleAlokasiFields()">${['Belum Dialokasikan', 'Biaya Bersama', 'Persentase', 'Manual'].map(m => `<option ${k && k.alokasi_metode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      </div>
      <div id="kAlokasiFields" class="mt-12"></div>
      <div class="notice notice-neutral mt-12"><i class="bi bi-info-circle"></i>Upah borongan otomatis mengikuti unit pekerjaannya. Upah harian/pokok dibagi menurut metode alokasi di atas — "Belum Dialokasikan" sementara dicatat sebagai Biaya Bersama (PERLU KONFIRMASI Owner).</div>
      ${k ? `<div class="field mt-12"><label><input type="checkbox" id="kAktif" ${k.aktif !== false ? 'checked' : ''}> Aktif</label></div>` : ''}`,
      async () => {
        const metode = $('kAlokasi').value;
        let alokasi_json = {};
        if (metode === 'Persentase' || metode === 'Manual') { (S.master.units || []).forEach(u => { const v = $('kAlok_' + u.id); if (v && Number(v.value) > 0) alokasi_json[u.id] = Number(v.value); }); }
        const payload = { id: k ? k.id : undefined, nama: $('kNama').value, peran: $('kPeran').value, skema: $('kSkema').value, tarif_harian_aktif: $('kTarif').value, tarif_harian_excel: k ? undefined : $('kTarif').value, alokasi_metode: metode, alokasi_json: alokasi_json, aktif: k ? $('kAktif').checked : true };
        const res = await Api.post('karyawan.simpan', payload); if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidateMany(['karyawan_list', 'gajiproses_', 'gajiriwayat_']); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadKaryawanList();
      });
    toggleAlokasiFields(k);
  }
  function toggleAlokasiFields(k) {
    const metode = $('kAlokasi').value;
    const wrap = $('kAlokasiFields');
    if (metode !== 'Persentase' && metode !== 'Manual') { wrap.innerHTML = ''; return; }
    const existing = k ? k.alokasi_json || {} : {};
    wrap.innerHTML = `<div class="soft-well"><label class="lbl">${metode === 'Persentase' ? 'Persentase per unit (total 100%)' : 'Nominal manual per unit (Rp, per periode gaji)'}</label>
      <div class="form-grid">${(S.master.units || []).map(u => `<div class="field"><label>${esc(u.nama)}</label><input id="kAlok_${u.id}" type="number" class="input-pill sm" value="${existing[u.id] || ''}"></div>`).join('')}</div></div>`;
  }
  function hapusKaryawan(id) {
    konfirmasi('Hapus Karyawan', '<p>Data historis (Pekerjaan/Gaji/Kasbon) tetap tersimpan. Lanjutkan?</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('karyawan.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateMany(['karyawan_list', 'gajiproses_', 'gajiriwayat_']); showToast('ok', 'Terhapus', res.message); loadKaryawanList();
    });
  }

  function drawVendorList(data) {
    const rowsD = data.map(v => `<tr class="click" onclick='Pages.formVendor(${jsAttr(v.id)})'><td>${esc(v.nama)}</td><td>${esc(v.jenis)}</td><td>${esc(v.telepon)}</td></tr>`).join('');
    const rowsM = data.map(v => `<div class="m-item" onclick='Pages.formVendor(${jsAttr(v.id)})'><div class="r1"><div class="ttl">${esc(v.nama)}</div></div><div class="r2"><span class="caption">${esc(v.jenis)}</span></div></div>`).join('');
    $('karyawanTabBody').innerHTML = `<div class="card-x flush">${data.length ? tableResponsive('<th>Nama</th><th>Jenis</th><th>Telepon</th>', rowsD, rowsM) : emptyState('bi-truck', 'Belum ada vendor.')}</div>`;
  }
  async function loadVendorList() {
    await loadInto('vendor_list', () => Api.get('vendor.list', {}), drawVendorList, () => { $('karyawanTabBody').innerHTML = skeletonRows(5); });
  }
  function formVendor(id) {
    const v = id ? (Cache.get('vendor_list') || []).filter(x => x.id === id)[0] : null;
    openForm(v ? 'Ubah Vendor' : 'Vendor Baru', `
      <div class="field mb-16"><label>Nama</label><input id="vNama" class="input-pill" value="${v ? esc(v.nama) : ''}"></div>
      <div class="field mb-16"><label>Jenis</label><input id="vJenis" class="input-pill" value="${v ? esc(v.jenis) : ''}" placeholder="Penjahit luar, Bahan, dll"></div>
      <div class="field"><label>Telepon</label><input id="vTelp" class="input-pill" value="${v ? esc(v.telepon) : ''}"></div>
      ${v && isOwner() ? `<button type="button" class="btn-pill btn-danger-x mt-12" onclick='Pages.hapusVendor(${jsAttr(v.id)})'><i class="bi bi-trash"></i> Hapus Vendor</button>` : ''}`,
      async () => {
        const res = await Api.post('vendor.simpan', { id: v ? v.id : undefined, nama: $('vNama').value, jenis: $('vJenis').value, telepon: $('vTelp').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidatePrefix('vendor_list'); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadVendorList();
      });
  }
  function hapusVendor(id) {
    M('modalForm').hide();
    konfirmasi('Hapus Vendor', '<p>Yakin ingin menghapus vendor ini?</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('vendor.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidatePrefix('vendor_list'); showToast('ok', 'Terhapus', res.message); loadVendorList();
    });
  }

  // ── PEKERJAAN (borongan manual, di luar Order) ──
  async function renderPekerjaan() {
    const el = $('body-pekerjaan');
    el.innerHTML = `
      <div class="page-head"><div><h1>Pekerjaan</h1><div class="sub">Catatan borongan/produksi karyawan — baris dari Order tercatat otomatis di sini.</div></div>
        <div class="gap-row">
          ${isOwner() ? `<button class="btn-pill btn-ghost" onclick="Pages.imporTabGo('pekerjaan')"><i class="bi bi-file-earmark-arrow-up"></i> Import Excel</button>` : ''}
          <button class="btn-pill btn-lime" onclick="Pages.formPekerjaan()"><i class="bi bi-plus-lg"></i> Catat Pekerjaan</button>
        </div></div>
      <div id="pekerjaanBody"></div>`;
    loadPekerjaan();
  }
  function drawPekerjaan(data) {
    const rowsD = data.list.map(r => `<tr>
      <td>${fmtTglPendek(r.tanggal)}</td><td>${esc(r.karyawan_nama)}</td><td>${r.unit_id ? chipUnit(r.unit_id) : '<span class="chip chip-konfirmasi">Belum ditentukan</span>'}</td>
      <td>${esc(r.jenis_tinta)}${r.tipe === 'Sablon' ? ' (' + r.warna + 'w)' : ''} ×${r.qty}</td><td class="r">${rp(r.total_upah)}</td>
      <td>${r.otomatis ? '<span class="chip chip-neutral">Otomatis</span>' : (isOwner() ? `<button class="btn-icon-sm" onclick="Pages.hapusPekerjaan('${r.id}')"><i class="bi bi-trash"></i></button>` : '')}</td></tr>`).join('');
    $('pekerjaanBody').innerHTML = `<div class="card-x mb-16"><div class="kv"><span class="k">Total upah periode ini</span><span class="v h3">${rp(data.totalUpah)}</span></div></div>
      <div class="card-x flush">${data.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Karyawan</th><th>Unit</th><th>Pekerjaan</th><th class="r">Upah</th><th></th></tr></thead><tbody>${rowsD}</tbody></table></div>` : emptyState('bi-scissors', 'Belum ada pekerjaan pada periode ini.')}</div>`;
  }
  async function loadPekerjaan() {
    const key = 'pekerjaan_' + S.dari + '_' + S.sampai + '_' + S.unitFilter;
    await loadInto(key, () => Api.get('pekerjaan.list', { dari: S.dari, sampai: S.sampai, unit_id: S.unitFilter }), drawPekerjaan, () => { $('pekerjaanBody').innerHTML = skeletonRows(6); });
  }
  function formPekerjaan() {
    openForm('Catat Pekerjaan Borongan', `
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input id="pkTgl" type="date" class="input-pill" value="${todayYmd()}"></div>
        <div class="field"><label>Karyawan</label><select id="pkKar" class="select-pill">${(S.master.karyawan || []).map(k => `<option value="${k.id}">${esc(k.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Unit (kosongkan bila belum jelas)</label><select id="pkUnit" class="select-pill"><option value="">— Belum ditentukan —</option>${(S.master.units || []).map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Tipe</label><select id="pkTipe" class="select-pill"><option>Jahit</option><option>Sablon</option><option>Lainnya</option></select></div>
        <div class="field"><label>Deskripsi Pekerjaan</label><input id="pkDesk" class="input-pill" placeholder="mis. Motong kain"></div>
        <div class="field"><label>Qty</label><input id="pkQty" type="number" class="input-pill" value="1"></div>
        <div class="field"><label>Upah per Satuan</label><input id="pkUpah" type="number" class="input-pill" placeholder="0"></div>
      </div>
      <div class="field mt-12"><label>Keterangan</label><input id="pkKet" class="input-pill"></div>`,
      async () => {
        const res = await Api.post('pekerjaan.simpan', { tanggal: $('pkTgl').value, karyawan_id: $('pkKar').value, unit_id: $('pkUnit').value, tipe: $('pkTipe').value, jenis_tinta: $('pkDesk').value, qty: $('pkQty').value, upah_snapshot: $('pkUpah').value, keterangan: $('pkKet').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidateAll(); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadPekerjaan();
      });
  }
  function hapusPekerjaan(id) {
    konfirmasi('Hapus Pekerjaan', '<p>Yakin ingin menghapus catatan pekerjaan ini?</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('pekerjaan.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Terhapus', res.message); loadPekerjaan();
    });
  }

  // ── ABSENSI (per periode, batch) ──
  let absensiPeriode = periodeIni();
  async function renderAbsensi() {
    const el = $('body-absensi');
    el.innerHTML = `
      <div class="page-head"><div><h1>Absensi</h1><div class="sub">Rekap hari kerja/minggu/lembur per periode untuk karyawan Harian dan Gaji Pokok.</div></div>
        <input id="absPeriode" type="month" class="input-pill" style="width:210px" value="${absensiPeriode}"></div>
      <div id="absensiBody"></div>`;
    $('absPeriode').addEventListener('change', () => { absensiPeriode = $('absPeriode').value; loadAbsensi(); });
    loadAbsensi();
  }
  function drawAbsensi(data) {
    const byKar = {}; data.forEach(a => byKar[a.karyawan_id] = a);
    const karyawan = (S.master.karyawan || []).filter(k => k.aktif !== false);
    $('absensiBody').innerHTML = `
      <div class="card-x flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Karyawan</th><th class="r">Hari Kerja</th><th class="r">Hari Minggu</th><th class="r">Jam Lembur</th><th>Keterangan</th></tr></thead><tbody>
        ${karyawan.map(k => { const a = byKar[k.id] || {}; return `<tr><td>${esc(k.nama)}<span class="sub">${esc(k.skema)}</span></td>
          <td class="r"><input type="number" min="0" class="input-pill sm ta-r" style="width:80px" data-kar="${k.id}" data-f="hari_kerja" value="${a.hari_kerja || 0}"></td>
          <td class="r"><input type="number" min="0" class="input-pill sm ta-r" style="width:80px" data-kar="${k.id}" data-f="hari_minggu" value="${a.hari_minggu || 0}"></td>
          <td class="r"><input type="number" min="0" class="input-pill sm ta-r" style="width:80px" data-kar="${k.id}" data-f="jam_lembur" value="${a.jam_lembur || 0}"></td>
          <td><input class="input-pill sm" data-kar="${k.id}" data-f="keterangan" value="${esc(a.keterangan || '')}"></td></tr>`; }).join('')}
      </tbody></table></div></div>
      <div class="total-bar mt-16"><div class="lbl-s">Periode ${fmtPeriode(absensiPeriode)}</div><button class="btn-pill btn-lime" onclick="Pages.simpanAbsensi()">Simpan Absensi</button></div>`;
  }
  async function loadAbsensi() {
    const key = 'absensi_' + absensiPeriode;
    // background:false — ini grid input batch, render ulang otomatis di latar belakang bisa menimpa ketikan pengguna.
    await loadInto(key, () => Api.get('absensi.list', { periode: absensiPeriode }), drawAbsensi, () => { $('absensiBody').innerHTML = skeletonRows(6); }, { background: false });
  }
  async function simpanAbsensi() {
    const byKar = {};
    document.querySelectorAll('#absensiBody [data-kar]').forEach(inp => {
      const id = inp.dataset.kar; byKar[id] = byKar[id] || { karyawan_id: id };
      byKar[id][inp.dataset.f] = inp.type === 'number' ? Number(inp.value) || 0 : inp.value;
    });
    const res = await Api.post('absensi.simpanBatch', { periode: absensiPeriode, baris: Object.values(byKar) });
    if (!res.success) { showToast('err', 'Gagal', res.message); return; }
    Cache.invalidateMany(['absensi_', 'gajiproses_']); showToast('ok', 'Tersimpan', res.message);
  }

  // ── KASBON ──
  async function renderKasbon() {
    const el = $('body-kasbon');
    el.innerHTML = `
      <div class="page-head"><div><h1>Kasbon</h1><div class="sub">Kasbon diberikan otomatis tercatat sebagai Pengeluaran. Pemotongan lewat Gaji tidak membuat pengeluaran kedua.</div></div>
        <button class="btn-pill btn-lime" onclick="Pages.formKasbon()"><i class="bi bi-plus-lg"></i> Catat Kasbon</button></div>
      <div id="kasbonBody"></div>`;
    loadKasbon();
  }
  function drawKasbon(data) {
    const rowsD = data.list.map(r => `<tr><td>${fmtTglPendek(r.tanggal)}</td><td>${esc(r.karyawan_nama)}</td><td>${r.unit_id ? chipUnit(r.unit_id) : '<span class="chip chip-konfirmasi">Belum ditentukan</span>'}</td>
      <td class="r">${rp(r.jumlah)}</td><td>${chipKasbon(r.status)}<span class="sub">sisa ${rp(r.sisa)}</span></td>
      <td>${isOwner() ? `<button class="btn-icon-sm" onclick="Pages.hapusKasbon('${r.id}')"><i class="bi bi-trash"></i></button>` : ''}</td></tr>`).join('');
    $('kasbonBody').innerHTML = `
      <div class="card-x mb-16"><div class="card-title"><span class="h3">Saldo Kasbon Beredar</span></div>
        <div class="stat-grid">${data.saldoPerKaryawan.filter(x => x.saldo > 0).map(x => `<div class="kpi kpi-small kpi-white"><div class="kpi-label">${esc(x.nama)}</div><div class="kpi-value">${rp(x.saldo)}</div></div>`).join('') || '<div class="caption">Tidak ada kasbon beredar.</div>'}</div></div>
      <div class="card-x flush">${data.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Karyawan</th><th>Sumber Unit</th><th class="r">Jumlah</th><th>Status</th><th></th></tr></thead><tbody>${rowsD}</tbody></table></div>` : emptyState('bi-cash-coin', 'Belum ada kasbon.')}</div>`;
  }
  async function loadKasbon() {
    const key = 'kasbon_' + S.dari + '_' + S.sampai;
    await loadInto(key, () => Api.get('kasbon.list', { dari: S.dari, sampai: S.sampai }), drawKasbon, () => { $('kasbonBody').innerHTML = skeletonRows(6); });
  }
  function formKasbon() {
    const pihakOpts = (S.master.pihak || []).map(p => `<option value="${p.id}">${esc(p.nama)} (${(unitById(p.unit_id) || {}).nama || ''})</option>`).join('');
    openForm('Catat Kasbon', `
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input id="kbTgl" type="date" class="input-pill" value="${todayYmd()}"></div>
        <div class="field"><label>Karyawan</label><select id="kbKar" class="select-pill">${(S.master.karyawan || []).map(k => `<option value="${k.id}">${esc(k.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Jumlah</label><input id="kbJumlah" type="number" class="input-pill" placeholder="0"></div>
        <div class="field"><label>Sumber Dana</label><select id="kbSumber" class="select-pill"><option value="">BROTHERHOOD (belum ditentukan — perlu konfirmasi)</option>${pihakOpts}</select></div>
      </div>
      <div class="field mt-12"><label>Keterangan</label><input id="kbKet" class="input-pill"></div>
      <div class="notice notice-neutral mt-12"><i class="bi bi-info-circle"></i>Kasbon diberikan otomatis tercatat sebagai Pengeluaran kategori "Kasbon" pada unit sumber dana.</div>`,
      async () => {
        const res = await Api.post('kasbon.simpan', { tanggal: $('kbTgl').value, karyawan_id: $('kbKar').value, jumlah: $('kbJumlah').value, sumber_pihak_id: $('kbSumber').value, keterangan: $('kbKet').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidateAll(); M('modalForm').hide(); showToast(res.message.indexOf('PERLU KONFIRMASI') >= 0 ? 'warn' : 'ok', 'Tersimpan', res.message); loadKasbon();
      });
  }
  function hapusKasbon(id) {
    konfirmasi('Hapus Kasbon', '<p>Menghapus kasbon juga membatalkan Pengeluaran otomatis yang menyertainya. Lanjutkan?</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('kasbon.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Terhapus', res.message); loadKasbon();
    });
  }

  // ── GAJI ──
  let gajiTab = 'proses', gajiPeriode = periodeIni(), gajiPreview = null;
  async function renderGaji() {
    const el = $('body-gaji');
    el.innerHTML = `
      <div class="page-head"><div><h1>Gaji</h1><div class="sub">Draft → Terkunci → Dibayar. Kasbon dipotong tidak membuat pengeluaran kedua.</div></div>
        <input id="gjPeriode" type="month" class="input-pill" style="width:210px" value="${gajiPeriode}"></div>
      <div class="mb-16"><div class="tabs-pill">
        <button class="${gajiTab === 'proses' ? 'on' : ''}" onclick="Pages.gajiTabGo('proses')">Proses Gaji</button>
        <button class="${gajiTab === 'riwayat' ? 'on' : ''}" onclick="Pages.gajiTabGo('riwayat')">Riwayat</button>
        <button class="${gajiTab === 'potongan' ? 'on' : ''}" onclick="Pages.gajiTabGo('potongan')">Potongan Lain</button>
      </div></div>
      <div id="gajiTabBody"></div>`;
    $('gjPeriode').addEventListener('change', () => { gajiPeriode = $('gjPeriode').value; loadGajiTab(); });
    loadGajiTab();
  }
  function gajiTabGo(t) { gajiTab = t; loadGajiTab(); }
  function loadGajiTab() { ({ proses: loadGajiProses, riwayat: loadGajiRiwayat, potongan: loadPotonganLain })[gajiTab](); }

  async function loadGajiProses() {
    const key = 'gajiproses_' + gajiPeriode;
    // background:false — baris berisi input yang bisa sedang diketik pengguna, jangan ditimpa otomatis.
    await loadInto(key, () => Api.get('gaji.hitung', { periode: gajiPeriode }), drawGajiProses, () => { $('gajiTabBody').innerHTML = skeletonRows(6); }, { background: false });
  }
  function drawGajiProses(dataHitung) {
    gajiPreview = dataHitung.karyawan;
    const semuaDraftAtauKosong = gajiPreview.every(k => k.status === 'Belum Diproses' || k.status === 'Draft');
    const semuaTerkunci = gajiPreview.some(k => k.status === 'Terkunci');
    const semuaDibayar = gajiPreview.every(k => k.status === 'Dibayar');
    $('gajiTabBody').innerHTML = `
      <div class="card-x flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Karyawan</th><th class="r">Hari Kerja</th><th class="r">Hari Minggu</th><th class="r">Jam Lembur</th><th class="r">Upah Harian</th><th class="r">Borongan</th><th class="r">Kasbon Dipotong</th><th class="r">Potongan Lain</th><th class="r">Gaji Bersih</th><th>Status</th></tr></thead><tbody>
        ${gajiPreview.map(k => `<tr>
          <td>${esc(k.nama)}</td>
          <td class="r"><input type="number" min="0" class="input-pill sm ta-r" style="width:70px" data-kar="${k.karyawan_id}" data-f="hari_kerja" value="${k.hari_kerja}" ${k.status !== 'Draft' && k.status !== 'Belum Diproses' ? 'disabled' : ''} onchange="Pages.gajiHitungBaris('${k.karyawan_id}')"></td>
          <td class="r"><input type="number" min="0" class="input-pill sm ta-r" style="width:70px" data-kar="${k.karyawan_id}" data-f="hari_minggu" value="${k.hari_minggu}" ${k.status !== 'Draft' && k.status !== 'Belum Diproses' ? 'disabled' : ''} onchange="Pages.gajiHitungBaris('${k.karyawan_id}')"></td>
          <td class="r"><input type="number" min="0" class="input-pill sm ta-r" style="width:70px" data-kar="${k.karyawan_id}" data-f="jam_lembur" value="${k.jam_lembur}" ${k.status !== 'Draft' && k.status !== 'Belum Diproses' ? 'disabled' : ''} onchange="Pages.gajiHitungBaris('${k.karyawan_id}')"></td>
          <td class="r mono" id="uh_${k.karyawan_id}">${rp(k.upahHarian)}</td>
          <td class="r mono">${rp(k.borongan)}</td>
          <td class="r"><input type="number" min="0" max="${k.saldoKasbon}" class="input-pill sm ta-r" style="width:90px" data-kar="${k.karyawan_id}" data-f="kasbon_dipotong" value="${k.kasbonDipotongUsulan}" ${k.status !== 'Draft' && k.status !== 'Belum Diproses' ? 'disabled' : ''} title="Saldo kasbon: ${rp(k.saldoKasbon)}"></td>
          <td class="r mono">${rp(k.potonganLain)}</td>
          <td class="r mono" id="gb_${k.karyawan_id}"><b>—</b></td>
          <td>${chipGaji(k.status)}</td>
        </tr>`).join('')}
      </tbody></table></div></div>
      <div class="total-bar mt-16"><div class="lbl-s">Periode ${fmtPeriode(gajiPeriode)}</div>
        <div class="gap-row">
          <button class="btn-pill btn-lime" id="btnGajiProses" onclick="Pages.gajiProsesSimpan()">Proses (Simpan Draft)</button>
          ${isOwner() ? `<button class="btn-pill btn-black" onclick="Pages.gajiKunci()">Kunci</button>` : ''}
          ${isOwner() ? `<button class="btn-pill btn-black" onclick="Pages.gajiBukaKunci()">Buka Kunci</button>` : ''}
          ${isOwner() ? `<button class="btn-pill btn-danger-x" onclick="Pages.gajiBayar()"><i class="bi bi-cash"></i> Bayar</button>` : ''}
        </div></div>`;
    gajiPreview.forEach(k => gajiHitungBaris(k.karyawan_id, true));
  }
  function gajiHitungBaris(karId, initial) {
    const k = gajiPreview.filter(x => x.karyawan_id === karId)[0];
    const kar = karyawanById(karId) || {};
    let hariKerja = k.hari_kerja, hariMinggu = k.hari_minggu, jamLembur = k.jam_lembur, kasbon = k.kasbonDipotongUsulan;
    if (!initial) {
      hariKerja = Number(document.querySelector(`[data-kar="${karId}"][data-f="hari_kerja"]`).value) || 0;
      hariMinggu = Number(document.querySelector(`[data-kar="${karId}"][data-f="hari_minggu"]`).value) || 0;
      jamLembur = Number(document.querySelector(`[data-kar="${karId}"][data-f="jam_lembur"]`).value) || 0;
    }
    const kasbonInp = document.querySelector(`[data-kar="${karId}"][data-f="kasbon_dipotong"]`);
    kasbon = kasbonInp ? Number(kasbonInp.value) || 0 : kasbon;
    const tarif = kar.tarif_harian_berlaku || 0;
    const upahHarian = hariKerja * tarif + hariMinggu * (kar.tarif_minggu || 50000) + jamLembur * (kar.tarif_lembur || 10000);
    const upahKotor = upahHarian + k.borongan;
    const bersih = upahKotor - kasbon - k.potonganLain;
    const uhEl = $('uh_' + karId); if (uhEl) uhEl.textContent = rp(upahHarian);
    const gbEl = $('gb_' + karId); if (gbEl) gbEl.innerHTML = `<b class="${bersih < 0 ? 'money-neg' : ''}">${rp(bersih)}</b>`;
  }
  function bacaBarisGaji() {
    const byKar = {};
    document.querySelectorAll('#gajiTabBody [data-kar]').forEach(inp => {
      const id = inp.dataset.kar; byKar[id] = byKar[id] || { karyawan_id: id };
      byKar[id][inp.dataset.f] = Number(inp.value) || 0;
    });
    return Object.values(byKar);
  }
  async function gajiProsesSimpan() {
    const btn = $('btnGajiProses'); const asal = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin spin-sm"></span> Memproses...'; }
    let res;
    try { res = await Api.post('gaji.proses', { periode: gajiPeriode, baris: bacaBarisGaji() }); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = asal; } }
    if (!res.success) { showToast('err', 'Gagal', res.message); return; }
    Cache.invalidateMany(['gajiproses_', 'gajiriwayat_', 'dash_', 'rekap_', 'lap_']); showToast('ok', 'Diproses', res.message); loadGajiProses();
  }
  function gajiKunci() {
    konfirmasi('Kunci Gaji', `<p>Kunci semua data Draft periode ${fmtPeriode(gajiPeriode)}? Absensi/Potongan Lain tidak bisa diubah lagi setelah dikunci.</p>`, 'Ya, Kunci', async () => {
      const res = await Api.post('gaji.kunci', { periode: gajiPeriode }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Dikunci', res.message); loadGajiProses();
    });
  }
  function gajiBukaKunci() {
    konfirmasi('Buka Kunci Gaji', `<p>Buka kunci data Terkunci periode ${fmtPeriode(gajiPeriode)} (yang belum Dibayar)?</p>`, 'Ya, Buka', async () => {
      const res = await Api.post('gaji.bukaKunci', { periode: gajiPeriode }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Dibuka', res.message); loadGajiProses();
    });
  }
  function gajiBayar() {
    konfirmasi('Bayar Gaji', `<p>Bayar semua gaji Terkunci periode ${fmtPeriode(gajiPeriode)}? Pengeluaran akan tercipta otomatis per unit.</p>`, 'Ya, Bayar', async () => {
      const res = await Api.post('gaji.bayar', { periode: gajiPeriode, tanggal_bayar: todayYmd() }); if (!res.success) throw new Error(res.message);
      Cache.invalidateAll(); showToast('ok', 'Dibayar', res.message); loadGajiProses();
    });
  }

  function drawGajiRiwayat(data) {
    const rowsD = data.list.map(g => `<tr class="click" onclick="Pages.lihatSlip('${g.id}')"><td>${esc(g.karyawan_nama)}</td><td class="r">${rp(g.upah_kotor)}</td><td class="r">${rp(g.kasbon_dipotong)}</td><td class="r">${rp(g.potongan_lain)}</td><td class="r"><b>${rp(g.gaji_bersih)}</b></td><td>${chipGaji(g.status)}</td></tr>`).join('');
    $('gajiTabBody').innerHTML = `<div class="card-x mb-16"><div class="kv"><span class="k">Total gaji bersih periode ini</span><span class="v h3">${rp(data.totalBersih)}</span></div></div>
      <div class="card-x flush">${data.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Karyawan</th><th class="r">Upah Kotor</th><th class="r">Kasbon</th><th class="r">Potongan</th><th class="r">Gaji Bersih</th><th>Status</th></tr></thead><tbody>${rowsD}</tbody></table></div>` : emptyState('bi-wallet2', 'Belum ada data gaji periode ini.')}</div>`;
  }
  async function loadGajiRiwayat() {
    const key = 'gajiriwayat_' + gajiPeriode;
    await loadInto(key, () => Api.get('gaji.list', { periode: gajiPeriode }), drawGajiRiwayat, () => { $('gajiTabBody').innerHTML = skeletonRows(6); });
  }
  let slipTerakhir = null; // cache slip yang sedang dibuka, dipakai ulang oleh tombol Cetak PDF / Download PDF
  async function lihatSlip(id) {
    const res = await Api.get('gaji.slip', { id }); if (!res.success) { showToast('err', 'Gagal', res.message); return; }
    const s = res.data; slipTerakhir = s;
    openForm('Slip Gaji — ' + s.karyawan_nama, `
      <div class="formula-card mb-16"><h6>${esc(s.kopNama)}</h6><div class="caption" style="color:#d9dccf">${esc(s.kopAlamat)}</div></div>
      <div class="kv-list">
        <div class="kv"><span class="k">Nama Karyawan</span><span class="v">${esc(s.karyawan_nama)}</span></div>
        <div class="kv"><span class="k">Posisi</span><span class="v">${esc(s.posisi)}</span></div>
        <div class="kv"><span class="k">Unit</span><span class="v">${esc(s.unitLabel)}</span></div>
        <div class="kv"><span class="k">Periode</span><span class="v">${esc(s.periodeLabel)}</span></div>
        <div class="kv"><span class="k">Gaji Pokok / Harian</span><span class="v">${rp(s.upahHarianTotal)}</span></div>
        <div class="kv"><span class="k">Upah Produksi</span><span class="v">${rp(s.totalBorongan)}</span></div>
        <div class="kv"><span class="k">Lembur</span><span class="v">${s.jam_lembur} jam (termasuk di Gaji Harian)</span></div>
        <div class="kv"><span class="k">Kasbon</span><span class="v">- ${rp(s.kasbon_dipotong)}</span></div>
        <div class="kv"><span class="k">Potongan Lainnya</span><span class="v">- ${rp(s.potongan_lain)}</span></div>
        <div class="kv"><span class="k">Total Gross</span><span class="v">${rp(s.upah_kotor)}</span></div>
        <div class="kv"><span class="k">Total Potongan</span><span class="v">- ${rp(s.totalPotongan)}</span></div>
        <div class="kv"><span class="k"><b>NET SALARY</b></span><span class="v"><b>${rp(s.gaji_bersih)}</b></span></div>
        <div class="kv"><span class="k">Status</span><span class="v">${chipGaji(s.status)} ${s.statusBayar} ${s.tanggal_bayar ? fmtTgl(s.tanggal_bayar) : ''}</span></div>
      </div>
      ${s.rincianBorongan.length ? `<div class="mt-12"><label class="lbl">Rincian Borongan</label><table class="mini-tbl"><thead><tr><th>Tanggal</th><th>Item</th><th class="r">Qty</th><th class="r">Upah</th></tr></thead><tbody>${s.rincianBorongan.map(r => `<tr><td>${fmtTglPendek(r.tanggal)}</td><td>${esc(r.jenis_tinta)}</td><td class="r">${r.qty}</td><td class="r">${rp(r.total_upah)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="gap-row mt-12">
        <button type="button" class="btn-pill btn-ghost w-100" onclick="Pages.cetakSlipGaji()"><i class="bi bi-printer"></i> Cetak PDF</button>
        <button type="button" class="btn-pill btn-black w-100" id="btnUnduhSlip" onclick="Pages.unduhSlipGaji('${s.id}')"><i class="bi bi-download"></i> Download PDF</button>
      </div>`,
      async () => { M('modalForm').hide(); }, 'Tutup');
  }
  /** Cetak instan (dialog print browser, bisa "Simpan sbg PDF") — tanpa roundtrip server, pakai data yang sudah ada. */
  function cetakSlipGaji() {
    const s = slipTerakhir; if (!s) return;
    $('printArea').innerHTML = `
      <div class="p-kop"><img src="img/logo.png" alt="Brotherhood Workshop"><div><h2>${esc(s.kopNama)}</h2><div>${esc(s.kopAlamat)}</div></div></div>
      <h3>SLIP GAJI</h3>
      <table><tr><td style="width:140px;color:#555;border:0;">Nama Karyawan</td><td style="border:0;"><b>${esc(s.karyawan_nama)}</b></td></tr>
      <tr><td style="border:0;color:#555;">Posisi</td><td style="border:0;">${esc(s.posisi)}</td></tr>
      <tr><td style="border:0;color:#555;">Unit</td><td style="border:0;">${esc(s.unitLabel)}</td></tr>
      <tr><td style="border:0;color:#555;">Periode</td><td style="border:0;">${esc(s.periodeLabel)}</td></tr>
      <tr><td style="border:0;color:#555;">Status</td><td style="border:0;"><b>${s.statusBayar}</b></td></tr></table>
      <table><tr><th>Rincian</th><th class="r">Nominal</th></tr>
      <tr><td>Gaji Pokok / Harian (${s.hari_kerja} hari kerja, ${s.hari_minggu} hari minggu, ${s.jam_lembur} jam lembur)</td><td class="r">${rp(s.upahHarianTotal)}</td></tr>
      <tr><td>Upah Produksi (Borongan)</td><td class="r">${rp(s.totalBorongan)}</td></tr>
      <tr><td>Kasbon Dipotong</td><td class="r">- ${rp(s.kasbon_dipotong)}</td></tr>
      <tr><td>Potongan Lainnya</td><td class="r">- ${rp(s.potongan_lain)}</td></tr></table>
      <table><tr><td style="border:0;">Total Gross</td><td class="r" style="border:0;">${rp(s.upah_kotor)}</td></tr>
      <tr><td style="border:0;">Total Potongan</td><td class="r" style="border:0;">- ${rp(s.totalPotongan)}</td></tr>
      <tr class="p-net"><td>NET SALARY</td><td class="r">${rp(s.gaji_bersih)}</td></tr></table>`;
    document.body.classList.add('print-isolate');
    window.print();
    setTimeout(() => document.body.classList.remove('print-isolate'), 300);
  }
  /** Unduh berkas PDF resmi (dibuat & disimpan di Drive lewat backend) — angka sama persis dengan modul Gaji. */
  async function unduhSlipGaji(id) {
    const btn = $('btnUnduhSlip'); const asal = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spin spin-sm"></span> Membuat PDF...';
    try {
      const res = await Api.post('gaji.slipPdf', { id });
      if (!res.success) { showToast('err', 'Gagal', res.message); return; }
      window.open(res.data.url, '_blank');
      showToast('ok', 'PDF siap', 'Slip gaji berhasil dibuat dan dibuka di tab baru.');
    } finally { btn.disabled = false; btn.innerHTML = asal; }
  }

  // ── POTONGAN LAIN (tab dalam halaman Gaji) ──
  function drawPotonganLain(data) {
    const rowsD = data.map(p => `<tr><td>${fmtTglPendek(p.tanggal)}</td><td>${esc(p.karyawan_nama)}</td><td>${esc(p.jenis)}</td><td class="r">${rp(p.jumlah)}</td><td>${esc(p.keterangan)}</td><td>${isOwner() ? `<button class="btn-icon-sm" onclick="Pages.hapusPotonganLain('${p.id}')"><i class="bi bi-trash"></i></button>` : ''}</td></tr>`).join('');
    $('gajiTabBody').innerHTML = `
      <div class="gap-row mb-16"><button class="btn-pill btn-lime" onclick="Pages.formPotonganLain()"><i class="bi bi-plus-lg"></i> Tambah Potongan</button></div>
      <div class="card-x flush">${data.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Karyawan</th><th>Jenis</th><th class="r">Jumlah</th><th>Keterangan</th><th></th></tr></thead><tbody>${rowsD}</tbody></table></div>` : emptyState('bi-dash-circle', 'Belum ada potongan lain periode ini.')}</div>`;
  }
  async function loadPotonganLain() {
    const key = 'potlain_' + gajiPeriode;
    await loadInto(key, () => Api.get('potonganLain.list', { periode: gajiPeriode }), drawPotonganLain, () => { $('gajiTabBody').innerHTML = skeletonRows(4); });
  }
  function formPotonganLain() {
    openForm('Tambah Potongan Lain', `
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input id="plTgl" type="date" class="input-pill" value="${todayYmd()}"></div>
        <div class="field"><label>Karyawan</label><select id="plKar" class="select-pill">${(S.master.karyawan || []).map(k => `<option value="${k.id}">${esc(k.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Jenis</label><input id="plJenis" class="input-pill" placeholder="Seragam, Denda, dll"></div>
        <div class="field"><label>Jumlah</label><input id="plJumlah" type="number" class="input-pill" placeholder="0"></div>
      </div>
      <div class="field mt-12"><label>Keterangan</label><input id="plKet" class="input-pill"></div>`,
      async () => {
        const res = await Api.post('potonganLain.simpan', { tanggal: $('plTgl').value, karyawan_id: $('plKar').value, jenis: $('plJenis').value, jumlah: $('plJumlah').value, periode: gajiPeriode, keterangan: $('plKet').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidateMany(['potlain_', 'gajiproses_']); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadPotonganLain();
      });
  }
  function hapusPotonganLain(id) {
    konfirmasi('Hapus Potongan', '<p>Yakin ingin menghapus potongan ini?</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('potonganLain.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateMany(['potlain_', 'gajiproses_']); showToast('ok', 'Terhapus', res.message); loadPotonganLain();
    });
  }

  // ── PENGELUARAN + PEMASUKAN LAIN ──
  let pengTab = 'pengeluaran';
  async function renderPengeluaran() {
    const el = $('body-pengeluaran');
    el.innerHTML = `
      <div class="page-head"><div><h1>Pengeluaran</h1><div class="sub">${filterRingkas()}</div></div>
        <button class="btn-pill btn-lime" onclick="${pengTab === 'pengeluaran' ? 'Pages.formPengeluaran()' : 'Pages.formPemasukanLain()'}"><i class="bi bi-plus-lg"></i> Tambah</button></div>
      <div class="mb-16"><div class="tabs-pill">
        <button class="${pengTab === 'pengeluaran' ? 'on' : ''}" onclick="Pages.pengTabGo('pengeluaran')">Pengeluaran</button>
        <button class="${pengTab === 'pemasukan' ? 'on' : ''}" onclick="Pages.pengTabGo('pemasukan')">Pemasukan Lain</button>
      </div></div>
      <div id="pengTabBody"></div>`;
    pengTab === 'pengeluaran' ? loadPengeluaran() : loadPemasukanLain();
  }
  function pengTabGo(t) { pengTab = t; renderPengeluaran(); }

  function drawPengeluaran(data) {
    const rowsD = data.list.map(r => `<tr><td>${fmtTglPendek(r.tanggal)}</td><td>${chipUnit(r.unit_id)}</td><td>${esc(r.kategori)}</td><td>${esc(r.keterangan)}${r.sumber === 'Otomatis' ? ' <span class="chip chip-neutral">Otomatis</span>' : ''}</td><td class="r">${rp(r.nominal)}</td>
      <td>${r.sumber === 'Manual' && isOwner() ? `<button class="btn-icon-sm" onclick="Pages.hapusPengeluaran('${r.id}')"><i class="bi bi-trash"></i></button>` : ''}</td></tr>`).join('');
    $('pengTabBody').innerHTML = `
      <div class="stat-grid mb-16">${Object.keys(data.perKategori).map(k => `<div class="kpi kpi-small kpi-white"><div class="kpi-label">${esc(k)}</div><div class="kpi-value">${rp(data.perKategori[k])}</div></div>`).join('')}</div>
      <div class="card-x flush">${data.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Unit</th><th>Kategori</th><th>Keterangan</th><th class="r">Nominal</th><th></th></tr></thead><tbody>${rowsD}</tbody></table></div>` : emptyState('bi-cart-dash', 'Belum ada pengeluaran periode ini.')}</div>`;
  }
  async function loadPengeluaran() {
    const key = 'peng_' + S.dari + '_' + S.sampai + '_' + S.unitFilter;
    await loadInto(key, () => Api.get('pengeluaran.list', { dari: S.dari, sampai: S.sampai, unit_id: S.unitFilter }), drawPengeluaran, () => { $('pengTabBody').innerHTML = skeletonRows(6); });
  }
  function formPengeluaran() {
    const kategoriList = (S.master.kategoriPengeluaran || []);
    openForm('Catat Pengeluaran', `
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input id="pgTgl" type="date" class="input-pill" value="${todayYmd()}"></div>
        <div class="field"><label>Unit (kosongkan = Biaya Bersama)</label><select id="pgUnit" class="select-pill"><option value="">Biaya Bersama</option>${(S.master.units || []).map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Kategori</label><select id="pgKategori" class="select-pill">${kategoriList.map(k => `<option>${esc(k)}</option>`).join('')}</select></div>
        <div class="field"><label>Nominal</label><input id="pgNominal" type="number" class="input-pill" placeholder="0"></div>
        <div class="field"><label>Vendor (opsional)</label><input id="pgVendor" class="input-pill" list="dlVendor"></div>
      </div>
      <datalist id="dlVendor">${(S.master.vendor || []).map(v => `<option value="${esc(v.nama)}">`).join('')}</datalist>
      <div class="field mt-12"><label>Keterangan</label><input id="pgKet" class="input-pill"></div>`,
      async () => {
        const res = await Api.post('pengeluaran.simpan', { tanggal: $('pgTgl').value, unit_id: $('pgUnit').value, kategori: $('pgKategori').value, nominal: $('pgNominal').value, vendor: $('pgVendor').value, keterangan: $('pgKet').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidateMany(['peng_', 'dash_', 'rekap_', 'lap_']); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadPengeluaran();
      });
  }
  function hapusPengeluaran(id) {
    konfirmasi('Hapus Pengeluaran', '<p>Yakin ingin menghapus pengeluaran ini?</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('pengeluaran.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateMany(['peng_', 'dash_', 'rekap_', 'lap_']); showToast('ok', 'Terhapus', res.message); loadPengeluaran();
    });
  }

  function drawPemasukanLain(data) {
    const rowsD = data.list.map(r => `<tr><td>${fmtTglPendek(r.tanggal)}</td><td>${chipUnit(r.unit_id)}</td><td>${esc(r.sumber_pemasukan)}</td><td>${esc(r.keterangan)}</td><td class="r">${rp(r.nominal)}</td>
      <td>${isOwner() ? `<button class="btn-icon-sm" onclick="Pages.hapusPemasukanLain('${r.id}')"><i class="bi bi-trash"></i></button>` : ''}</td></tr>`).join('');
    $('pengTabBody').innerHTML = `<div class="card-x mb-16"><div class="kv"><span class="k">Total pemasukan lain</span><span class="v h3">${rp(data.total)}</span></div></div>
      <div class="card-x flush">${data.list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tanggal</th><th>Unit</th><th>Sumber</th><th>Keterangan</th><th class="r">Nominal</th><th></th></tr></thead><tbody>${rowsD}</tbody></table></div>` : emptyState('bi-cash-stack', 'Belum ada pemasukan lain periode ini.')}</div>`;
  }
  async function loadPemasukanLain() {
    const key = 'pemasukan_' + S.dari + '_' + S.sampai + '_' + S.unitFilter;
    await loadInto(key, () => Api.get('pemasukanLain.list', { dari: S.dari, sampai: S.sampai, unit_id: S.unitFilter }), drawPemasukanLain, () => { $('pengTabBody').innerHTML = skeletonRows(6); });
  }
  function formPemasukanLain() {
    openForm('Catat Pemasukan Lain', `
      <div class="form-grid">
        <div class="field"><label>Tanggal</label><input id="pmTgl" type="date" class="input-pill" value="${todayYmd()}"></div>
        <div class="field"><label>Unit</label><select id="pmUnit" class="select-pill">${(S.master.units || []).map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('')}</select></div>
        <div class="field"><label>Sumber Pemasukan</label><input id="pmSumber" class="input-pill" placeholder="Sewa mesin, jasa lain, dll"></div>
        <div class="field"><label>Nominal</label><input id="pmNominal" type="number" class="input-pill" placeholder="0"></div>
      </div>
      <div class="field mt-12"><label>Keterangan</label><input id="pmKet" class="input-pill"></div>`,
      async () => {
        const res = await Api.post('pemasukanLain.simpan', { tanggal: $('pmTgl').value, unit_id: $('pmUnit').value, sumber_pemasukan: $('pmSumber').value, nominal: $('pmNominal').value, keterangan: $('pmKet').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidateMany(['pemasukan_', 'dash_', 'rekap_', 'lap_']); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadPemasukanLain();
      });
  }
  function hapusPemasukanLain(id) {
    konfirmasi('Hapus Pemasukan Lain', '<p>Yakin ingin menghapus data ini?</p>', 'Ya, Hapus', async () => {
      const res = await Api.post('pemasukanLain.hapus', { id }); if (!res.success) throw new Error(res.message);
      Cache.invalidateMany(['pemasukan_', 'dash_', 'rekap_', 'lap_']); showToast('ok', 'Terhapus', res.message); loadPemasukanLain();
    });
  }

  // ── REKAP BULANAN + SALDO AWAL ──
  let rekapPeriode = periodeIni();
  async function renderRekap() {
    const el = $('body-rekap');
    el.innerHTML = `
      <div class="page-head"><div><h1>Rekap Bulanan</h1><div class="sub">Saldo Kas Akhir = Saldo Awal + Kas Diterima − Pengeluaran.</div></div>
        <input id="rkPeriode" type="month" class="input-pill" style="width:210px" value="${rekapPeriode}"></div>
      <div id="rekapBody"></div>`;
    $('rkPeriode').addEventListener('change', () => { rekapPeriode = $('rkPeriode').value; loadRekap(); });
    loadRekap();
  }
  function drawRekap(d) {
    $('rekapBody').innerHTML = `
      <div class="grid-3 mb-16">
        <div class="kpi kpi-white"><div class="kpi-label">SALDO AWAL</div><div class="kpi-value">${rp(d.saldoAwal)}</div>${isOwner() ? `<button class="btn-pill btn-ghost sm mt-12" onclick="Pages.formSaldoAwal()">Ubah Saldo Awal</button>` : ''}</div>
        <div class="kpi kpi-lime"><div class="kpi-label">KAS DITERIMA − PENGELUARAN</div><div class="kpi-value">${rp(d.kasDiterima - d.pengeluaran)}</div></div>
        <div class="kpi kpi-hero"><div class="kpi-label">SALDO KAS AKHIR</div><div class="kpi-value">${rp(d.saldoAkhir)}</div></div>
      </div>
      <div class="row g-3 mb-16">
        <div class="col-12 col-lg-6"><div class="card-x"><div class="card-title"><span class="h3">Ringkasan Periode</span></div>
          <div class="kv-list">
            <div class="kv"><span class="k">Omzet</span><span class="v">${rp(d.omzet)}</span></div>
            <div class="kv"><span class="k">Kas Diterima</span><span class="v">${rp(d.kasDiterima)}</span></div>
            <div class="kv"><span class="k">Upah Produksi</span><span class="v">${rp(d.upahProduksi)}</span></div>
            <div class="kv"><span class="k">Pengeluaran</span><span class="v">${rp(d.pengeluaran)}</span></div>
            <div class="kv"><span class="k">Margin Sementara</span><span class="v">${rp(d.marginSementara)}</span></div>
            <div class="kv"><span class="k">Kasbon Beredar</span><span class="v">${rp(d.kasbonBeredar)}</span></div>
          </div></div></div>
        <div class="col-12 col-lg-6"><div class="card-x"><div class="card-title"><span class="h3">Pengeluaran per Kategori</span></div>
          <div class="kv-list">${Object.keys(d.pengeluaranPerKategori).map(k => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${rp(d.pengeluaranPerKategori[k])}</span></div>`).join('') || '<div class="caption">Tidak ada pengeluaran.</div>'}</div></div></div>
      </div>
      <div class="grid-3">
        ${d.perUnitRekap.map(u => `<div class="card-x"><div class="card-title"><span class="h3">${chipUnit(u)}</span></div><div class="kv-list">
          <div class="kv"><span class="k">Omzet</span><span class="v">${rp(u.omzet)}</span></div>
          <div class="kv"><span class="k">Saldo Awal</span><span class="v">${rp(u.saldoAwal)}</span></div>
          <div class="kv"><span class="k">Kas Diterima</span><span class="v">${rp(u.kasDiterima)}</span></div>
          <div class="kv"><span class="k">Pengeluaran</span><span class="v">${rp(u.pengeluaran)}</span></div>
          <div class="kv"><span class="k"><b>Saldo Akhir</b></span><span class="v"><b>${rp(u.saldoAkhir)}</b></span></div>
        </div></div>`).join('')}
      </div>`;
  }
  async function loadRekap() {
    const key = 'rekap_' + rekapPeriode + '_' + S.unitFilter;
    await loadInto(key, () => Api.get('rekap.bulanan', { periode: rekapPeriode, unit_id: S.unitFilter }), drawRekap, () => { $('rekapBody').innerHTML = skeletonKpi(3) + skeletonRows(3); });
  }
  function formSaldoAwal() {
    openForm('Ubah Saldo Awal — ' + fmtPeriode(rekapPeriode), `
      <div class="field mb-16"><label>Unit (kosongkan untuk saldo gabungan)</label><select id="saUnit" class="select-pill"><option value="">Gabungan Seluruh Usaha</option>${(S.master.units || []).map(u => `<option value="${u.id}" ${S.unitFilter === u.id ? 'selected' : ''}>${esc(u.nama)}</option>`).join('')}</select></div>
      <div class="field mb-16"><label>Nilai Saldo Awal</label><input id="saNilai" type="number" class="input-pill" placeholder="0"></div>
      <div class="field"><label>Catatan</label><input id="saCatatan" class="input-pill"></div>`,
      async () => {
        const res = await Api.post('saldoAwal.simpan', { periode: rekapPeriode, unit_id: $('saUnit').value, nilai: $('saNilai').value, catatan: $('saCatatan').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        Cache.invalidatePrefix('rekap_'); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadRekap();
      });
  }

  // ── LAPORAN ──
  const JENIS_LAPORAN_LABEL = { omzet: 'Omzet', kas: 'Kas Diterima', piutang: 'Piutang', pengeluaran: 'Pengeluaran', gaji: 'Gaji', kasbon: 'Kasbon' };
  let laporanJenis = 'omzet';
  async function renderLaporan() {
    const el = $('body-laporan');
    el.innerHTML = `
      <div class="page-head"><div><h1>Laporan</h1><div class="sub">${filterRingkas()}</div></div>
        <div class="gap-row no-print">
          <button class="btn-pill btn-ghost" onclick="window.print()"><i class="bi bi-printer"></i> Cetak</button>
          <button class="btn-pill btn-lime" onclick="Pages.eksporPdf()"><i class="bi bi-file-earmark-pdf"></i> Ekspor PDF</button>
        </div></div>
      <div class="mb-16"><div class="tabs-pill" id="laporanTabs">${Object.keys(JENIS_LAPORAN_LABEL).map(j => `<button class="${laporanJenis === j ? 'on' : ''}" data-j="${j}" onclick="Pages.laporanGo('${j}')">${JENIS_LAPORAN_LABEL[j]}</button>`).join('')}</div></div>
      <div id="laporanBody"></div>`;
    loadLaporan();
  }
  /** Ganti jenis laporan → respons LANGSUNG (event handler client-side, tanpa refresh browser):
   *  update highlight tab seketika, lalu tampilkan data (dari cache instan bila ada) atau skeleton singkat. */
  function laporanGo(j) {
    laporanJenis = j;
    document.querySelectorAll('#laporanTabs button').forEach(b => b.classList.toggle('on', b.dataset.j === j));
    loadLaporan();
  }
  function drawLaporan(data) {
    if (!data.baris.length) { $('laporanBody').innerHTML = emptyState('bi-file-earmark-text', 'Tidak ada data untuk laporan ini.'); return; }
    const kolomKey = Object.keys(data.baris[0]);
    const rows = data.baris.map(b => `<tr>${kolomKey.map(k => `<td class="${typeof b[k] === 'number' ? 'r' : ''}">${typeof b[k] === 'number' ? rp(b[k]) : esc(b[k])}</td>`).join('')}</tr>`).join('');
    $('laporanBody').innerHTML = `<div class="card-x flush"><div class="tbl-wrap"><table class="tbl"><thead><tr>${data.kolom.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  async function loadLaporan() {
    const key = 'lap_' + laporanJenis + '_' + S.dari + '_' + S.sampai + '_' + S.unitFilter;
    await loadInto(key, () => Api.get('laporan.data', { jenis: laporanJenis, dari: S.dari, sampai: S.sampai, unit_id: S.unitFilter, periode: rekapPeriodeSaatIni_() }), drawLaporan, () => { $('laporanBody').innerHTML = skeletonRows(6); });
  }
  function rekapPeriodeSaatIni_() { return S.dari ? S.dari.substr(0, 7) : periodeIni(); }
  async function eksporPdf() {
    showToast('info', 'Memproses', 'Membuat PDF di server...');
    const res = await Api.post('laporan.pdf', { jenis: laporanJenis, dari: S.dari, sampai: S.sampai, unit_id: S.unitFilter });
    if (!res.success) { showToast('err', 'Gagal', res.message); return; }
    showToast('ok', 'PDF Siap', 'Klik untuk membuka.');
    window.open(res.data.url, '_blank');
  }

  // ── MASTER HARGA ──
  let masterTab = 'jahit';
  async function renderMaster() {
    const el = $('body-master');
    el.innerHTML = `
      <div class="page-head"><div><h1>Master Harga</h1><div class="sub">Perubahan Harga/Upah Aktif hanya berlaku untuk transaksi baru — order lama memakai snapshot lamanya.</div></div></div>
      <div class="mb-16"><div class="tabs-pill">
        <button class="${masterTab === 'jahit' ? 'on' : ''}" onclick="Pages.masterTabGo('jahit')">Jahit &amp; Upah</button>
        <button class="${masterTab === 'sablon' ? 'on' : ''}" onclick="Pages.masterTabGo('sablon')">Sablon</button>
        <button class="${masterTab === 'riwayat' ? 'on' : ''}" onclick="Pages.masterTabGo('riwayat')">Riwayat</button>
      </div></div>
      <div id="masterTabBody"></div>`;
    ({ jahit: loadMasterJahit, sablon: loadMasterSablon, riwayat: loadMasterRiwayat })[masterTab]();
  }
  function masterTabGo(t) { masterTab = t; renderMaster(); }

  function loadMasterJahit() {
    const master = S.master;
    const rowsHarga = (master.hargaJahit || []).map(h => `<tr><td>${esc(h.jenis)}</td><td>${chipUnit(h.unit_id)}</td><td class="r">${h.harga_excel_lama ? rp(h.harga_excel_lama) : '—'}</td>
      <td class="r">${h.harga_aktif ? rp(h.harga_aktif) : '<span class="chip chip-belum">Belum ditetapkan</span>'}</td>
      <td>${isOwner() ? `<button class="btn-pill btn-ghost sm" onclick='Pages.formHargaAktif("Harga_Jahit",${jsAttr(h)})'>Set Aktif</button>` : ''}</td></tr>`).join('');
    const rowsUpah = (master.upahJahit || []).map(u => `<tr><td>${esc(u.jenis)}</td><td class="r">${u.upah_excel_lama ? rp(u.upah_excel_lama) : '—'}</td>
      <td class="r">${u.upah_aktif ? rp(u.upah_aktif) : '<span class="chip chip-belum">Belum ditetapkan</span>'}</td>
      <td>${isOwner() ? `<button class="btn-pill btn-ghost sm" onclick='Pages.formHargaAktif("Upah_Jahit",${jsAttr(u)})'>Set Aktif</button>` : ''}</td></tr>`).join('');
    $('masterTabBody').innerHTML = `
      ${isOwner() ? `<div class="gap-row mb-16">
        <button class="btn-pill btn-black sm" onclick='Pages.terapkanExcel("Harga_Jahit")'>Terapkan Semua Harga dari Excel Lama</button>
        <button class="btn-pill btn-black sm" onclick='Pages.terapkanExcel("Upah_Jahit")'>Terapkan Semua Upah dari Excel Lama</button>
        <button class="btn-pill btn-lime sm" onclick="Pages.formJenisBaru()"><i class="bi bi-plus"></i> Jenis Baru</button>
      </div>` : ''}
      <div class="card-x flush mb-16"><div class="card-title" style="padding:16px 16px 0"><span class="h3">Harga Jahit (ke Pelanggan)</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Jenis</th><th>Unit</th><th class="r">Excel Lama</th><th class="r">Aktif</th><th></th></tr></thead><tbody>${rowsHarga}</tbody></table></div></div>
      <div class="card-x flush"><div class="card-title" style="padding:16px 16px 0"><span class="h3">Upah Jahit (ke Karyawan)</span></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Jenis</th><th class="r">Excel Lama</th><th class="r">Aktif</th><th></th></tr></thead><tbody>${rowsUpah}</tbody></table></div></div>`;
  }
  function formHargaAktif(tabel, row) {
    openForm('Set ' + (tabel === 'Harga_Jahit' ? 'Harga' : 'Upah') + ' Aktif — ' + row.jenis, `
      <div class="field mb-16"><label>Nilai Baru</label><input id="haNilai" type="number" class="input-pill" value="${tabel === 'Harga_Jahit' ? row.harga_aktif || '' : row.upah_aktif || ''}"></div>
      <div class="field"><label>Berlaku Mulai</label><input id="haBerlaku" type="date" class="input-pill" value="${todayYmd()}"></div>
      <div class="notice notice-neutral mt-12"><i class="bi bi-info-circle"></i>Order/pekerjaan yang sudah ada TIDAK berubah — hanya transaksi baru yang memakai nilai ini.</div>`,
      async () => {
        const res = await Api.post('harga.setAktif', { tabel, id: row.id, nilai: $('haNilai').value, berlaku_mulai: $('haBerlaku').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        S.master = null; await refreshMaster();
        M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadMasterJahit();
      });
  }
  function terapkanExcel(tabel) {
    konfirmasi('Terapkan dari Excel Lama', '<p>Isi Harga/Upah Aktif dari nilai Excel Lama untuk semua baris yang aktifnya masih kosong?</p>', 'Ya, Terapkan', async () => {
      const res = await Api.post('harga.terapkanExcel', { tabel }); if (!res.success) throw new Error(res.message);
      await refreshMaster(); showToast('ok', 'Diterapkan', res.message); loadMasterJahit();
    });
  }
  function formJenisBaru() {
    openForm('Tambah Jenis Baru', `
      <div class="field mb-16"><label>Tabel</label><select id="jbTabel" class="select-pill" onchange="Pages.toggleJenisBaruUnit()"><option value="Harga_Jahit">Harga Jahit</option><option value="Upah_Jahit">Upah Jahit</option></select></div>
      <div class="field mb-16" id="jbUnitWrap"><label>Unit</label><select id="jbUnit" class="select-pill">${(S.master.units || []).map(u => `<option value="${u.id}">${esc(u.nama)}</option>`).join('')}</select></div>
      <div class="field mb-16"><label>Nama Jenis</label><input id="jbJenis" class="input-pill"></div>
      <div class="field"><label>Nilai</label><input id="jbNilai" type="number" class="input-pill"></div>`,
      async () => {
        const res = await Api.post('harga.jenisBaru', { tabel: $('jbTabel').value, unit_id: $('jbUnit').value, jenis: $('jbJenis').value, nilai: $('jbNilai').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        await refreshMaster(); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadMasterJahit();
      });
    toggleJenisBaruUnit();
  }
  function toggleJenisBaruUnit() { $('jbUnitWrap').classList.toggle('hide', $('jbTabel').value !== 'Harga_Jahit'); }

  function loadMasterSablon() {
    const rows = (S.master.hargaSablon || []).map(hs => {
      const us = (S.master.upahSablon || []).filter(u => u.tinta === hs.tinta)[0] || {};
      return `<div class="col-12 col-md-4 mb-16"><div class="formula-card">
        <h6>${esc(hs.tinta)}</h6>
        <div class="rumus">harga = dasar + (warna−1) × tambahan</div>
        <table><tr><td>Harga dasar</td><td>${rp(hs.harga_dasar)}</td></tr><tr><td>Harga tambahan/warna</td><td>${rp(hs.harga_tambahan_warna)}</td></tr>
        <tr><td>Upah dasar</td><td>${rp(us.upah_dasar)}</td></tr><tr><td>Upah tambahan/warna</td><td>${rp(us.upah_tambahan_warna)}</td></tr></table>
        ${isOwner() ? `<button class="btn-pill btn-lime sm w-100 mt-12" onclick='Pages.formSablon(${jsAttr(hs)},${jsAttr(us)})'>Ubah Tarif</button>` : '<span class="lock-chip mt-12"><i class="bi bi-lock-fill"></i> Hanya Owner</span>'}
      </div></div>`;
    }).join('');
    $('masterTabBody').innerHTML = `<div class="row">${rows}</div>`;
  }
  function formSablon(hs, us) {
    openForm('Ubah Tarif Sablon — ' + hs.tinta, `
      <div class="form-grid">
        <div class="field"><label>Harga Dasar</label><input id="sbHargaDasar" type="number" class="input-pill" value="${hs.harga_dasar}"></div>
        <div class="field"><label>Harga Tambahan/Warna</label><input id="sbHargaTambahan" type="number" class="input-pill" value="${hs.harga_tambahan_warna}"></div>
        <div class="field"><label>Upah Dasar</label><input id="sbUpahDasar" type="number" class="input-pill" value="${us.upah_dasar}"></div>
        <div class="field"><label>Upah Tambahan/Warna</label><input id="sbUpahTambahan" type="number" class="input-pill" value="${us.upah_tambahan_warna}"></div>
      </div>
      <div class="notice notice-neutral mt-12"><i class="bi bi-lock-fill"></i>Rumus tetap dasar + (warna−1)×tambahan — hanya nilainya yang berubah. Order lama tidak terpengaruh.</div>`,
      async () => {
        const res = await Api.post('harga.sablonSimpan', { tinta: hs.tinta, harga_dasar: $('sbHargaDasar').value, harga_tambahan_warna: $('sbHargaTambahan').value, upah_dasar: $('sbUpahDasar').value, upah_tambahan_warna: $('sbUpahTambahan').value, berlaku_mulai: todayYmd() });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        await refreshMaster(); M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message); loadMasterSablon();
      });
  }

  function drawMasterRiwayat(data) {
    const rows = data.map(r => `<tr><td>${fmtTgl(r.diubah_pada)}</td><td>${esc(r.tabel)}</td><td>${esc(r.item)}</td><td>${esc(r.unit)}</td><td class="r">${r.nilai_lama || '—'} → ${r.nilai_baru}</td><td>${esc(r.diubah_oleh)}</td></tr>`).join('');
    $('masterTabBody').innerHTML = `<div class="card-x flush">${data.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Tabel</th><th>Item</th><th>Unit</th><th class="r">Perubahan</th><th>Oleh</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('bi-clock-history', 'Belum ada riwayat perubahan harga.')}</div>`;
  }
  async function loadMasterRiwayat() {
    await loadInto('master_riwayat', () => Api.get('harga.riwayat', {}), drawMasterRiwayat, () => { $('masterTabBody').innerHTML = skeletonRows(6); });
  }
  async function refreshMaster() {
    const res = await Api.get('master.get', {});
    if (res.success) { S.master = res.data; App.__afterMasterRefresh && App.__afterMasterRefresh(); }
    Cache.invalidateAll();
  }

  // ── PENGATURAN (Owner) ──
  const PDK_LIST = [
    { no: 1, hal: 'Harga aktif awal jahit', ket: 'Apakah harga Excel dipakai sebagai Harga Aktif awal, dan apakah BROTHERHOOD memakai daftar Excel-nya sendiri.', perlakuan: 'Harga Aktif kosong sampai Owner menetapkan di Master Harga.' },
    { no: 2, hal: 'Hutang/Potongan Lain', ket: 'Apakah "Motor 3x" dan "Hutang bulan lalu" berupa uang yang keluar dari kas, dan dari unit mana.', perlakuan: 'Dicatat sebagai Potongan Lain pada gaji, tanpa pengeluaran otomatis.' },
    { no: 3, hal: 'Sumber kasbon BROTHERHOOD', ket: 'BROTHERHOOD tidak punya pihak terkait seperti Dek Agus atau Krisna.', perlakuan: 'Sumber & unit kasbon BROTHERHOOD dikosongkan sampai ditentukan.' },
    { no: 4, hal: 'Metode alokasi gaji harian', ket: 'Metode per karyawan (biaya bersama, persentase, atau manual).', perlakuan: 'Status "Belum Dialokasikan" sampai Owner memilih di halaman Karyawan.' },
    { no: 5, hal: 'Tahun data impor', ket: 'Excel historis hanya menulis nama bulan, tanpa tahun.', perlakuan: 'Tahun diminta/dilengkapi saat mapping kolom Impor Excel.' },
    { no: 6, hal: 'Pembayaran order historis', ket: 'Status bayar per order dan tanggal pembayaran historisnya belum pasti.', perlakuan: 'Order impor berstatus "Perlu Konfirmasi" sampai Owner mengonfirmasi di Piutang.' },
    { no: 7, hal: 'Saldo awal (sisa bulan lalu)', ket: 'Kolom "Sisa Bulan Lalu" pada rekap lama kosong.', perlakuan: 'Saldo awal kosong (Rp0) sampai diisi Owner di Rekap Bulanan.' },
    { no: 8, hal: 'Gaji Galih dan Arif (data Agustus)', ket: 'Slip vs Pengeluaran lama berbeda nilainya — mana yang benar-benar dibayarkan tidak dapat dipastikan sistem.', perlakuan: 'Tidak direkonstruksi otomatis — Owner input manual di modul Gaji bila diperlukan.' },
    { no: 9, hal: 'Kategori pengeluaran Excel', ket: 'Pemetaan baris seperti bensin, wifi, benang, kaporit ke kategori baku belum ditentukan.', perlakuan: 'Kategori dari file impor yang belum dikenal otomatis ditambahkan sebagai kategori baru.' },
    { no: 10, hal: 'Unit pekerjaan tanpa keterangan unit', ket: 'Sebagian catatan pekerjaan historis tidak menulis unit.', perlakuan: 'Ditandai "Unit Perlu Konfirmasi" pada halaman Pekerjaan/Kasbon.' },
    { no: 11, hal: '"Packing Amnesty" & biaya Screen', ket: 'Aturan perhitungannya belum dijelaskan Owner.', perlakuan: 'Belum dibangun sampai aturannya dijelaskan.' },
    { no: 12, hal: 'Definisi status DP vs Sebagian/Cicilan', ket: 'Kapan tepatnya status berpindah dari DP ke Sebagian/Cicilan.', perlakuan: 'Usulan teknis dipakai sementara: DP bila pembayaran satu-satunya berjenis DP, Sebagian/Cicilan bila ada pembayaran lain.' },
    { no: 13, hal: 'Biaya Bersama tanpa unit', ket: 'Apakah Pengeluaran/Gaji boleh tercatat tanpa unit sama sekali (Biaya Bersama).', perlakuan: 'Sistem mengizinkan unit_id kosong sebagai perilaku sementara.' }
  ];
  let pengaturanTab = 'pengguna';
  async function renderPengaturan() {
    const el = $('body-pengaturan');
    el.innerHTML = `
      <div class="page-head"><div><h1>Pengaturan</h1><div class="sub">Akun, kop laporan, kategori pengeluaran, dan daftar keputusan yang masih PERLU DIKONFIRMASI.</div></div></div>
      <div class="mb-16"><div class="tabs-pill" id="pengaturanTabs">
        <button class="${pengaturanTab === 'pengguna' ? 'on' : ''}" data-t="pengguna" onclick="Pages.pengaturanTabGo('pengguna')">Pengguna</button>
        <button class="${pengaturanTab === 'kop' ? 'on' : ''}" data-t="kop" onclick="Pages.pengaturanTabGo('kop')">Kop Laporan</button>
        <button class="${pengaturanTab === 'kategori' ? 'on' : ''}" data-t="kategori" onclick="Pages.pengaturanTabGo('kategori')">Kategori Pengeluaran</button>
        <button class="${pengaturanTab === 'pdk' ? 'on' : ''}" data-t="pdk" onclick="Pages.pengaturanTabGo('pdk')">PERLU DIKONFIRMASI</button>
      </div></div>
      <div id="pengaturanTabBody">${skeletonRows(5)}</div>`;
    loadPengaturanTab();
  }
  /** Ganti sub-tab Pengaturan → respons LANGSUNG: highlight tab seketika, lalu tampilkan data
   *  (dari cache instan bila ada, satu payload 'pengaturan.get' dipakai bersama oleh 3 tab pertama). */
  function pengaturanTabGo(t) {
    pengaturanTab = t;
    document.querySelectorAll('#pengaturanTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    loadPengaturanTab();
  }
  async function loadPengaturanTab() {
    if (pengaturanTab === 'pdk') { drawPdk(); return; }
    await loadInto('pengaturan_get', () => Api.get('pengaturan.get', {}), (data) => {
      S._pengaturan = data;
      if (pengaturanTab === 'pengguna') drawPengguna(data);
      else if (pengaturanTab === 'kop') drawKop(data);
      else if (pengaturanTab === 'kategori') drawKategori(data);
    }, () => { $('pengaturanTabBody').innerHTML = skeletonRows(5); });
  }
  function drawPengguna(d) {
    const rows = d.users.map(u => `<tr><td>${esc(u.nama)}<span class="sub">${esc(u.username)}</span></td><td>${esc(u.role)}</td><td>${u.aktif ? '<span class="chip chip-lunas">Aktif</span>' : '<span class="chip chip-belum">Nonaktif</span>'}</td>
      <td class="gap-row"><button class="btn-pill btn-ghost sm" onclick='Pages.formUser(${jsAttr(u)})'>Ubah</button><button class="btn-pill btn-ghost sm" onclick='Pages.resetPinUser(${jsAttr(u)})'>Reset PIN</button></td></tr>`).join('');
    $('pengaturanTabBody').innerHTML = `<div class="gap-row mb-16"><button class="btn-pill btn-lime" onclick="Pages.formUser()"><i class="bi bi-plus-lg"></i> Pengguna Baru</button></div>
      <div class="card-x flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Peran</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <div class="caption mt-16">Spreadsheet database: <a href="${d.spreadsheetUrl}" target="_blank">buka di Google Sheets</a> · Versi aplikasi ${d.versi}</div>`;
  }
  function formUser(u) {
    openForm(u ? 'Ubah Pengguna' : 'Pengguna Baru', `
      <div class="field mb-16"><label>Username</label><input id="usUsername" class="input-pill" value="${u ? esc(u.username) : ''}" ${u ? 'disabled' : ''}></div>
      <div class="field mb-16"><label>Nama</label><input id="usNama" class="input-pill" value="${u ? esc(u.nama) : ''}"></div>
      <div class="field mb-16"><label>Peran</label><select id="usRole" class="select-pill"><option ${u && u.role === 'Admin' ? 'selected' : ''}>Admin</option><option ${u && u.role === 'Owner' ? 'selected' : ''}>Owner</option></select></div>
      ${!u ? `<div class="field mb-16"><label>PIN Awal (4–8 angka)</label><input id="usPin" type="password" inputmode="numeric" class="input-pill"></div>` : `<div class="field"><label><input type="checkbox" id="usAktif" ${u.aktif ? 'checked' : ''}> Aktif</label></div>`}`,
      async () => {
        const res = await Api.post('user.simpan', { id: u ? u.id : undefined, username: $('usUsername').value, nama: $('usNama').value, role: $('usRole').value, pin: u ? undefined : $('usPin').value, aktif: u ? $('usAktif').checked : true });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        M('modalForm').hide(); showToast('ok', 'Tersimpan', res.message);
        Cache.invalidatePrefix('pengaturan_'); loadPengaturanTab();
      });
  }
  function resetPinUser(u) {
    openForm('Reset PIN — ' + u.nama, `<div class="field"><label>PIN Baru (4–8 angka)</label><input id="rpPin" type="password" inputmode="numeric" class="input-pill"></div>`,
      async () => {
        const res = await Api.post('user.resetPin', { id: u.id, pin: $('rpPin').value });
        if (!res.success) { showToast('err', 'Gagal', res.message); return; }
        M('modalForm').hide(); showToast('ok', 'PIN Direset', res.message);
      }, 'Reset');
  }
  function drawKop(d) {
    $('pengaturanTabBody').innerHTML = `<div class="card-x" style="max-width:520px">
      <div class="field mb-16"><label>Nama pada Kop</label><input id="kpNama" class="input-pill" value="${esc(d.config.kopNama || '')}"></div>
      <div class="field mb-16"><label>Alamat pada Kop</label><input id="kpAlamat" class="input-pill" value="${esc(d.config.kopAlamat || '')}"></div>
      <button class="btn-pill btn-black" id="btnSimpanKop" onclick="Pages.simpanKop()">Simpan</button></div>`;
  }
  async function simpanKop() {
    const btn = $('btnSimpanKop'); const asal = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const kopNama = $('kpNama').value, kopAlamat = $('kpAlamat').value;
      const res = await Api.post('pengaturan.simpan', { kopNama, kopAlamat });
      if (!res.success) { showToast('err', 'Gagal', res.message); return; }
      // Instant UX: langsung perbarui state lokal + cache (tanpa fetch ulang) — komponen lain
      // (Laporan PDF, Slip Gaji PDF) otomatis memakai nilai baru ini pada ekspor berikutnya.
      if (S._pengaturan) S._pengaturan.config = { kopNama, kopAlamat };
      Cache.set('pengaturan_get', S._pengaturan);
      showToast('ok', 'Tersimpan', res.message);
    } finally {
      btn.disabled = false; btn.textContent = asal;
    }
  }
  function drawKategori(d) {
    $('pengaturanTabBody').innerHTML = `<div class="card-x" style="max-width:520px">
      <div class="kv-list mb-16">${(d.kategoriPengeluaran || []).map(k => `<div class="kv"><span class="k">${esc(k)}</span></div>`).join('')}</div>
      <div class="field mb-12"><label>Kategori Baru</label><input id="ktBaru" class="input-pill" placeholder="mis. Listrik"></div>
      <button class="btn-pill btn-lime" onclick="Pages.tambahKategori()"><i class="bi bi-plus"></i> Tambah Kategori</button></div>`;
  }
  async function tambahKategori() {
    const res = await Api.post('kategoriPengeluaran.tambah', { nama: $('ktBaru').value });
    if (!res.success) { showToast('err', 'Gagal', res.message); return; }
    await refreshMaster(); showToast('ok', 'Ditambahkan', res.message);
    Cache.invalidatePrefix('pengaturan_'); loadPengaturanTab();
  }
  function drawPdk() {
    $('pengaturanTabBody').innerHTML = PDK_LIST.map(p => `<div class="pdk mb-12"><b>${p.no}. ${esc(p.hal)}</b><div class="mt-12">${esc(p.ket)}</div><div class="mt-12 caption">Perlakuan sementara sistem: ${esc(p.perlakuan)}</div></div>`).join('');
  }

  // ── IMPOR EXCEL (shell — logika parsing/preview/commit ada di js/import.js) ──
  let imporTipe = 'order';
  async function renderImpor() {
    if (!isOwner()) { $('body-impor').innerHTML = emptyState('bi-lock', 'Hanya Owner yang dapat mengimpor data.'); return; }
    const el = $('body-impor');
    el.innerHTML = `
      <div class="page-head"><div><h1>Impor Excel</h1><div class="sub">Upload → Mapping Kolom → Validasi → Konfirmasi. Tidak ada data yang langsung masuk tanpa pratinjau.</div></div></div>
      <div class="mb-16"><div class="tabs-pill">
        <button class="${imporTipe === 'order' ? 'on' : ''}" onclick="Pages.imporTabGo('order')">Impor Order</button>
        <button class="${imporTipe === 'pekerjaan' ? 'on' : ''}" onclick="Pages.imporTabGo('pekerjaan')">Impor Pekerjaan</button>
        <button class="${imporTipe === 'pengeluaran' ? 'on' : ''}" onclick="Pages.imporTabGo('pengeluaran')">Impor Pengeluaran</button>
        <button class="${imporTipe === 'riwayat' ? 'on' : ''}" onclick="Pages.imporTabGo('riwayat')">Riwayat Impor</button>
      </div></div>
      <div id="imporBody"></div>`;
    if (imporTipe === 'riwayat') loadImporRiwayat(); else Impor.mulai(imporTipe);
  }
  /** Dipanggil juga dari tombol pintasan "Import Excel" di halaman Pekerjaan (lihat renderPekerjaan). */
  function imporTabGo(t) { imporTipe = t; App.navigateTo('impor'); }
  function drawImporRiwayat(data) {
    const rows = data.map(r => `<tr><td>${esc(r.waktu)}</td><td>${esc(r.jenis)}</td><td>${esc(r.sumber_file)}</td><td class="r">${r.jumlah_baris}</td><td class="r">${r.jumlah_masuk}</td><td class="r">${r.jumlah_lewat}</td><td>${esc(r.oleh)}</td></tr>`).join('');
    $('imporBody').innerHTML = `<div class="card-x flush">${data.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Waktu</th><th>Jenis</th><th>File</th><th class="r">Baris</th><th class="r">Masuk</th><th class="r">Dilewati</th><th>Oleh</th></tr></thead><tbody>${rows}</tbody></table></div>` : emptyState('bi-clock-history', 'Belum ada riwayat impor.')}</div>`;
  }
  async function loadImporRiwayat() {
    await loadInto('impor_log', () => Api.get('impor.log', {}), drawImporRiwayat, () => { $('imporBody').innerHTML = skeletonRows(5); });
  }

  return {
    renderDashboard, renderOrderList, renderPiutang, renderKaryawan, renderPekerjaan, renderAbsensi,
    renderKasbon, renderGaji, renderPengeluaran, renderRekap, renderLaporan, renderImpor, renderMaster, renderPengaturan,
    bukaFormOrder, setItemTipe, tambahBarisItem, hapusBarisItem, hitungBaris, simpanOrder, bukaOrderDetail, bukaModalBayar, hapusBayar, hapusOrder,
    konfirmasiImpor,
    karyawanTabGo, formKaryawan, toggleAlokasiFields, hapusKaryawan, formVendor, hapusVendor,
    formPekerjaan, hapusPekerjaan,
    simpanAbsensi,
    formKasbon, hapusKasbon,
    gajiTabGo, gajiHitungBaris, gajiProsesSimpan, gajiKunci, gajiBukaKunci, gajiBayar, lihatSlip, cetakSlipGaji, unduhSlipGaji, formPotonganLain, hapusPotonganLain,
    pengTabGo, formPengeluaran, hapusPengeluaran, formPemasukanLain, hapusPemasukanLain,
    formSaldoAwal,
    laporanGo, eksporPdf,
    masterTabGo, formHargaAktif, terapkanExcel, formJenisBaru, toggleJenisBaruUnit, formSablon, refreshMaster,
    pengaturanTabGo, formUser, resetPinUser, simpanKop, tambahKategori,
    imporTabGo
  };
})();
