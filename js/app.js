// ============================================================
// APP — bootstrap, login, navigasi SPA (0ms, tanpa reload), sesi
// ============================================================

const NAV = [
  { id: 'dashboard', icon: 'bi-grid-1x2', label: 'Dashboard' },
  { id: 'order', icon: 'bi-receipt', label: 'Order' },
  { id: 'piutang', icon: 'bi-hourglass-split', label: 'Piutang' },
  { id: 'karyawan', icon: 'bi-people', label: 'Karyawan' },
  { id: 'pekerjaan', icon: 'bi-scissors', label: 'Pekerjaan' },
  { id: 'absensi', icon: 'bi-calendar-check', label: 'Absensi' },
  { id: 'kasbon', icon: 'bi-cash-coin', label: 'Kasbon' },
  { id: 'gaji', icon: 'bi-wallet2', label: 'Gaji' },
  { id: 'pengeluaran', icon: 'bi-cart-dash', label: 'Pengeluaran' },
  { id: 'rekap', icon: 'bi-bar-chart', label: 'Rekap' },
  { id: 'laporan', icon: 'bi-file-earmark-text', label: 'Laporan' },
  { id: 'impor', icon: 'bi-file-earmark-arrow-up', label: 'Impor', ownerOnly: true },
  { id: 'master', icon: 'bi-tags', label: 'Master' },
  { id: 'pengaturan', icon: 'bi-gear', label: 'Setelan', ownerOnly: true }
];

