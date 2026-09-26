// ============================================================================
// Small helpers for resolving ids <-> labels against the cached getLookups()
// payload (owners, employees, productTypes, sewingJobTypes, inkTypes,
// expenseTypes). Kept separate from state.js so state.js stays a pure store.
// ============================================================================

export function ownerIdByCode(lookups, code) {
  if (!code || code === 'ALL') return undefined;
  const owner = (lookups?.owners || []).find((o) => o.code === code);
  return owner ? owner.id : undefined;
}

export function ownerCodeById(lookups, id) {
  const owner = (lookups?.owners || []).find((o) => o.id === id);
  return owner ? owner.code : '';
}

export function ownerName(lookups, id) {
  const owner = (lookups?.owners || []).find((o) => o.id === id);
  return owner ? owner.name : '-';
}

export function nameById(list, id) {
  const item = (list || []).find((x) => x.id === id);
  return item ? item.name : '-';
}

export function byId(list, id) {
  return (list || []).find((x) => x.id === id) || null;
}

export function activeOnly(list) {
  return (list || []).filter((x) => x.active !== false);
}

export function toOptions(list, labelKey = 'name') {
  return activeOnly(list).map((x) => ({ value: x.id, label: x[labelKey] }));
}

export function ownerOptions(lookups, restrictCodes) {
  let owners = lookups?.owners || [];
  if (restrictCodes) owners = owners.filter((o) => restrictCodes.includes(o.code));
  return owners.map((o) => ({ value: o.id, label: o.name }));
}
