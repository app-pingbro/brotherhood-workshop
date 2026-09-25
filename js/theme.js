// ============================================================================
// Light/dark theme toggle, persisted to localStorage('bw_theme').
// Default is light ("Brotherhood"). A tiny inline script in index.html
// applies the stored/preferred theme before first paint to avoid a flash;
// this module owns the toggle button + persistence for the rest of the app.
// ============================================================================

const STORAGE_KEY = 'bw_theme';

export function getStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark' || theme === 'light') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
  updateToggleIcon(theme);
}

export function setTheme(theme) {
  applyTheme(theme);
  try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore */ }
}

export function currentTheme() {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr) return attr;
  return 'light';
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function initThemeDefault() {
  // Default is LIGHT regardless of OS preference, per spec. Only honor a
  // previously-saved explicit choice.
  const stored = getStoredTheme();
  applyTheme(stored === 'dark' ? 'dark' : 'light');
}

function updateToggleIcon(theme) {
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.innerHTML = theme === 'dark' ? '☀️' : '\u{1F319}';
    btn.setAttribute('title', theme === 'dark' ? 'Ganti ke tampilan terang' : 'Ganti ke tampilan gelap');
  });
}
