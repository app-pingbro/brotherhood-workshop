// ============================================================================
// Brotherhood Workshop Manager — Configuration
// ============================================================================
// Paste your deployed Google Apps Script Web App URL below (ends with /exec).
// Deploy: Apps Script editor -> Deploy -> New deployment -> Web app
//         Execute as: Me · Who has access: Anyone
export const GAS_URL = 'https://script.google.com/macros/s/AKfycbzQ-x9DJCyfRKbXpDIfvZ0SrDTgCKpCLoCygNeZYex_UklkT_-kLg6NMBA7-t_-O8hr/exec';

// App-wide constants (must match the backend contract exactly).
export const OWNERS = [
  { code: 'PINGBRO', name: 'Pingbro' },
  { code: 'SUNRISE', name: 'Sunrise' },
  { code: 'BROTHERHOOD', name: 'Brotherhood' }
];

// Owners allowed to carry operational Pengeluaran (Expenses).
export const EXPENSE_OWNERS = ['PINGBRO', 'SUNRISE'];

export const DEDUCTION_TYPES = [
  { value: 'kasbon', label: 'Kasbon' },
  { value: 'hutang_cicilan', label: 'Hutang - Cicilan' },
  { value: 'potongan_lain', label: 'Potongan Lain' }
];

export const APP_NAME = 'Brotherhood Workshop Manager';
export const TOKEN_TTL_HOURS = 12;

// price_rules.category values — MUST match backend/Transactions.gs and
// backend/Payroll.gs's PRICE_CATEGORY constant exactly (verified against the
// actual backend source, not guessed): Jahit(jual)/Sablon(jual) use the
// owner's price_group_id, Borongan variants always use price_group_id =
// null/global.
export const PRICE_CATEGORY = {
  JAHIT: 'Jahit Jual',
  SABLON: 'Sablon Jual',
  JAHIT_BORONGAN: 'Jahit Borongan',
  SABLON_BORONGAN: 'Sablon Borongan'
};
