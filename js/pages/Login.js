// ============================================================================
// Login page — centered card, email + password, calls `login`, stores
// token, routes to Dashboard.
// ============================================================================
import { login } from '../auth.js';
import { toggleTheme, currentTheme } from '../theme.js';
import { icon } from '../icons.js';
import { BRAND_NAME, preloadLogoSrc, fillMark, applyFavicon } from '../brand.js';
import { warmUpServer } from '../api.js';

export async function render(container) {
  // Wake the Apps Script instance now (cold start is the slowest part of the
  // first login) — it runs while the user is typing their credentials.
  warmUpServer();
  container.innerHTML = `
    <button class="theme-toggle login-theme-toggle" data-theme-toggle id="login-theme-btn"></button>
    <div class="login-screen">
      <div class="login-card">
        <div class="brand-mark">BW</div>
        <h1>${BRAND_NAME}</h1>
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
  // Logo Brotherhood yang sama dengan header/splash/favicon (dari cache perangkat; "BW" bila belum pernah ada logo).
  const logoSrc = preloadLogoSrc();
  fillMark(container.querySelector('.brand-mark'), logoSrc);
  applyFavicon(logoSrc);

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

    // Cold start can take a few seconds — say so instead of looking frozen.
    const slowTimer = setTimeout(() => {
      notice.style.display = 'flex';
      notice.className = 'notice notice-info mt-16';
      notice.textContent = 'Menghubungi server, mohon tunggu sebentar…';
    }, 3500);

    let result;
    try {
      result = await login(email, password);
    } catch (err) {
      // login() never throws by design; this is a last-resort guard so the
      // button can never stay stuck on "Memproses..." and the app never crashes.
      result = { success: false, message: (err && err.message) || 'Login gagal. Silakan coba lagi.' };
    }

    clearTimeout(slowTimer);
    btn.disabled = false;
    btn.textContent = 'Masuk';

    if (result.success) {
      notice.style.display = 'none';
      location.hash = '#/dashboard';
    } else {
      notice.style.display = 'flex';
      notice.className = 'notice notice-critical mt-16';
      // textContent-safe: the message can contain server text
      notice.innerHTML = `${icon('alert')} <span></span>`;
      notice.querySelector('span').textContent = result.message || 'Login gagal.';
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