const App = (() => {

  function renderNav() {
    const nav = NAV.filter(n => !n.ownerOnly || isOwner());
    const item = n => `<button class="rail-item" data-nav="${n.id}" onclick="App.navigateTo('${n.id}')"><i class="bi ${n.icon}"></i><span>${n.label}</span></button>`;
    $('railNav').innerHTML = nav.map(item).join('');
    $('bottomBar').innerHTML = nav.slice(0, 5).map(item).join('');
  }

  function navigateTo(id) {
    S.section = id;
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    const el = $('section-' + id);
    if (el) el.classList.add('active');
    const navId = (id === 'orderForm' || id === 'orderDetail') ? 'order' : id;
    document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === navId));

    const pakaiPeriode = ['dashboard', 'order', 'rekap', 'laporan'].indexOf(id) >= 0;
    const pakaiUnit = pakaiPeriode || ['piutang', 'pengeluaran'].indexOf(id) >= 0;
    $('periodPills').classList.toggle('hide', !pakaiPeriode);
    $('rangePop').classList.toggle('hide', !pakaiPeriode || S.periodeMode !== 'rentang');
    $('unitDd').classList.toggle('hide', !pakaiUnit);
    window.scrollTo({ top: 0 });
    Pref.set('lastSection', id);

    const render = {
      dashboard: Pages.renderDashboard, order: Pages.renderOrderList, piutang: Pages.renderPiutang,
      karyawan: Pages.renderKaryawan, pekerjaan: Pages.renderPekerjaan, absensi: Pages.renderAbsensi,
      kasbon: Pages.renderKasbon, gaji: Pages.renderGaji, pengeluaran: Pages.renderPengeluaran,
      rekap: Pages.renderRekap, laporan: Pages.renderLaporan, impor: Pages.renderImpor,
      master: Pages.renderMaster, pengaturan: Pages.renderPengaturan
    }[id];
    if (render) render();
  }

  function onSessionExpired() {
    Api.setToken('');
    S.user = null;
    showLogin('Sesi berakhir. Silakan masuk kembali.');
  }

  function showLogin(pesan) {
    $('loadingOverlay').style.display = 'none';
    $('appShell').classList.remove('on');
    $('loginScreen').classList.remove('hide');
    if (pesan) { $('loginError').textContent = pesan; $('loginError').classList.remove('hide'); }
  }

  async function boot() {
    toggleTheme(Pref.get('theme', 'light'));
    S.unitFilter = Pref.get('unitFilter', '');
    const token = Api.getToken();
    if (!token) { showLogin(); return; }
    const res = await Api.get('cekSesi', {});
    if (!res.success) { showLogin(); return; }
    await afterLogin();
  }

  async function afterLogin() {
    const res = await Api.post('app.init', {});
    if (!res.success) { showLogin(res.message); return; }
    S.user = res.data.user;
    S.master = res.data.master;
    S.epoch = res.data.epoch;
    S._initDashboard = res.data.dashboardAwal; // sudah tersedia — Dashboard tampil tanpa loading tambahan
    $('loadingOverlay').style.display = 'none';
    $('loginScreen').classList.add('hide');
    $('appShell').classList.add('on');
    $('userChip').textContent = S.user.nama + ' · ' + S.user.role;
    $('loginKop').textContent = (res.data.config && res.data.config.kopAlamat) || APP_CONFIG.namaApp;
    renderNav();
    renderUnitMenu();
    const dari = periodeIni() + '-01', sampai = todayYmd();
    S.dari = dari; S.sampai = sampai;
    if (res.data.wajibGantiPin) bukaModalPin(true);
    navigateTo(Pref.get('lastSection', 'dashboard'));
  }

  function renderUnitMenu() {
    const units = S.master.units || [];
    const opt = u => `<button onclick="App.pilihUnit('${u ? u.id : ''}')" class="${(!u && !S.unitFilter) || (u && S.unitFilter === u.id) ? 'sel' : ''}">${u ? `<span class="swatch" style="background:${esc(u.warna)}"></span>${esc(u.nama)}` : '<span class="swatch" style="background:#ccc"></span>Semua Unit'}</button>`;
    $('unitMenu').innerHTML = opt(null) + units.map(opt).join('');
    $('unitDots').innerHTML = units.map(u => `<i style="background:${esc(u.warna)}"></i>`).join('');
    const cur = unitById(S.unitFilter);
    $('unitLabel').textContent = cur ? cur.nama : 'Semua Unit';
  }
  function toggleUnitMenu(e) { e.stopPropagation(); $('unitMenu').classList.toggle('on'); }
  function pilihUnit(id) {
    S.unitFilter = id; Pref.set('unitFilter', id);
    $('unitMenu').classList.remove('on');
    renderUnitMenu();
    Cache.invalidateAll();
    navigateTo(S.section);
  }

  function setPeriode(mode) {
    S.periodeMode = mode;
    document.querySelectorAll('#periodPills button').forEach(b => b.classList.toggle('on', b.dataset.p === mode));
    $('rangePop').classList.toggle('on', mode === 'rentang');
    const t = todayYmd();
    if (mode === 'hari') { S.dari = t; S.sampai = t; }
    else if (mode === 'minggu') { S.dari = mondayOf(t); S.sampai = t; }
    else if (mode === 'bulan') { S.dari = periodeIni() + '-01'; S.sampai = t; }
    else { $('rgDari').value = S.dari; $('rgSampai').value = S.sampai; return; }
    navigateTo(S.section);
  }
  function terapkanRentang() {
    const d = $('rgDari').value, s = $('rgSampai').value;
    if (!d || !s || d > s) { showToast('warn', 'Rentang tidak valid', 'Periksa tanggal mulai dan akhir.'); return; }
    S.dari = d; S.sampai = s;
    navigateTo(S.section);
  }

  function bukaModalPin(wajib) {
    $('pinBatal').classList.toggle('hide', !!wajib);
    $('pinNotice').textContent = wajib ? 'PIN bawaan harus diganti sebelum aplikasi dipakai.' : 'Ganti PIN Anda kapan saja di sini.';
    $('pinLama').value = ''; $('pinBaru').value = ''; $('pinBaru2').value = '';
    M('modalPin').show();
  }
  async function simpanPinBaru() {
    const lama = $('pinLama').value, baru = $('pinBaru').value, ulang = $('pinBaru2').value;
    if (baru !== ulang) { showToast('warn', 'Tidak cocok', 'PIN baru dan ulangi PIN baru harus sama.'); return; }
    const res = await Api.post('pin.ubah', { pin_lama: lama, pin_baru: baru });
    if (!res.success) { showToast('err', 'Gagal', res.message); return; }
    showToast('ok', 'Berhasil', res.message);
    M('modalPin').hide();
  }

  function logout() {
    konfirmasi('Keluar Aplikasi', '<p>Anda yakin ingin keluar?</p>', 'Ya, Keluar', async () => {
      Api.setToken('');
      S.user = null; Cache.invalidateAll();
      location.reload();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      $('loginError').classList.add('hide');
      const btn = $('loginBtn'); btn.disabled = true; btn.innerHTML = '<span class="spin spin-sm"></span> Memproses...';
      const res = await Api.post('login', { username: $('loginUser').value, pin: $('loginPin').value });
      btn.disabled = false; btn.textContent = 'Masuk';
      if (!res.success) { $('loginError').textContent = res.message; $('loginError').classList.remove('hide'); return; }
      Api.setToken(res.data.token);
      await afterLogin();
    });
    $('pinSimpan').addEventListener('click', simpanPinBaru);
    document.addEventListener('click', e => {
      if (!e.target.closest('#unitDd')) $('unitMenu').classList.remove('on');
    });
    boot();
  });

  return { navigateTo, onSessionExpired, pilihUnit, toggleUnitMenu, setPeriode, terapkanRentang, logout, bukaModalPin, afterLogin };
})();
