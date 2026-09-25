// ============================================================================
// Hash-based client router. Owns the global app shell (sidebar + topbar),
// the shared month/period + owner-unit filters, and swaps page content
// into #view without ever reloading the document — a true SPA.
// ============================================================================
import { OWNERS } from './config.js';
import { icon } from './icons.js';
import { fetchData } from './api.js';
import {
  getState, onStateChange, getToken, getUser, setLookups, getLookups,
  getCurrentPeriod, setCurrentPeriodId, getOwnerFilter, setOwnerFilter
} from './state.js';
import { isAuthenticated, requireAuth, logout } from './auth.js';
import { toggleTheme, currentTheme } from './theme.js';
import { toast } from './ui.js';

import * as LoginPage from './pages/Login.js';
import * as DashboardPage from './pages/Dashboard.js';
import * as JahitPage from './pages/Jahit.js';
import * as SablonPage from './pages/Sablon.js';
import * as ImportExcelPage from './pages/ImportExcel.js';
import * as GajiJahitPage from './pages/GajiJahit.js';
import * as GajiSablonPage from './pages/GajiSablon.js';
import * as GajiHarianPage from './pages/GajiHarian.js';
import * as KasbonPage from './pages/Kasbon.js';
import * as PengeluaranPage from './pages/Pengeluaran.js';
import * as SlipGajiPage from './pages/SlipGaji.js';
import * as RekapBulananPage from './pages/RekapBulanan.js';
import * as MasterDataPage from './pages/MasterData.js';

const NAV = [
  { group: 'Ringkasan', items: [
    { path: '#/dashboard', label: 'Dashboard', icon: 'dashboard', page: DashboardPage }
  ] },
  { group: 'Transaksi', items: [
    { path: '#/jahit', label: 'Jahit', icon: 'scissors', page: JahitPage },
    { path: '#/sablon', label: 'Sablon', icon: 'droplet', page: SablonPage },
    { path: '#/import-excel', label: 'Import Excel', icon: 'upload', page: ImportExcelPage }
  ] },
  { group: 'Penggajian', items: [
    { path: '#/gaji-jahit', label: 'Gaji Jahit', icon: 'needle', page: GajiJahitPage },
    { path: '#/gaji-sablon', label: 'Gaji Sablon', icon: 'droplet', page: GajiSablonPage },
    { path: '#/gaji-harian', label: 'Gaji Harian & Lembur', icon: 'clock', page: GajiHarianPage },
    { path: '#/kasbon', label: 'Kasbon & Potongan', icon: 'minus', page: KasbonPage },
    { path: '#/slip-gaji', label: 'Slip Gaji', icon: 'file', page: SlipGajiPage }
  ] },
  { group: 'Keuangan', items: [
    { path: '#/pengeluaran', label: 'Pengeluaran', icon: 'receipt', page: PengeluaranPage },
    { path: '#/rekap-bulanan', label: 'Rekap Bulanan', icon: 'chart', page: RekapBulananPage }
  ] },
  { group: 'Sistem', items: [
    { path: '#/master-data', label: 'Master Data', icon: 'settings', page: MasterDataPage }
  ] }
];

const ROUTES = {};
NAV.forEach((g) => g.items.forEach((i) => { ROUTES[i.path] = i; }));
ROUTES['#/login'] = { path: '#/login', page: LoginPage, label: 'Login' };

let shellBuilt = false;
let currentPage = null;
let lookupsLoaded = false;

export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

async function handleRoute() {
  let hash = location.hash || '#/dashboard';
  if (!ROUTES[hash]) hash = isAuthenticated() ? '#/dashboard' : '#/login';

  if (hash === '#/login') {
    if (isAuthenticated()) { location.hash = '#/dashboard'; return; }
    lookupsLoaded = false; // force a fresh getLookups() on the next login
    renderLoginOnly();
    return;
  }

  if (!requireAuth()) return;

  if (!shellBuilt) buildShell();
  document.getElementById('app-shell').classList.remove('is-hidden');
  const loginRoot = document.getElementById('login-root');
  if (loginRoot) loginRoot.remove();
  updateUserChip();

  if (!lookupsLoaded) await loadLookups();

  setActiveNav(hash);
  const route = ROUTES[hash];
  document.getElementById('topbar-title').textContent = route.label;
  await mountPage(route.page);
}

async function loadLookups() {
  try {
    const data = await fetchData('getLookups', {});
    setLookups(data || {});
    renderPeriodSelect();
    lookupsLoaded = true;
  } catch (e) {
    // fetchData already toasts; keep app usable, periods dropdown stays empty
  }
}

