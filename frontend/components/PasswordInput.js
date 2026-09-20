'use client';
import { useState } from 'react';
import { IconEye, IconEyeOff } from '@/components/Icons';

/**
 * A password field with a show/hide eye.
 *
 * Typing a password blind — on a shop counter, often on a phone, often in a
 * second language — is where most failed logins and mistyped resets come
 * from. Every password field in the system uses this, so the behaviour is
 * identical everywhere and there is one place to change it.
 *
 * Takes all the props a normal <input> takes; anything passed through lands
 * on the input itself.
 *
 *   <PasswordInput value={pw} onChange={e => setPw(e.target.value)} required />
 */
export default function PasswordInput({ className = 'input', ...props }) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        type={show ? 'text' : 'password'}
        // Room on the right so long passwords never run under the eye.
        className={`${className} pr-11`}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        // Skipped by Tab: it is a convenience, not a step in filling the form,
        // and catching it between fields slows typing down.
        tabIndex={-1}
        title={show ? 'Hide password' : 'Show password'}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400
                   hover:text-brand-700 transition-colors"
      >
        {show ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
}
