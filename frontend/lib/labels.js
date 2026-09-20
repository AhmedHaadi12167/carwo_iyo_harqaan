/**
 * Somali (af-Soomaali) interface wording.
 *
 * SCOPE — deliberately narrow. Only the terms that were explicitly asked for
 * are translated. Everything else stays in English on purpose:
 *   - most table column headers (Status, Order No, Garment, Date, Price...)
 *     The one exception is the "Compare branches" report, whose columns were
 *     asked for specifically and live in REPORT_COLS below.
 *   - the inside of the Finance module (Balance Sheet, Profit & Loss,
 *     Cash, Receivables, Capital, Assets...) — only the menu word changed
 *   - helper text, confirmations and error messages
 *
 * This is UI wording ONLY. Database columns and API fields keep their English
 * names, and the backend continues to speak in those — nothing here changes
 * what is stored or sent over the wire.
 */

export const T = {
  // ---- Navigation / section names ----
  orders: 'Dalabaad',
  newOrder: 'Dalab cusub',
  customers: 'Macaamiil',
  fabrics: 'Maryo',
  tailors: 'Harqaanle',
  tailoring: 'Toliin',
  staff: 'Shaqaale',
  branches: 'Xarumo',
  reports: 'Warbixin',
  finance: 'Lacagaha',

  // ---- Branches ----
  newBranch: 'Xarun cusub',
  allBranches: 'Xarumaha dhan',

  // ---- Ready-made products ----
  products: 'Alaabta',
  newProduct: 'Alaab cusub',
  size: 'Cabbirka',
  colour: 'Midabka',
  inStock: 'Bakhaarka',
  addStock: 'Alaab dar',
  discount: 'Qiimo dhimis',
  sewingCharge: 'Lacagta tolista',

  // The three things the shop sells. These are the words staff will use at
  // the counter to say what kind of sale this is.
  lineTailoring: 'Maro + Tolid',
  lineFabric: 'Maro kaliya',
  lineProduct: 'Alaab diyaar ah',

  // ---- Money ----
  revenue: 'Daqliga',
  collected: 'La qabtey',
  uncollected: 'Deyn maqan',

  // ---- Payment state ----
  fullyPaid: 'Bixiyey',
  partial: 'Qeyb',
  unpaid: 'Ma bixin',

  // ---- Roles ----
  admin: 'Maamule',
  sales: 'Iib',
  salesman: 'Iibiye',

  // ---- Order status (the state a job is in) ----
  pending: 'Sugid',
  inProgress: 'Shaqa-ku-socoto',
  completed: 'Diyaar ah',
  delivered: 'La siiyey',
  cancelled: 'La joojiyey',

  // ---- Time periods ----
  today: 'Maanta',
  thisWeek: 'Asbuucan',
  thisMonth: 'Bishan',
  allTime: 'Abid',

  // ---- Actions (buttons) ----
  complete: 'Dhammee',      // the button, not the status
  start: 'Bilow',
  // Reverted to English by request. The STATUS stays Somali ('La joojiyey');
  // this is the button that dismisses a dialog or cancels an order, where
  // "Jooji" (stop) read oddly. Kept here rather than hard-coded so it is one
  // edit to change again.
  cancel: 'Cancel',
  collapse: 'Laab',
  collect: 'Lacag qabasho',
  change: 'Bedel',
  assign: 'U dhiib',

  // ---- Orders list ----
  search: 'Raadi',
  allStatuses: 'Xaalad kasta',
  allPayments: 'Bixin kasta',
  allGarments: 'Dhar kasta',
  allTypes: 'Nooc kasta',
  deleted: 'La tirtiray',
  clear: 'Nadiifi',
  filterByDate: 'Taariikh dooro',
  everyDate: 'Taariikh kasta',
  clearDate: 'Taariikhda ka saar',
  noOrders: 'Wax dalab ah lama helin',
  customer: 'Macmiil',
  garments: 'Dharka',
  delivery: 'Qaadista',
  status: 'Xaalad',
  payment: 'Bixinta',
  price: 'Qiimaha',
  balance: 'Hadhay',
  actions: 'Fal',
  view: 'Eeg',
  printReceipt: 'Rasiidh daabac',
  printJobSheet: 'Warqad tolid',
  cancelOrder: 'Dalabka jooji',
  deleteOrder: 'Dalabka tirtir',
  restoreOrder: 'Soo celi',
  deliver: 'Gaarsii',
  today2: 'Maanta',
  noDate: 'Ma leh',
  takenNow: 'Wuu qaatay',

  // ---- Dashboard / scheduling ----
  appointment: 'Balamaha',
  delayedOrders: 'Dib u dhac',
  ready: 'Diyaar',
  notReady: 'Diyaar maaha',
};

/**
 * Column headings for the "Compare branches" report only.
 *
 * Every other table in the system keeps English headings on purpose — this
 * one report was singled out, so its headings are kept separate rather than
 * mixed into T, making it obvious which table they belong to.
 */
export const REPORT_COLS = {
  branch: 'Xarun',
  code: 'Koodh',
  orders: 'Dalabaad',
  revenue: 'Daqliga',
  collected: 'La qabtey',
  outstanding: 'Deyn maqan',
  staff: 'Shaqaale',
  stockValue: 'Qiimaha kaydka',
  share: 'Saamiga',
  total: 'WADARTA',
};

// The wordmark shown in the sidebar, on the login page, and on printed
// receipts, statements and report letterheads.
export const BRAND = 'Nidaamka Harqaanka';
