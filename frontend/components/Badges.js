import { T } from '@/lib/labels';

const STATUS_STYLES = {
  pending: 'bg-amber-50 text-amber-600 ring-amber-200',
  in_progress: 'bg-blue-50 text-blue-600 ring-blue-200',
  completed: 'bg-violet-50 text-violet-600 ring-violet-200',
  delivered: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATUS_LABELS = {
  pending: T.pending,
  in_progress: T.inProgress,
  completed: T.completed,
  delivered: T.delivered,
  cancelled: T.cancelled,
};

const PAY_STYLES = {
  paid: 'bg-emerald-500 text-white ring-emerald-500',
  partial: 'bg-amber-400 text-white ring-amber-400',
  unpaid: 'bg-rose-500 text-white ring-rose-500',
};

export function StatusBadge({ status }) {
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold ring-1 ring-inset ${STATUS_STYLES[status] || 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function PayBadge({ status }) {
  const labels = { paid: T.fullyPaid, partial: T.partial, unpaid: T.unpaid };
  return (
    <span className={`inline-flex px-2.5 py-1 rounded-md text-[11px] font-bold ${PAY_STYLES[status] || 'bg-slate-100 text-slate-500'}`}>
      {labels[status] || status}
    </span>
  );
}

export { STATUS_LABELS };
