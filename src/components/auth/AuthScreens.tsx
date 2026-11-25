import React, { useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useTenant } from '../../context/TenantContext';
import { parseApiJson } from '../../utils/apiClient';
import { BRAND_THEME_PRESETS, getContrastText } from '../../utils/brandTheme';
import { BrandLogo } from '../BrandLogo';

type AuthTab = 'login' | 'register_company' | 'register_user' | 'forgot_password';

export const AuthScreens: React.FC = () => {
  const {
    isClientSupabaseConfigured,
    isServerSupabaseConfigured,
    session,
    profile,
    isPasswordRecoveryMode,
    authError,
    signInWithPassword,
    sendPasswordResetEmail,
    updatePassword,
    refreshTenantContext,
    signOut,
  } = useTenant();

  const [tab, setTab] = useState<AuthTab>('login');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(authError);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register Company fields
  const [companyName, setCompanyName] = useState('');
  const [adminFullName, setAdminFullName] = useState(profile?.fullName || '');
  const [adminEmail, setAdminEmail] = useState(profile?.email || '');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [primaryColour, setPrimaryColour] = useState('#052B66');
  const [secondaryColour, setSecondaryColour] = useState('#45CC42');

  // Register User fields
  const [userFullName, setUserFullName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userConfirmPassword, setUserConfirmPassword] = useState('');

  // Forgot & Reset Password fields
  const [forgotEmail, setForgotEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!loginEmail.trim() || !loginPassword) {
      setErrorMsg('Enter both email and password.');
      return;
    }
    setBusy(true);
    try {
      await signInWithPassword(loginEmail, loginPassword);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (companyName.trim().length < 2) {
      setErrorMsg('Company name must be at least 2 characters.');
      return;
    }

    if (!session) {
      if (adminFullName.trim().length < 2) {
        setErrorMsg('Administrator full name is required.');
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) {
        setErrorMsg('Enter a valid work email address.');
        return;
      }
      if (adminPassword.length < 8) {
        setErrorMsg('Password must be at least 8 characters.');
        return;
      }
      if (adminPassword !== adminConfirmPassword) {
        setErrorMsg('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch('/api/v2/auth/register-company', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyName: companyName.trim(),
          fullName: adminFullName.trim(),
          email: adminEmail.trim().toLowerCase(),
          password: adminPassword,
          primaryColour,
          secondaryColour,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Company workspace registration failed.');
      }

      if (session?.access_token) {
        await refreshTenantContext(session.access_token, data.company?.id);
      } else {
        await signInWithPassword(adminEmail.trim().toLowerCase(), adminPassword);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to register company workspace.');
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (userFullName.trim().length < 2) {
      setErrorMsg('Full name is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail.trim())) {
      setErrorMsg('Enter a valid email address.');
      return;
    }
    if (userPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (userPassword !== userConfirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/v2/auth/register-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: userFullName.trim(),
          email: userEmail.trim().toLowerCase(),
          password: userPassword,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Account registration failed.');
      }

      await signInWithPassword(userEmail.trim().toLowerCase(), userPassword);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to register user account.');
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail.trim())) {
      setErrorMsg('Enter your account email address.');
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(forgotEmail);
      setSuccessMsg(
        'If an account exists for that email, a password recovery link has been sent via Supabase Auth.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to send password reset email.');
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(newPassword);
      setSuccessMsg('Password updated cleanly. Loading workspace...');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not update password.');
    } finally {
      setBusy(false);
    }
  };

  // Show password reset view whenever recovery mode is triggered by Supabase recovery link
  if (isPasswordRecoveryMode) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl shadow-sm max-w-md w-full p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <BrandLogo size="md" />
            <h1 className="text-xl font-bold text-primary pt-2">Set New Password</h1>
            <p className="text-xs text-slate-600">
              Choose a new password (minimum 8 characters) for your account.
            </p>
          </div>
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}
          <form onSubmit={handleResetPassword} className="space-y-4">
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>New Password</span>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                placeholder="At least 8 characters"
              />
            </label>
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>Confirm New Password</span>
              <input
                type="password"
                required
                minLength={8}
                value={confirmNewPassword}
                onChange={e => setConfirmNewPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast border-b-2 border-accent text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4 text-accent" />}
              <span>Update Password</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // User is signed in via Supabase Auth, but has no active company memberships yet
  if (session) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 border-t-[3px] border-t-accent rounded-xl shadow-sm max-w-lg w-full p-6 sm:p-8 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <BrandLogo size="md" />
              <h1 className="text-xl font-bold text-primary pt-2">
                Complete Workspace Onboarding
              </h1>
              <p className="text-xs text-slate-600">
                Signed in as <strong>{profile?.email || session.user.email}</strong>. Create a new
                company workspace below, or ask your company administrator to invite this email address.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-primary border border-slate-200 rounded-lg flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleRegisterCompany} className="space-y-4">
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              <span>Company / Organisation Name</span>
              <input
                type="text"
                required
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="e.g. Meridian Technical Training"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Primary Brand Colour</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primaryColour}
                    onChange={e => setPrimaryColour(e.target.value)}
                    className="w-9 h-9 rounded border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={primaryColour}
                    onChange={e => setPrimaryColour(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono"
                  />
                </div>
              </label>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Secondary Accent Colour</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={secondaryColour}
                    onChange={e => setSecondaryColour(e.target.value)}
                    className="w-9 h-9 rounded border border-slate-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={secondaryColour}
                    onChange={e => setSecondaryColour(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono"
                  />
                </div>
              </label>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95"
              style={{
                backgroundColor: primaryColour,
                color: getContrastText(primaryColour),
                borderBottom: `3px solid ${secondaryColour}`,
              }}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" style={{ color: secondaryColour }} />}
              <span>Create Company Workspace</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm max-w-lg w-full overflow-hidden">
        <div className="bg-brand-gradient border-b-[3px] border-b-accent px-6 py-5 text-primary-contrast space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
              Multi-Tenant SaaS Platform
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-accent" />
              <span>Supabase Auth + RLS</span>
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight">eStudy Master Course Builder V2</h1>
          <p className="text-xs text-slate-200">
            Sign in to your organisation workspace or create a dedicated company tenant.
          </p>
        </div>

        {!isClientSupabaseConfigured && (
          <div className="m-6 p-4 bg-amber-50 border border-amber-300 rounded-lg space-y-2 text-xs text-amber-900">
            <div className="font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Supabase Environment Variables Required</span>
            </div>
            <p className="leading-relaxed">
              Multi-tenant authentication requires configuring{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code>{' '}
              in your environment, plus{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">SUPABASE_URL</code> and{' '}
              <code className="font-mono bg-amber-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code>{' '}
              on the server ({isServerSupabaseConfigured === false ? 'currently unconfigured' : 'checking'}).
            </p>
            <p className="text-[11px] text-amber-800">
              See <code className="font-mono">supabase/README.md</code> and{' '}
              <code className="font-mono">.env.example</code> for setup steps and SQL migrations.
            </p>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 px-4 pt-3 gap-1 overflow-x-auto bg-slate-50">
          {(
            [
              { id: 'login', label: 'Sign In' },
              { id: 'register_company', label: 'Register Company' },
              { id: 'register_user', label: 'Register User' },
              { id: 'forgot_password', label: 'Forgot Password' },
            ] as const
          ).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTab(item.id);
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`px-3 py-2 text-xs font-bold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                tab === item.id
                  ? 'border-accent text-primary bg-white rounded-t-md'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Work Email</span>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Password</span>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast border-b-2 border-accent text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4 text-accent" />}
                <span>Sign In to Workspace</span>
              </button>
            </form>
          )}

          {tab === 'register_company' && (
            <form onSubmit={handleRegisterCompany} className="space-y-3.5">
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Company / Organisation Name</span>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Apex Skills Academy"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Primary Admin Full Name</span>
                  <input
                    type="text"
                    required
                    value={adminFullName}
                    onChange={e => setAdminFullName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </label>
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Admin Work Email</span>
                  <input
                    type="email"
                    required
                    value={adminEmail}
                    onChange={e => setAdminEmail(e.target.value)}
                    placeholder="admin@company.com"
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Password (min 8 chars)</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={adminPassword}
                    onChange={e => setAdminPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </label>
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={adminConfirmPassword}
                    onChange={e => setAdminConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  />
                </label>
              </div>
              <div className="space-y-1.5 pt-1">
                <span className="block text-xs font-semibold text-slate-700">
                  Quick Theme Presets
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {BRAND_THEME_PRESETS.slice(0, 3).map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setPrimaryColour(preset.primaryColour);
                        setSecondaryColour(preset.secondaryColour);
                      }}
                      className={`px-2 py-1.5 rounded border text-left text-[10px] font-semibold flex items-center gap-1.5 cursor-pointer ${
                        primaryColour.toUpperCase() === preset.primaryColour &&
                        secondaryColour.toUpperCase() === preset.secondaryColour
                          ? 'border-primary bg-accent-tint/60'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-xs shrink-0"
                        style={{ backgroundColor: preset.primaryColour }}
                      />
                      <span
                        className="w-3 h-3 rounded-xs shrink-0"
                        style={{ backgroundColor: preset.secondaryColour }}
                      />
                      <span className="truncate">{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Primary Colour</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColour}
                      onChange={e => setPrimaryColour(e.target.value)}
                      className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={primaryColour}
                      onChange={e => setPrimaryColour(e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs font-mono"
                    />
                  </div>
                </label>
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Accent Colour</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={secondaryColour}
                      onChange={e => setSecondaryColour(e.target.value)}
                      className="w-8 h-8 rounded border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={secondaryColour}
                      onChange={e => setSecondaryColour(e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs font-mono"
                    />
                  </div>
                </label>
              </div>
              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95 disabled:opacity-50"
                style={{
                  backgroundColor: primaryColour,
                  color: getContrastText(primaryColour),
                  borderBottom: `3px solid ${secondaryColour}`,
                }}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" style={{ color: secondaryColour }} />}
                <span>Create Organisation & Admin Account</span>
              </button>
            </form>
          )}

          {tab === 'register_user' && (
            <form onSubmit={handleRegisterUser} className="space-y-3.5">
              <p className="text-xs text-slate-600 leading-relaxed">
                Invited to an existing organisation? Register using the exact email address your
                company administrator invited to unlock access automatically.
              </p>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Full Name</span>
                <input
                  type="text"
                  required
                  value={userFullName}
                  onChange={e => setUserFullName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Invited Email Address</span>
                <input
                  type="email"
                  required
                  value={userEmail}
                  onChange={e => setUserEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Password (min 8 chars)</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={userPassword}
                    onChange={e => setUserPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                  />
                </label>
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Confirm Password</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={userConfirmPassword}
                    onChange={e => setUserConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast border-b-2 border-accent text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4 text-accent" />}
                <span>Create User Account</span>
              </button>
            </form>
          )}

          {tab === 'forgot_password' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-xs text-slate-600">
                Enter your account email and we will send a password recovery link via Supabase Auth.
              </p>
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Account Email</span>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-accent"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary-dark disabled:opacity-50 text-primary-contrast border-b-2 border-accent text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4 text-accent" />}
                <span>Send Recovery Email</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
