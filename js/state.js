// ============================================================================
// Shared application state — single source of truth for the logged-in
// session, the global period/owner filters in the top bar, and a tiny
// pub/sub so pages can react when those filters change (per spec: the
// month/period selector and owner filter live once, not duplicated per page).
// ============================================================================

const listeners = new Set();

const state = {
  token: null,
  user: null,          // {id, name, role}
  periods: [],          // from getLookups/getPeriods
  currentPeriodId: null,
  ownerFilter: 'ALL',   // 'ALL' | 'PINGBRO' | 'SUNRISE' | 'BROTHERHOOD'
  lookups: null         // cached getLookups() payload
};

export function getState() {
  return state;
}

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(key) {
  listeners.forEach((fn) => {
    try { fn(key, state); } catch (e) { console.error(e); }
  });
}

// ---- Auth/session -----------------------------------------------------
export function getToken() {
  if (state.token) return state.token;
  try {
    const raw = sessionStorage.getItem('bw_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      state.token = parsed.token;
      state.user = parsed.user;
      return state.token;
    }
  } catch (e) { /* sessionStorage unavailable */ }
  return null;
}

export function getUser() {
  if (!state.user) getToken();
  return state.user;
}

export function setSession(token, user) {
  state.token = token;
  state.user = user;
  try {
    sessionStorage.setItem('bw_session', JSON.stringify({ token, user }));
  } catch (e) { /* ignore quota/private-mode errors */ }
  emit('session');
}

export function clearSession() {
  state.token = null;
  state.user = null;
  try { sessionStorage.removeItem('bw_session'); } catch (e) { /* ignore */ }
  emit('session');
}

// ---- Global filters -----------------------------------------------------
export function setPeriods(periods) {
  state.periods = periods || [];
  if (!state.currentPeriodId && state.periods.length) {
    const open = state.periods.find((p) => (p.status || '').toLowerCase() === 'open');
    state.currentPeriodId = (open || state.periods[state.periods.length - 1]).id;
  }
  emit('periods');
}

export function getCurrentPeriod() {
  return state.periods.find((p) => p.id === state.currentPeriodId) || null;
}

export function setCurrentPeriodId(id) {
  state.currentPeriodId = id;
  emit('period');
}

export function setOwnerFilter(code) {
  state.ownerFilter = code;
  emit('owner');
}

export function getOwnerFilter() {
  return state.ownerFilter;
}

export function setLookups(lookups) {
  state.lookups = lookups;
  if (lookups && lookups.periods) setPeriods(lookups.periods);
  emit('lookups');
}

export function getLookups() {
  return state.lookups;
}
