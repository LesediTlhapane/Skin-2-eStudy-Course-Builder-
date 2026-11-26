import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Palette,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { useTenant } from '../../context/TenantContext';
import { parseApiJson } from '../../utils/apiClient';
import {
  BRAND_THEME_PRESETS,
  computeBrandThemeTokens,
  getContrastText,
} from '../../utils/brandTheme';
import {
  uploadCompanyLogoToServer,
  type ValidatedLogoFile,
} from '../../utils/logoUpload';
import { BrandLogo } from '../BrandLogo';
import { CompanyLogoUploadSection } from '../CompanyLogoUploadSection';
import {
  EstudyMotionBackground,
  readStoredMotionIntensity,
  saveStoredMotionIntensity,
} from './EstudyMotionBackground';

type AuthTab = 'login' | 'register_company' | 'register_user' | 'forgot_password';

interface LiveBrandingPreviewProps {
  companyName: string;
  primaryColour: string;
  secondaryColour: string;
  logoPreviewUrl?: string | null;
}

const LiveCompanyBrandingPreview: React.FC<LiveBrandingPreviewProps> = ({
  companyName,
  primaryColour,
  secondaryColour,
  logoPreviewUrl,
}) => {
  const displayName = companyName.trim() || 'Your Organisation';
  const tokens = useMemo(
    () => computeBrandThemeTokens(primaryColour, secondaryColour, 'vibrant'),
    [primaryColour, secondaryColour]
  );

  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('') || 'YO';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
        <span>Live Workspace Branding Preview</span>
        <span className="text-[11px] font-mono text-slate-500">
          {tokens.primary} · {tokens.secondary}
        </span>
      </div>

      <div
        className="rounded-xl border border-slate-200 overflow-hidden shadow-xs"
        style={{ backgroundColor: tokens.surface }}
      >
        {/* Simulated Workspace TopBar */}
        <div
          className="bg-white px-3.5 py-2.5 border-b border-slate-200 flex items-center justify-between gap-3"
          style={{ borderTop: `3px solid ${tokens.secondary}` }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {logoPreviewUrl ? (
              <div className="h-8 px-1.5 py-1 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-center shrink-0">
                <img
                  src={logoPreviewUrl}
                  alt={`${displayName} preview logo`}
                  className="h-6 w-auto max-w-[96px] object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : (
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold shrink-0"
                style={{
                  backgroundColor: tokens.primary,
                  color: getContrastText(tokens.primary),
                  border: `2px solid ${tokens.secondary}`,
                }}
              >
                {initials}
              </span>
            )}
            <span
              className="text-xs sm:text-sm font-bold truncate"
              style={{ color: tokens.primary }}
            >
              {displayName}
            </span>
          </div>

          <span
            className="px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap shrink-0"
            style={{
              backgroundColor: tokens.secondary,
              color: tokens.secondaryContrast,
            }}
          >
            + New Course
          </span>
        </div>

        {/* Simulated Workspace Hero & Sample Elements */}
        <div className="p-3.5 space-y-2.5">
          <div
            className="rounded-lg p-3 flex flex-wrap items-center justify-between gap-2.5"
            style={{
              background: tokens.gradient,
              color: tokens.primaryContrast,
              borderBottom: `3px solid ${tokens.secondary}`,
            }}
          >
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider opacity-85">
                {displayName} Workspace
              </div>
              <div className="text-xs font-bold truncate">Course Development Studio</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span
                className="px-2.5 py-1 rounded-md text-[11px] font-bold border border-white/25"
                style={{
                  backgroundColor: tokens.primary,
                  color: getContrastText(tokens.primary),
                }}
              >
                Primary Button
              </span>
              <span
                className="px-2.5 py-1 rounded-md text-[11px] font-bold"
                style={{
                  backgroundColor: tokens.secondary,
                  color: getContrastText(tokens.secondary),
                }}
              >
                Secondary Accent
              </span>
            </div>
          </div>

          <div
            className="rounded-lg px-3 py-2 border flex items-center justify-between text-[11px]"
            style={{
              backgroundColor: tokens.secondaryTint,
              borderColor: tokens.secondaryBorder,
            }}
          >
            <span className="text-slate-700 font-medium">Secondary highlight accent preview</span>
            <span className="font-bold" style={{ color: tokens.secondaryInk }}>
              7-Stage Authoring Ready
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AuthScreens: React.FC = () => {
  const {
    isClientSupabaseConfigured,
    isServerSupabaseConfigured,
    session,
    profile,
    isPasswordRecoveryMode,
    isPasswordSetupMode,
    authError,
    setWorkspaceNotice,
    acceptPendingInvitations,
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
  const [motionIntensity, setMotionIntensity] = useState<number>(() =>
    readStoredMotionIntensity()
  );

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
  const [pendingLogo, setPendingLogo] = useState<ValidatedLogoFile | null>(null);

  // Register User fields
  const [userFullName, setUserFullName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userPassword, setUserPassword] = useState('');
  const [userConfirmPassword, setUserConfirmPassword] = useState('');

  // Forgot & Reset Password fields
  const [forgotEmail, setForgotEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const handleIntensityChange = (next: number) => {
    setMotionIntensity(next);
    saveStoredMotionIntensity(next);
  };

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
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
      const res = await fetch('/api/v2/auth/register-company', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          companyName: companyName.trim(),
          fullName: adminFullName.trim(),
          email: adminEmail.trim().toLowerCase(),
          password: adminPassword,
          redirectTo,
          primaryColour,
          secondaryColour,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Company workspace registration failed.');
      }

      if (data.requiresEmailVerification && !session?.access_token) {
        const logoNote = pendingLogo
          ? ' Once verified and signed in, upload your company logo in Organisation Branding & Team.'
          : '';
        setSuccessMsg(
          (data.message ||
            'Company workspace registered! Please check your email and click the verification link before signing in.') +
            logoNote
        );
        setAdminPassword('');
        setAdminConfirmPassword('');
        setLoginEmail(adminEmail.trim().toLowerCase());
        setTab('login');
        return;
      }

      const createdCompanyId = data.company?.id as string | undefined;

      // Authenticate without immediately unmounting so the new Company Admin can upload the logo cleanly
      const activeToken = session?.access_token
        ? session.access_token
        : await signInWithPassword(adminEmail.trim().toLowerCase(), adminPassword, {
            skipRefresh: true,
          });

      if (pendingLogo && createdCompanyId && activeToken) {
        try {
          await uploadCompanyLogoToServer({
            logo: pendingLogo,
            accessToken: activeToken,
            companyId: createdCompanyId,
          });
        } catch (uploadErr: any) {
          // Non-blocking fallback: enter the workspace and let the admin retry from Company Settings
          setWorkspaceNotice(
            `Company workspace created! Logo upload could not complete right now (${
              uploadErr?.message || 'storage check needed'
            }). Open Organisation Branding & Team to retry.`
          );
        }
      }

      await refreshTenantContext(activeToken, createdCompanyId);
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
      const redirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
      const res = await fetch('/api/v2/auth/register-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: userFullName.trim(),
          email: userEmail.trim().toLowerCase(),
          password: userPassword,
          redirectTo,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Account registration failed.');
      }

      if (data.accountAlreadyConfirmed) {
        setSuccessMsg(
          data.message ||
            'An account with this email is already verified. Sign in with your existing password to access your workspaces.'
        );
        setLoginEmail(userEmail.trim().toLowerCase());
        setUserPassword('');
        setUserConfirmPassword('');
        setTab('login');
        return;
      }

      if (data.requiresEmailVerification || data.invitedPending) {
        setSuccessMsg(
          data.message ||
            'Check your email and click the invitation / verification link to confirm your email and activate your workspace.'
        );
        setUserPassword('');
        setUserConfirmPassword('');
        setLoginEmail(userEmail.trim().toLowerCase());
        setTab('login');
        return;
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

  // Show password setup/reset view whenever recovery OR team invitation link triggers
  if (isPasswordRecoveryMode || isPasswordSetupMode) {
    return (
      <EstudyMotionBackground
        intensity={motionIntensity}
        onChangeIntensity={handleIntensityChange}
      >
        <div className="bg-white/95 backdrop-blur-md border border-white/60 rounded-2xl shadow-2xl shadow-[#02122E]/40 max-w-md w-full overflow-hidden">
          <div className="bg-[#052B66] border-b-[3px] border-b-[#45CC42] px-6 py-5 text-white space-y-2">
            <img
              src="/estudy-logo-white.svg"
              alt="eStudy"
              className="h-8 w-auto object-contain"
              referrerPolicy="no-referrer"
            />
            <h1 className="text-lg font-bold tracking-tight">
              {isPasswordSetupMode ? 'Accept Invitation & Set Password' : 'Set New Password'}
            </h1>
            <p className="text-xs text-slate-200 leading-relaxed">
              {isPasswordSetupMode
                ? 'Choose your personal password (minimum 8 characters) to activate your company workspace invitation.'
                : 'Choose a new password (minimum 8 characters) for your Master Course Builder account.'}
            </p>
          </div>
          <div className="p-6 sm:p-7 space-y-4">
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
              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>New Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                  placeholder="At least 8 characters"
                />
              </label>
              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>Confirm New Password</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmNewPassword}
                  onChange={e => setConfirmNewPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white border-b-2 border-[#45CC42] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4 text-[#45CC42]" />}
                <span>
                  {isPasswordSetupMode ? 'Set Password & Enter Workspace' : 'Update Password'}
                </span>
              </button>
            </form>
          </div>
        </div>
      </EstudyMotionBackground>
    );
  }

  // User is signed in via Supabase Auth, but has no active company memberships yet
  if (session) {
    return (
      <EstudyMotionBackground
        intensity={motionIntensity}
        onChangeIntensity={handleIntensityChange}
      >
        <div className="bg-white/95 backdrop-blur-md border border-white/60 rounded-2xl shadow-2xl shadow-[#02122E]/40 max-w-2xl w-full overflow-hidden">
          <div className="bg-[#052B66] border-b-[3px] border-b-[#45CC42] px-6 py-5 text-white flex items-start justify-between gap-4">
            <div className="space-y-1.5">
              <img
                src="/estudy-logo-white.svg"
                alt="eStudy"
                className="h-8 w-auto object-contain"
                referrerPolicy="no-referrer"
              />
              <h1 className="text-lg sm:text-xl font-bold tracking-tight pt-1">
                Complete Workspace Onboarding
              </h1>
              <p className="text-xs text-slate-200 leading-relaxed">
                Signed in as <strong>{profile?.email || session.user.email}</strong>. Configure your
                company workspace and branding below, or ask your company administrator to invite you.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="px-3 py-1.5 text-xs font-semibold text-white/90 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg flex items-center gap-1.5 cursor-pointer shrink-0 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>

          <div className="p-6 sm:p-7 space-y-5">
            {errorMsg && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {session.user?.email_confirmed_at ? (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
                <span>Waiting on a team invitation? Check for pending company invites.</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setErrorMsg(null);
                    try {
                      const count = await acceptPendingInvitations();
                      if (count === 0) {
                        setErrorMsg('No pending company invitations found for your account yet.');
                      }
                    } catch (err: any) {
                      setErrorMsg(err?.message || 'Could not check pending invitations.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#052B66] text-white font-semibold hover:bg-[#042150] cursor-pointer"
                >
                  Accept Pending Invitation
                </button>
              </div>
            ) : (
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900 space-y-1">
                <div className="font-bold">Email Verification Required</div>
                <p>
                  Verify your email address via the confirmation link sent to{' '}
                  <strong>{session.user?.email}</strong> before accessing or creating a company workspace.
                </p>
              </div>
            )}

            {session.user?.email_confirmed_at && (
            <form onSubmit={handleRegisterCompany} className="space-y-5">
              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>Company / Organisation Name</span>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Meridian Technical Training"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                />
              </label>

              {/* Dedicated Company Branding Section */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/75 p-4 space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold text-[#052B66]">
                  <Palette className="w-4 h-4 text-[#1F7A1D]" />
                  <span>Company Branding</span>
                </div>

                {/* Top-left logo upload */}
                <CompanyLogoUploadSection
                  previewUrl={pendingLogo?.previewDataUrl || null}
                  companyName={companyName}
                  onSelectLogo={validated => setPendingLogo(validated)}
                  onRemoveLogo={() => setPendingLogo(null)}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
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
                        className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
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
                        className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                      />
                    </div>
                  </label>
                </div>

                <LiveCompanyBrandingPreview
                  companyName={companyName}
                  primaryColour={primaryColour}
                  secondaryColour={secondaryColour}
                  logoPreviewUrl={pendingLogo?.previewDataUrl || null}
                />
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
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Building2 className="w-4 h-4" style={{ color: secondaryColour }} />
                )}
                <span>Create Company Workspace</span>
              </button>
            </form>
            )}
          </div>
        </div>
      </EstudyMotionBackground>
    );
  }

  const isWideCompanyRegistration = tab === 'register_company';

  return (
    <EstudyMotionBackground
      intensity={motionIntensity}
      onChangeIntensity={handleIntensityChange}
    >
      <div
        className={`bg-white/95 backdrop-blur-md border border-white/60 rounded-2xl shadow-2xl shadow-[#021433]/40 w-full overflow-hidden transition-[max-width] duration-200 ${
          isWideCompanyRegistration ? 'max-w-2xl' : 'max-w-lg'
        }`}
      >
        {/* Official eStudy Brand Header */}
        <div
          className="px-6 sm:px-7 py-5 text-white border-b-[3px] border-b-[#45CC42] space-y-2.5"
          style={{
            background: 'linear-gradient(135deg, #042150 0%, #052B66 60%, #093E8F 100%)',
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <img
              src="/estudy-logo-white.svg"
              alt="eStudy"
              className="h-8 sm:h-9 w-auto object-contain shrink-0"
              referrerPolicy="no-referrer"
            />
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-200 whitespace-nowrap shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-[#45CC42]" />
              <span>Secure Multi-Company Workspace</span>
            </span>
          </div>
          <div className="space-y-1 pt-0.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Master Course Builder
            </h1>
            <p className="text-xs sm:text-[13px] text-slate-200/95 leading-relaxed">
              Create, manage and publish structured learning experiences with AI-powered course development.
            </p>
          </div>
        </div>

        {!isClientSupabaseConfigured && (
          <div className="m-6 mb-0 p-4 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs text-amber-900">
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
        <div className="flex border-b border-slate-200 px-4 sm:px-6 pt-3 gap-1 overflow-x-auto bg-slate-50/90">
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
              className={`px-3.5 py-2.5 text-xs font-bold whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                tab === item.id
                  ? 'border-[#45CC42] text-[#052B66] bg-white rounded-t-lg shadow-2xs'
                  : 'border-transparent text-slate-500 hover:text-[#052B66]'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="p-6 sm:p-7 space-y-4">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-start gap-2"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-start gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="flex items-center justify-between pb-1">
                <div>
                  <h2 className="text-base font-bold text-[#052B66]">Welcome Back</h2>
                  <p className="text-xs text-slate-500">
                    Sign in to access your company workspace and courses.
                  </p>
                </div>
                <BrandLogo size="sm" />
              </div>

              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>Work Email</span>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                />
              </label>

              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>Password</span>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                />
              </label>

              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white border-b-[3px] border-[#45CC42] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors min-h-[42px]"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4 text-[#45CC42]" />}
                <span>Sign In to Workspace</span>
              </button>
            </form>
          )}

          {tab === 'register_company' && (
            <form onSubmit={handleRegisterCompany} className="space-y-4">
              <div className="space-y-3">
                <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                  <span>Company / Organisation Name</span>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="e.g. Apex Skills Academy"
                    className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
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
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
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
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
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
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
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
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                    />
                  </label>
                </div>
              </div>

              {/* Dedicated Company Branding Section (Logo top-left + Colours + Live Preview) */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#052B66]">
                    <Palette className="w-4 h-4 text-[#1F7A1D]" />
                    <span>Company Branding</span>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Customise your tenant workspace
                  </span>
                </div>

                {/* Logo Upload at top-left of Company Branding section */}
                <CompanyLogoUploadSection
                  previewUrl={pendingLogo?.previewDataUrl || null}
                  companyName={companyName}
                  onSelectLogo={validated => setPendingLogo(validated)}
                  onRemoveLogo={() => setPendingLogo(null)}
                />

                {/* Quick Theme Presets */}
                <div className="space-y-1.5 pt-1">
                  <span className="block text-xs font-semibold text-slate-700">
                    Quick Theme Presets
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    {BRAND_THEME_PRESETS.slice(0, 3).map(preset => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setPrimaryColour(preset.primaryColour);
                          setSecondaryColour(preset.secondaryColour);
                        }}
                        className={`px-2.5 py-2 rounded-lg border text-left text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
                          primaryColour.toUpperCase() === preset.primaryColour &&
                          secondaryColour.toUpperCase() === preset.secondaryColour
                            ? 'border-[#052B66] bg-white ring-2 ring-[#45CC42]/35'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <span
                          className="w-3 h-3 rounded-xs shrink-0 border border-black/10"
                          style={{ backgroundColor: preset.primaryColour }}
                        />
                        <span
                          className="w-3 h-3 rounded-xs shrink-0 border border-black/10"
                          style={{ backgroundColor: preset.secondaryColour }}
                        />
                        <span className="truncate">{preset.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom Primary & Secondary Pickers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1 text-xs font-semibold text-slate-700">
                    <span>Primary Brand Colour</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={primaryColour}
                        onChange={e => setPrimaryColour(e.target.value)}
                        className="w-9 h-9 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <input
                        type="text"
                        value={primaryColour}
                        onChange={e => setPrimaryColour(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
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
                        className="w-9 h-9 rounded border border-slate-200 cursor-pointer shrink-0"
                      />
                      <input
                        type="text"
                        value={secondaryColour}
                        onChange={e => setSecondaryColour(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                      />
                    </div>
                  </label>
                </div>

                {/* Live Branding Preview */}
                <LiveCompanyBrandingPreview
                  companyName={companyName}
                  primaryColour={primaryColour}
                  secondaryColour={secondaryColour}
                  logoPreviewUrl={pendingLogo?.previewDataUrl || null}
                />
              </div>

              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-opacity hover:opacity-95 disabled:opacity-50 min-h-[42px]"
                style={{
                  backgroundColor: primaryColour,
                  color: getContrastText(primaryColour),
                  borderBottom: `3px solid ${secondaryColour}`,
                }}
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Building2 className="w-4 h-4" style={{ color: secondaryColour }} />
                )}
                <span>Create Organisation & Admin Account</span>
              </button>
            </form>
          )}

          {tab === 'register_user' && (
            <form onSubmit={handleRegisterUser} className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Invited to an existing organisation? Register using the exact email address your
                company administrator invited to unlock access automatically.
              </p>
              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>Full Name</span>
                <input
                  type="text"
                  required
                  value={userFullName}
                  onChange={e => setUserFullName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                />
              </label>
              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>Invited Email Address</span>
                <input
                  type="email"
                  required
                  value={userEmail}
                  onChange={e => setUserEmail(e.target.value)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
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
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
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
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white border-b-[3px] border-[#45CC42] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors min-h-[42px]"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4 text-[#45CC42]" />}
                <span>Create User Account</span>
              </button>
            </form>
          )}

          {tab === 'forgot_password' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                Enter your account email and we will send a password recovery link via Supabase Auth.
              </p>
              <label className="block space-y-1.5 text-xs font-semibold text-slate-700">
                <span>Account Email</span>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-[#052B66] focus:ring-2 focus:ring-[#45CC42]/25 transition-all"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !isClientSupabaseConfigured}
                className="w-full py-2.5 rounded-lg bg-[#052B66] hover:bg-[#042150] disabled:opacity-50 text-white border-b-[3px] border-[#45CC42] text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors min-h-[42px]"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4 text-[#45CC42]" />}
                <span>Send Recovery Email</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </EstudyMotionBackground>
  );
};
