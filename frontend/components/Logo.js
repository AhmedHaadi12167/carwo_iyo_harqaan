import { BRAND } from '@/lib/labels';

export default function Logo({ size = 'md', light = false }) {
  // Text wordmark only. `light` picks a colour that reads on dark backgrounds
  // (see the login page); otherwise the brand colour is used.
  // Playfair sets visually larger than a script face, so each step is
  // one notch smaller than the old script sizing.
  const sizes = { sm: 'text-xl', md: 'text-3xl', lg: 'text-5xl' };
  return (
    <div className="text-center leading-none select-none">
      <span className={`font-script font-semibold tracking-tight ${sizes[size]} ${light ? 'text-white' : 'text-brand-600'}`}>
        {BRAND}
      </span>
    </div>
  );
}
