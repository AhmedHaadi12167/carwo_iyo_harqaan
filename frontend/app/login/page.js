'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, setSession, defaultRouteForRole } from '@/lib/api';
import Logo from '@/components/Logo';
import PasswordInput from '@/components/PasswordInput';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setSession(data.token, data.user);
      router.replace(defaultRouteForRole(data.user.role));
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-950 via-brand-900 to-brand-800 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Logo size="lg" light />
          <p className="text-brand-200 text-xs mt-3 tracking-widest uppercase">
            Management System
          </p>
        </div>

        <form onSubmit={submit} className="card p-8 space-y-5">
          <h1 className="text-lg font-bold text-center">Sign in to your account</h1>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}
          <div>
            <label className="label">Username or Phone</label>
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)}
                   placeholder="Username or phone number" autoFocus required />
          </div>
          <div>
            <label className="label">Password</label>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)}
                           placeholder="Enter password" required />
          </div>
          <button className="btn-primary w-full py-2.5" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
          <button type="button" onClick={() => setShowForgot(true)}
                  className="w-full text-center text-xs font-semibold text-brand-600 hover:text-brand-800">
            Forgot password?
          </button>
        </form>
      </div>

      {showForgot && <ForgotPasswordModal onClose={() => setShowForgot(false)} />}
    </div>
  );
}

function ForgotPasswordModal({ onClose }) {
  const [step, setStep] = useState(1); // 1 = identifier, 2 = otp, 3 = new password, 4 = done
  const [identifier, setIdentifier] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestCode(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ identifier }) });
      setMaskedEmail(data.email);
      setStep(2);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function verifyCode(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const data = await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ identifier, otp }) });
      setResetToken(data.reset_token);
      setStep(3);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  async function resetPassword(e) {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) return setError('New password must be at least 6 characters');
    if (newPassword !== confirmPassword) return setError('Passwords do not match');
    setLoading(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ reset_token: resetToken, new_password: newPassword }),
      });
      setStep(4);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-sm space-y-4 bg-white">
        <div className="flex items-start justify-between">
          <h2 className="font-bold text-lg text-slate-800">Reset password</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}

        {step === 1 && (
          <form onSubmit={requestCode} className="space-y-4">
            <p className="text-sm text-slate-500">Enter your username, phone, or email — we&apos;ll send a 6-digit code to the email on file for your account.</p>
            <div>
              <label className="label">Username, phone, or email</label>
              <input className="input" required autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} />
            </div>
            <button className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Sending…' : 'Send code'}</button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={verifyCode} className="space-y-4">
            <p className="text-sm text-slate-500">We sent a code to <b>{maskedEmail}</b>. Enter it below (expires in 10 minutes).</p>
            <div>
              <label className="label">6-digit code</label>
              <input className="input text-center text-xl tracking-[0.5em] font-mono" required autoFocus maxLength={6}
                     value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
            </div>
            <button className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Verifying…' : 'Verify code'}</button>
          </form>
        )}

        {step === 3 && (
          <form onSubmit={resetPassword} className="space-y-4">
            <p className="text-sm text-slate-500">Code verified. Set a new password.</p>
            <div>
              <label className="label">New password</label>
              <PasswordInput required minLength={6} value={newPassword}
                             onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <PasswordInput required minLength={6} value={confirmPassword}
                             onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <button className="btn-primary w-full py-2.5" disabled={loading}>{loading ? 'Saving…' : 'Reset password'}</button>
          </form>
        )}

        {step === 4 && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-slate-600">Password reset. You can sign in with your new password now.</p>
            <button onClick={onClose} className="btn-primary w-full py-2.5">Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