async function mountPage(pageModule) {
  const container = document.getElementById('view');
  if (currentPage && typeof currentPage.onLeave === 'function') {
    try { currentPage.onLeave(); } catch (e) { /* ignore */ }
  }
  currentPage = pageModule;
  container.innerHTML = '';
  try {
    await pageModule.render(container);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="card"><div class="notice notice-critical">${icon('alert')} Gagal memuat halaman: ${(err && err.message) || err}</div></div>`;
  }
}

async function refreshCurrentPage() {
  if (currentPage) await mountPage(currentPage);
}

function setActiveNav(hash) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.path === hash);
  });
}

// ---------------------------------------------------------------------------
// Shell (sidebar + topbar) — built once after first authenticated route.
// ---------------------------------------------------------------------------
function buildShell() {
  const root = document.getElementById('shell-root');
  root.innerHTML = `
    <div id="app-shell">
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      <aside class="sidebar" id="sidebar">
        <div class="sidebar__brand">
          <div class="sidebar__brand-mark">BW</div>
          <div class="sidebar__brand-text">Workshop Manager<small>PINGBRO · SUNRISE · BROTHERHOOD</small></div>
        </div>
        <nav class="sidebar__nav" id="sidebar-nav"></nav>
        <div class="sidebar__footer">
          <div class="user-chip">
            <div class="user-chip__avatar" id="user-avatar">?</div>
            <div class="user-chip__meta">
              <div class="name" id="user-name">-</div>
              <div class="role" id="user-role">-</div>
            </div>
            <button class="logout-btn" id="logout-btn" title="Keluar">${icon('logout')}</button>
          </div>
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <button class="topbar__menu-btn" id="menu-btn" aria-label="Buka menu">${icon('menu')}</button>
          <div class="topbar__title" id="topbar-title">Dashboard</div>
          <div class="topbar__controls">
            <select class="select-control" id="period-select" title="Periode"></select>
            <div class="owner-filter-pills" id="owner-pills"></div>
            <button class="theme-toggle" data-theme-toggle id="theme-btn" title="Ganti tema"></button>
          </div>
        </header>
        <main class="view-container" id="view"></main>
      </div>
    </div>
  `;

  // Nav items
  const navRoot = document.getElementById('sidebar-nav');
  NAV.forEach((group) => {
    const label = document.createElement('div');
    label.className = 'nav-section-label';
    label.textContent = group.group;
    navRoot.appendChild(label);
    group.items.forEach((item) => {
      const btn = document.createElement('button');
      btn.className = 'nav-item';
      btn.dataset.path = item.path;
      btn.innerHTML = `<span class="nav-item__icon">${icon(item.icon)}</span><span>${item.label}</span>`;
      btn.addEventListener('click', () => {
        location.hash = item.path;
        closeSidebar();
      });
      navRoot.appendChild(btn);
    });
  });

  // Owner pills
  const pillsRoot = document.getElementById('owner-pills');
  const pillDefs = [{ code: 'ALL', name: 'Semua' }, ...OWNERS];
  pillsRoot.innerHTML = pillDefs.map((o) => `
    <button class="owner-pill${o.code === getOwnerFilter() ? ' is-active' : ''}" data-owner="${o.code}">
      ${o.code === 'ALL' ? '' : `<span class="owner-dot owner-dot--${o.code.toLowerCase()}"></span>`}${o.name}
    </button>
  `).join('');
  pillsRoot.querySelectorAll('.owner-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOwnerFilter(btn.dataset.owner);
      pillsRoot.querySelectorAll('.owner-pill').forEach((b) => b.classList.toggle('is-active', b === btn));
      refreshCurrentPage();
    });
  });

  // Period select
  document.getElementById('period-select').addEventListener('change', (e) => {
    setCurrentPeriodId(e.target.value);
    refreshCurrentPage();
  });

  // Theme
  const themeBtn = document.getElementById('theme-btn');
  themeBtn.innerHTML = currentTheme() === 'dark' ? '☀' : '\u{1F319}';
  themeBtn.addEventListener('click', () => toggleTheme());

  // User chip
  updateUserChip();
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await logout();
  });

  // Mobile drawer
  document.getElementById('menu-btn').addEventListener('click', openSidebar);
  document.getElementById('sidebar-backdrop').addEventListener('click', closeSidebar);

  shellBuilt = true;
}

function updateUserChip() {
  const user = getUser();
  const avatar = document.getElementById('user-avatar');
  if (!avatar) return;
  avatar.textContent = user ? (user.name || '?').trim().charAt(0).toUpperCase() : '?';
  document.getElementById('user-name').textContent = (user && user.name) || 'User';
  document.getElementById('user-role').textContent = (user && user.role) || '';
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('is-open');
  document.getElementById('sidebar-backdrop').classList.add('is-open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('is-open');
  document.getElementById('sidebar-backdrop')?.classList.remove('is-open');
}

function renderPeriodSelect() {
  const sel = document.getElementById('period-select');
  if (!sel) return;
  const state = getState();
  if (!state.periods.length) {
    sel.innerHTML = '<option value="">Belum ada periode</option>';
    return;
  }
  sel.innerHTML = state.periods
    .slice()
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .reverse()
    .map((p) => `<option value="${p.id}"${p.id === state.currentPeriodId ? ' selected' : ''}>${p.label || (p.month + '/' + p.year)}${(p.status || '').toLowerCase() === 'closed' ? ' \u{1F512}' : ''}</option>`)
    .join('');
}

onStateChange((key) => {
  if (key === 'periods' || key === 'lookups') renderPeriodSelect();
});

// ---------------------------------------------------------------------------
// Login-only render (no shell)
// ---------------------------------------------------------------------------
async function renderLoginOnly() {
  document.getElementById('app-shell')?.classList.add('is-hidden');
  let root = document.getElementById('login-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'login-root';
    document.getElementById('shell-root').appendChild(root);
  }
  root.innerHTML = '';
  await LoginPage.render(root);
}

export function navigateTo(path) {
  location.hash = path;
}

export { fetchData as _fetchDataForPages };
