// Lightweight inline SVG icon set (stroke style, professional look)
const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

function Svg({ children, size = 20, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base} {...rest}>
      {children}
    </svg>
  );
}

export const IconDashboard = (p) => (
  <Svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>
);
export const IconOrders = (p) => (
  <Svg {...p}><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" /><path d="M9 7h6M9 11h6M9 15h4" /></Svg>
);
export const IconPlus = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Svg>
);
export const IconScan = (p) => (
  <Svg {...p}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 12h.01M11 12h2M17 12h.01" /><path d="M7 8v0M7 16v0" /><path d="M3 12h1M20 12h1" /></Svg>
);
export const IconFabric = (p) => (
  <Svg {...p}><path d="M3 8l9-5 9 5-9 5-9-5z" /><path d="M3 12l9 5 9-5" /><path d="M3 16l9 5 9-5" /></Svg>
);
export const IconUsers = (p) => (
  <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.4a6.5 6.5 0 0 1 4 5.6" /></Svg>
);
export const IconReports = (p) => (
  <Svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></Svg>
);
export const IconShield = (p) => (
  <Svg {...p}><path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5l8-3z" /><path d="M9 12l2 2 4-4" /></Svg>
);
export const IconSearch = (p) => (
  <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>
);
export const IconBell = (p) => (
  <Svg {...p}><path d="M18 9a6 6 0 1 0-12 0c0 7-2 8-2 8h16s-2-1-2-8" /><path d="M10 21a2 2 0 0 0 4 0" /></Svg>
);
export const IconLogout = (p) => (
  <Svg {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></Svg>
);
export const IconChevronDown = (p) => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
);
export const IconCalendar = (p) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 9h18" /></Svg>
);
export const IconAlert = (p) => (
  <Svg {...p}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5v.01" /></Svg>
);
export const IconTrendUp = (p) => (
  <Svg {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></Svg>
);
export const IconTrendDown = (p) => (
  <Svg {...p}><path d="M3 7l6 6 4-4 8 8" /><path d="M15 17h6v-6" /></Svg>
);
export const IconPrint = (p) => (
  <Svg {...p}><path d="M6 9V3h12v6" /><rect x="6" y="14" width="12" height="7" /><path d="M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" /></Svg>
);
export const IconEdit = (p) => (
  <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></Svg>
);
export const IconMoney = (p) => (
  <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></Svg>
);
export const IconCheck = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12l2.5 2.5 4.5-5" /></Svg>
);
export const IconClock = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>
);
export const IconX = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></Svg>
);
export const IconScissors = (p) => (
  <Svg {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.2 7.8L20 20M8.2 16.2L20 4" /></Svg>
);
export const IconTruck = (p) => (
  <Svg {...p}><path d="M1 4h13v12H1z" /><path d="M14 9h4l3 3v4h-7V9z" /><circle cx="5.5" cy="18.5" r="1.8" /><circle cx="17.5" cy="18.5" r="1.8" /></Svg>
);

// Eye / eye-with-a-slash — the show-password toggle on the login form.
export const IconEye = (p) => (
  <Svg {...p}><path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12z" />
    <circle cx="12" cy="12" r="3.2" /></Svg>
);
export const IconEyeOff = (p) => (
  <Svg {...p}><path d="M9.9 5.8A9.6 9.6 0 0 1 12 5.5c7 0 10.5 6.5 10.5 6.5a17.4 17.4 0 0 1-3.4 4.2" />
    <path d="M6.4 7.6A17.2 17.2 0 0 0 1.5 12S5 18.5 12 18.5c1.6 0 3-.34 4.2-.87" />
    <path d="M9.8 9.9a3.2 3.2 0 0 0 4.4 4.4" /><path d="M3 3l18 18" /></Svg>
);

// Branches — a storefront, used for the multi-branch section
export const IconBranch = (p) => (
  <Svg {...p}><path d="M3 9.5 4.8 4.5h14.4L21 9.5" /><path d="M3 9.5h18v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-10z" />
    <path d="M9 20.5v-5.5h6v5.5" /><path d="M3 9.5c0 1.4 1.1 2.5 2.5 2.5S8 10.9 8 9.5" />
    <path d="M8 9.5c0 1.4 1.1 2.5 2.5 2.5S13 10.9 13 9.5" />
    <path d="M13 9.5c0 1.4 1.1 2.5 2.5 2.5S18 10.9 18 9.5" /></Svg>
);

// Ready-made products — a shopping bag, distinct from the fabric bolt icon
export const IconProduct = (p) => (
  <Svg {...p}><path d="M6 8h12l-1 12.5a1 1 0 0 1-1 .9H8a1 1 0 0 1-1-.9L6 8z" />
    <path d="M9 8V6.2a3 3 0 0 1 6 0V8" /><path d="M9.5 11.5v1.2" /><path d="M14.5 11.5v1.2" /></Svg>
);

export const IconTrash = (p) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" />
    <path d="M6 7l1 13a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7" />
    <path d="M9 7V4.8a.8.8 0 0 1 .8-.8h4.4a.8.8 0 0 1 .8.8V7" /></Svg>
);
export const IconUndo = (p) => (
  <Svg {...p}><path d="M3 8h11a6 6 0 0 1 0 12H8" /><path d="M7 4L3 8l4 4" /></Svg>
);
export const IconBan = (p) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></Svg>
);
export const IconDots = (p) => (
  <Svg {...p}><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></Svg>
);
