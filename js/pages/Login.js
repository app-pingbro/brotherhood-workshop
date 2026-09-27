// ============================================================================
// Login page — centered card, email + password, calls `login`, stores
// token, routes to Dashboard.
// ============================================================================
import { login } from '../auth.js';
import { toggleTheme, currentTheme } from '../theme.js';
import { icon } from '../icons.js';
import { APP_NAME } from '../config.js';
import { peek } from '../cache.js';

// Pre-login: there's no authenticated getLookups() call yet (the API
// requires a token), so this can only use whatever getLookups() payload is
// already sitting in this tab's cache from an earlier session (same
// person logging back in) — never a fresh fetch. Falls back to the "BW"
// text mark otherwise; the real logo always shows once logged in
// regardless (router.js's shell fetches getLookups() right after auth).
function cachedLogoUrl() {
  try {
    const cached = peek('getLookups', {});
    const rows = cached && cached.settings;
    if (!Array.isArray(rows)) return null;
    const row = rows.find((r) => r.key === 'company_logo');
    if (!row || !row.value) return null;
    const ref = JSON.parse(row.value);
    return (ref && ref.url) || null;
  } catch (e) {
    return null;
  }
}

export async function render(container) {
  const logoUrl = cachedLogoUrl();
  container.innerHTML = `
    <button class="theme-toggle login-theme-toggle" data-theme-toggle id="login-theme-btn"></button>
    <div class="login-screen">
      <div class="login-card">
        <div class="brand-mark">${logoUrl ? `<img src="${logoUrl}" alt="Logo perusahaan" />` : 'BW'}</div>
        <h1>${APP_NAME}</h1>
        <div class="subtitle">Masuk untuk mengelola laporan bulanan workshop.</div>
        <form id="login-form" novalidate>
          <div class="field mb-12" id="field-email">
            <label for="login-email">Email <span class="required-mark">*</span></label>
            <input class="input" type="email" id="login-email" autocomplete="username" placeholder="nama@brotherhood.id" />
            <div class="error-msg" id="err-email" style="display:none"></div>
          </div>
          <div class="field mb-12" id="field-password">
            <label for="login-password">Password <span class="required-mark">*</span></label>
            <input class="input" type="password" id="login-password" autocomplete="current-password" placeholder="••••••••" />
            <div class="error-msg" id="err-password" style="display:none"></div>
          </div>
          <button class="btn btn-primary btn-block mt-8" id="login-submit" type="submit">Masuk</button>
          <div class="notice notice-info mt-16" id="login-notice" style="display:none"></div>
        </form>
      </div>
    </div>
  `;

  const themeBtn = document.getElementById('login-theme-btn');
  themeBtn.innerHTML = currentTheme() === 'dark' ? '☀' : '\u{1F319}';
  themeBtn.addEventListener('click', () => {
    toggleTheme();
    themeBtn.innerHTML = currentTheme() === 'dark' ? '☀' : '\u{1F319}';
  });

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    let valid = true;
    valid = validateField('email', email, (v) => /.+@.+\..+/.test(v), 'Masukkan email yang valid.') && valid;
    valid = validateField('password', password, (v) => v.length >= 4, 'Password minimal 4 karakter.') && valid;
    if (!valid) return;

    const btn = document.getElementById('login-submit');
    btn.disabled = true;
    btn.textContent = 'Memproses...';
    const notice = document.getElementById('login-notice');
    notice.style.display = 'none';

    const result = await login(email, password);

    btn.disabled = false;
    btn.textContent = 'Masuk';

    if (result.success) {
      location.hash = '#/dashboard';
    } else {
      notice.style.display = 'flex';
      notice.className = 'notice notice-critical mt-16';
      notice.innerHTML = `${icon('alert')} ${result.message || 'Login gagal.'}`;
    }
  });
}

function validateField(name, value, test, message) {
  const wrap = document.getElementById(`field-${name}`);
  const err = document.getElementById(`err-${name}`);
  const ok = test(value);
  wrap.classList.toggle('has-error', !ok);
  err.style.display = ok ? 'none' : 'block';
  err.textContent = message;
  return ok;
}
