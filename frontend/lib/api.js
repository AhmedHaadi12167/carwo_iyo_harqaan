// API address: use NEXT_PUBLIC_API_URL if set, otherwise talk to port 5000
// on the SAME host the page was opened from. This makes phones on the WiFi
// (http://192.168.x.x:3000) automatically reach the backend correctly.
const BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:5000`
    : 'http://localhost:5000');

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('bt_token');
}

export function getUser() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('bt_user')); } catch { return null; }
}

export function setSession(token, user) {
  localStorage.setItem('bt_token', token);
  localStorage.setItem('bt_user', JSON.stringify(user));
}

// Patch the cached copy of the logged-in user (after renaming yourself,
// say). The auth token is keyed on the user id, not the username, so it
// stays valid — only this local copy needs refreshing.
export function updateStoredUser(patch) {
  const current = getUser();
  if (!current) return null;
  const next = { ...current, ...patch };
  localStorage.setItem('bt_user', JSON.stringify(next));
  return next;
}

export function clearSession() {
  localStorage.removeItem('bt_token');
  localStorage.removeItem('bt_user');
}

export async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/login')) {
    clearSession();
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const money = (n) =>
  `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// WhatsApp deep link: wa.me needs digits only (country code included, no +)
export function whatsappLink(phone, text) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export const GARMENTS = [
  { value: 'suit', label: 'Suit' },
  { value: 'shirt', label: 'Shirt' },
  { value: 'khamiis', label: 'Khamiis' },
  { value: 'safari_suit', label: 'Safari Suit' },
  { value: 'jacket', label: 'Jacket' },
  { value: 'trouser', label: 'Trouser' },
  { value: 'other', label: 'Other' },
];

export const garmentLabel = (v) => (GARMENTS.find((g) => g.value === v)?.label || v || '—');

// Where each role lands right after login (and where the layout sends them
// back to if they wander somewhere their role can't use).
export function defaultRouteForRole(role) {
  if (role === 'tailor') return '/tailor';
  if (role === 'master_tailor') return '/tailoring';
  if (role === 'cashier') return '/orders';
  return '/dashboard';
}

export const PAYMENT_METHODS = [
  { value: 'premier_bank', label: 'Premier Bank' },
  { value: 'ibs_bank', label: 'IBS Bank' },
  { value: 'salaam_bank', label: 'Salaam Bank' },
  { value: 'my_bank', label: 'My Bank' },
  { value: 'dahabshiil_bank', label: 'Dahabshiil Bank' },
  { value: 'edahab', label: 'EDahab' },
  { value: 'merchant', label: 'Merchant' },
  { value: 'evc_plus', label: 'EVC Plus' },
  { value: 'my_cash', label: 'My Cash' },
  { value: 'cash', label: 'Cash' },
];
// Old payments recorded before this list existed keep their original value
// (evc/bank/other) — this fills in a readable label for those too.
const LEGACY_PAYMENT_LABELS = { evc: 'EVC (legacy)', bank: 'Bank (legacy)', other: 'Other (legacy)' };
export const paymentMethodLabel = (v) =>
  PAYMENT_METHODS.find((m) => m.value === v)?.label || LEGACY_PAYMENT_LABELS[v] || v || '—';

// 5% VAT on every non-cash payment method — cash is never taxed.
// It is worked out from the ORDER PRICE, once, when the order is created:
//     Price 50 by bank -> VAT 2.50 -> Total 52.50 (pay this to be PAID)
// Never apply it per payment — that made the balance impossible to clear.
// Mirrors the backend's vatFor() in orders.js so previews match what saves.
export const VAT_RATE = 0.05;
export const vatFor = (method, amount) =>
  method === 'cash' ? 0 : Math.round((Number(amount) || 0) * VAT_RATE * 100) / 100;

export const TROUSER_FIELDS = [
  ['length', 'Length'], ['in_seam', 'In Seam'], ['waist', 'Waist'], ['hip', 'Hip'],
  ['thigh', 'Thigh'], ['knee', 'Knee'], ['bottom', 'Bottom'], ['cav', 'Cav'], ['b', 'B'], ['f', 'F'],
];

export const COAT_FIELDS = [
  ['length', 'Length'], ['sleeves', 'Sleeves'], ['shoulder', 'Shoulder'], ['cross_back', 'Cross Back'],
  ['half_back', 'Half Back'], ['neck', 'Neck'], ['chest', 'Chest'], ['waist', 'Waist'],
  ['stomach', 'Stomach'], ['hip', 'Hip'], ['down', 'Down'],
];
