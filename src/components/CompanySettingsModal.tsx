import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Loader2,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  AiUsageSummary,
  CompanyMembership,
  CompanyRole,
  GovernanceRole,
  MembershipStatus,
} from '../types';
import { GOVERNANCE_ROLE_LABELS, VALID_GOVERNANCE_ROLES } from '../utils/rbac';
import { useTenant } from '../context/TenantContext';
import { apiFetch, parseApiJson } from '../utils/apiClient';
import {
  BRAND_THEME_PRESETS,
  computeBrandThemeTokens,
  type BrandSurfaceMode,
} from '../utils/brandTheme';
import {
  removeCompanyLogoOnServer,
  uploadCompanyLogoToServer,
  type ValidatedLogoFile,
} from '../utils/logoUpload';
import { CompanyLogoUploadSection } from './CompanyLogoUploadSection';

interface CompanySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'branding' | 'team' | 'usage';

export const CompanySettingsModal: React.FC<CompanySettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    activeCompany,
    activeRole,
    surfaceMode,
    setSurfaceMode,
    previewTheme,
    resetThemePreview,
    updateLocalActiveCompany,
  } = useTenant();
  const isAdmin = activeRole === 'company_admin';

  const [tab, setTab] = useState<TabKey>('branding');
  const [companyName, setCompanyName] = useState(activeCompany?.companyName || '');
  const [logoUrl, setLogoUrl] = useState(activeCompany?.logoUrl || '');
  const [pendingLogoFile, setPendingLogoFile] = useState<ValidatedLogoFile | null>(null);
  const [pendingRemoveLogo, setPendingRemoveLogo] = useState(false);
  const [primaryColour, setPrimaryColour] = useState(activeCompany?.primaryColour || '#052B66');
  const [secondaryColour, setSecondaryColour] = useState(
    activeCompany?.secondaryColour || '#45CC42'
  );
  const [draftSurfaceMode, setDraftSurfaceMode] = useState<BrandSurfaceMode>(surfaceMode);

  const [members, setMembers] = useState<CompanyMembership[]>([]);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<CompanyRole>('author');
  const [inviteGovernanceRoles, setInviteGovernanceRoles] = useState<GovernanceRole[]>([]);
  const [inviteTempPassword, setInviteTempPassword] = useState('');

  const wasOpenRef = useRef(false);
  const syncedCompanyIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || !activeCompany) {
      wasOpenRef.current = false;
      return;
    }
    const justOpened = !wasOpenRef.current;
    const switchedCompany = syncedCompanyIdRef.current !== activeCompany.id;
    wasOpenRef.current = true;
    syncedCompanyIdRef.current = activeCompany.id;

    if (justOpened || switchedCompany) {
      setCompanyName(activeCompany.companyName);
      setLogoUrl(activeCompany.logoUrl || '');
      setPendingLogoFile(null);
      setPendingRemoveLogo(false);
      setPrimaryColour(activeCompany.primaryColour || '#052B66');
      setSecondaryColour(activeCompany.secondaryColour || '#45CC42');
      setDraftSurfaceMode(surfaceMode);
      setNotice(null);
      setErrorMsg(null);
    }
  }, [isOpen, activeCompany, surfaceMode]);

  // Live preview adjustments across the workspace while editing in the modal
  useEffect(() => {
    if (!isOpen || !activeCompany || tab !== 'branding') return;
    if (/^#[0-9A-Fa-f]{6}$/.test(primaryColour) && /^#[0-9A-Fa-f]{6}$/.test(secondaryColour)) {
      previewTheme(primaryColour, secondaryColour, draftSurfaceMode);
    }
  }, [isOpen, activeCompany, tab, primaryColour, secondaryColour, draftSurfaceMode, previewTheme]);

  useEffect(() => {
    if (!isOpen || !activeCompany) return;
    if (tab === 'team') {
      apiFetch('/api/v2/tenant/members')
        .then(r => parseApiJson<any>(r))
        .then(d => {
          if (Array.isArray(d.members)) setMembers(d.members);
        })
        .catch(() => {});
    } else if (tab === 'usage') {
      apiFetch('/api/v2/usage')
        .then(r => parseApiJson<any>(r))
        .then(d => {
          if (d.summary) setUsage(d.summary);
        })
        .catch(() => {});
    }
  }, [isOpen, tab, activeCompany]);

  if (!isOpen || !activeCompany) return null;

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await apiFetch('/api/v2/tenant/company', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          ...(!pendingLogoFile && !pendingRemoveLogo
            ? { logoUrl: logoUrl.trim() || null }
            : {}),
          primaryColour,
          secondaryColour,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save company branding.');
      }

      let latestCompany = data.company;

      if (pendingLogoFile) {
        const uploaded = await uploadCompanyLogoToServer({
          logo: pendingLogoFile,
          companyId: activeCompany.id,
        });
        latestCompany = uploaded.company;
        setLogoUrl(uploaded.logoUrl);
        setPendingLogoFile(null);
        setPendingRemoveLogo(false);
      } else if (pendingRemoveLogo) {
        const removed = await removeCompanyLogoOnServer({
          companyId: activeCompany.id,
        });
        latestCompany = removed.company;
        setLogoUrl('');
        setPendingRemoveLogo(false);
      }

      updateLocalActiveCompany(latestCompany);
      setSurfaceMode(draftSurfaceMode);
      setNotice('Company branding, logo, and theme settings saved across your workspace.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to update company settings.');
    } finally {
      setBusy(false);
    }
  };

  const handleCloseModal = () => {
    resetThemePreview();
    onClose();
  };

  const previewTokens = computeBrandThemeTokens(
    primaryColour,
    secondaryColour,
    draftSurfaceMode
  );

  const effectivePreviewLogoUrl = pendingRemoveLogo
    ? null
    : pendingLogoFile?.previewDataUrl || logoUrl.trim() || null;

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const eligibleForGov = inviteRole === 'reviewer' || inviteRole === 'company_admin';
      const res = await apiFetch('/api/v2/tenant/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          fullName: inviteFullName.trim(),
          role: inviteRole,
          governanceRoles: eligibleForGov ? inviteGovernanceRoles : [],
          temporaryPassword: inviteTempPassword.trim() || undefined,
          redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not invite member.');
      }
      setMembers(prev => {
        const filtered = prev.filter(m => m.id !== data.member.id);
        return [...filtered, data.member];
      });
      setInviteEmail('');
      setInviteFullName('');
      setInviteTempPassword('');
      setInviteGovernanceRoles([]);
      setNotice(`Added ${data.member.profile?.email || 'team member'} (${data.member.role}).`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Team invitation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMember = async (
    memberId: string,
    patch: {
      role?: CompanyRole;
      membershipStatus?: MembershipStatus;
      governanceRoles?: GovernanceRole[];
    }
  ) => {
    if (!isAdmin) return;
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/v2/tenant/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not update member.');
      }
      setMembers(prev => prev.map(m => (m.id === memberId ? data.member : m)));
      setNotice('Updated team member permissions.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Update failed.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 border-t-[3px] border-t-accent max-w-3xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-accent-ink" />
            <div>
              <h2 className="text-base font-bold text-primary">
                {activeCompany.companyName} · Organisation Settings
              </h2>
              <p className="text-xs text-slate-500">
                Slug: <span className="font-mono">{activeCompany.companySlug}</span> · Your role:{' '}
                <span className="font-semibold text-primary">{activeRole}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseModal}
            className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-200 px-6 gap-2 bg-slate-50">
          {[
            { id: 'branding' as const, label: 'Branding & Theme', icon: Palette },
            { id: 'team' as const, label: 'Team & Roles', icon: Users },
            { id: 'usage' as const, label: 'AI Usage', icon: BarChart3 },
          ].map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id);
                  setNotice(null);
                  setErrorMsg(null);
                }}
                className={`px-3 py-2.5 text-xs font-bold flex items-center gap-1.5 border-b-2 cursor-pointer transition-colors ${
                  tab === item.id
                    ? 'border-accent text-primary bg-white'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${tab === item.id ? 'text-accent-ink' : ''}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {notice && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {tab === 'branding' && (
            <form onSubmit={handleSaveBranding} className="space-y-5">
              {!isAdmin && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                  Only a <strong className="text-primary">company_admin</strong> can permanently
                  save company branding colours, though you can adjust your workspace theme mode below.
                </div>
              )}

              {/* Top-left Logo Upload & Company Display Name */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-4">
                <CompanyLogoUploadSection
                  previewUrl={effectivePreviewLogoUrl}
                  companyName={companyName || activeCompany.companyName}
                  disabled={!isAdmin}
                  onSelectLogo={validated => {
                    setPendingLogoFile(validated);
                    setPendingRemoveLogo(false);
                    setErrorMsg(null);
                  }}
                  onRemoveLogo={() => {
                    setPendingLogoFile(null);
                    setPendingRemoveLogo(true);
                    setLogoUrl('');
                  }}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200/80">
                  <label className="block space-y-1 text-xs font-semibold text-slate-700">
                    <span>Company Display Name</span>
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={companyName}
                      onChange={e => setCompanyName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm disabled:bg-slate-100"
                    />
                  </label>

                  <label className="block space-y-1 text-xs font-semibold text-slate-700">
                    <span>External Logo URL (Optional)</span>
                    <input
                      type="url"
                      disabled={!isAdmin || Boolean(pendingLogoFile)}
                      value={pendingLogoFile ? pendingLogoFile.fileName : logoUrl}
                      onChange={e => {
                        setLogoUrl(e.target.value);
                        setPendingRemoveLogo(false);
                      }}
                      placeholder="https://cdn.yourcompany.com/logo.png"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm disabled:bg-slate-100"
                    />
                  </label>
                </div>
              </div>

              {/* Curated Brand Theme Presets */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-accent-ink" />
                    <span>Curated Theme Presets</span>
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setPrimaryColour('#052B66');
                        setSecondaryColour('#45CC42');
                        setDraftSurfaceMode('vibrant');
                      }}
                      className="text-[11px] font-semibold text-slate-500 hover:text-primary flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset Default</span>
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {BRAND_THEME_PRESETS.map(preset => {
                    const selected =
                      primaryColour.toUpperCase() === preset.primaryColour &&
                      secondaryColour.toUpperCase() === preset.secondaryColour;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={!isAdmin}
                        onClick={() => {
                          setPrimaryColour(preset.primaryColour);
                          setSecondaryColour(preset.secondaryColour);
                          setDraftSurfaceMode(preset.recommendedMode);
                        }}
                        className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer disabled:opacity-60 ${
                          selected
                            ? 'border-primary ring-2 ring-accent/40 bg-accent-tint/50'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className="w-4 h-4 rounded-sm border border-black/10 shrink-0"
                            style={{ backgroundColor: preset.primaryColour }}
                          />
                          <span
                            className="w-4 h-4 rounded-sm border border-black/10 shrink-0"
                            style={{ backgroundColor: preset.secondaryColour }}
                          />
                          <span className="text-[11px] font-bold text-slate-900 truncate">
                            {preset.name}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 line-clamp-1">
                          {preset.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom Primary & Secondary Pickers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Primary Brand Colour</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      disabled={!isAdmin}
                      value={primaryColour}
                      onChange={e => setPrimaryColour(e.target.value)}
                      className="w-10 h-10 rounded border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={primaryColour}
                      onChange={e => setPrimaryColour(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
                    />
                  </div>
                </label>

                <label className="block space-y-1 text-xs font-semibold text-slate-700">
                  <span>Secondary Accent Colour</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      disabled={!isAdmin}
                      value={secondaryColour}
                      onChange={e => setSecondaryColour(e.target.value)}
                      className="w-10 h-10 rounded border border-slate-200 cursor-pointer"
                    />
                    <input
                      type="text"
                      disabled={!isAdmin}
                      value={secondaryColour}
                      onChange={e => setSecondaryColour(e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono"
                    />
                  </div>
                </label>
              </div>

              {/* Workspace Surface & Secondary Impact Mode */}
              <div className="space-y-2">
                <span className="block text-xs font-bold text-primary">
                  Workspace Surface & Secondary Impact Style
                </span>
                <div className="grid grid-cols-3 gap-2.5">
                  {(
                    [
                      {
                        id: 'classic',
                        title: 'Crisp Classic',
                        desc: 'Neutral slate canvas with clean accent triggers',
                      },
                      {
                        id: 'tinted',
                        title: 'Tinted Executive',
                        desc: 'Subtle brand-washed canvas and gradient headers',
                      },
                      {
                        id: 'vibrant',
                        title: 'High-Impact Accent',
                        desc: 'Strong secondary cards, bars, and workspace focus',
                      },
                    ] as const
                  ).map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setDraftSurfaceMode(opt.id);
                        if (!isAdmin) setSurfaceMode(opt.id);
                      }}
                      className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                        draftSurfaceMode === opt.id
                          ? 'border-accent bg-accent-tint text-primary'
                          : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.title}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">
                        {opt.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Live Theme Preview Card */}
              <div
                className="rounded-xl border border-slate-200 overflow-hidden"
                style={{ backgroundColor: previewTokens.surface }}
              >
                <div
                  className="bg-white px-4 py-2 border-b border-slate-200 flex items-center justify-between"
                  style={{ borderTop: `3px solid ${previewTokens.secondary}` }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {effectivePreviewLogoUrl ? (
                      <div className="w-7 h-7 rounded bg-slate-50 border border-slate-200 flex items-center justify-center p-0.5 shrink-0">
                        <img
                          src={effectivePreviewLogoUrl}
                          alt="Live theme preview logo"
                          className="max-w-full max-h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : (
                      <span
                        className="w-6 h-6 rounded text-[10px] font-extrabold flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: previewTokens.primary,
                          color: previewTokens.primaryContrast,
                          border: `1.5px solid ${previewTokens.secondary}`,
                        }}
                      >
                        {(companyName || activeCompany.companyName).slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span
                      className="text-xs font-bold truncate"
                      style={{ color: previewTokens.primary }}
                    >
                      Live Theme Preview · {companyName || activeCompany.companyName}
                    </span>
                  </div>
                  <span
                    className="px-2.5 py-1 rounded text-[10px] font-bold"
                    style={{
                      backgroundColor: previewTokens.secondary,
                      color: previewTokens.secondaryContrast,
                    }}
                  >
                    + New Course
                  </span>
                </div>
                <div className="p-3.5 space-y-2.5">
                  <div
                    className="rounded-lg p-3 flex flex-wrap items-center justify-between gap-2"
                    style={{
                      background: previewTokens.gradient,
                      color: previewTokens.primaryContrast,
                      borderBottom: `3px solid ${previewTokens.secondary}`,
                    }}
                  >
                    <div className="text-[11px] font-bold">
                      Hero & Navigation Gradient Preview
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-bold"
                        style={{
                          backgroundColor: previewTokens.secondary,
                          color: previewTokens.secondaryContrast,
                        }}
                      >
                        Primary CTA
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-semibold border"
                        style={{ borderColor: previewTokens.secondary }}
                      >
                        Secondary Outline
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 text-[11px]">
                    <div
                      className="rounded-lg p-2.5 border"
                      style={{
                        backgroundColor: previewTokens.secondaryTint,
                        borderColor: previewTokens.secondaryBorder,
                        borderTop: `2.5px solid ${previewTokens.secondary}`,
                      }}
                    >
                      <div className="text-[10px] text-slate-600">Highlighted Metric</div>
                      <div
                        className="text-sm font-bold tabular-nums"
                        style={{ color: previewTokens.secondaryInk }}
                      >
                        86% Aligned
                      </div>
                    </div>
                    <div className="rounded-lg p-2.5 bg-white border border-slate-200 space-y-1.5">
                      <div className="flex justify-between text-[10px] text-slate-600">
                        <span>Stage Progress</span>
                        <span
                          className="font-bold tabular-nums"
                          style={{ color: previewTokens.secondaryInk }}
                        >
                          75%
                        </span>
                      </div>
                      <div
                        className="w-full h-1.5 rounded-full overflow-hidden"
                        style={{ backgroundColor: previewTokens.primarySoft }}
                      >
                        <div
                          className="h-full w-3/4"
                          style={{ backgroundColor: previewTokens.secondary }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {isAdmin && (
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 rounded-lg bg-primary hover:bg-primary-dark text-primary-contrast text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {busy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5 text-accent" />
                    )}
                    <span>Save Branding & Theme</span>
                  </button>
                </div>
              )}
            </form>
          )}

          {tab === 'team' && (
            <div className="space-y-5">
              <div className="p-3 bg-surface border border-slate-200 rounded-lg text-[11px] text-slate-600 leading-relaxed">
                <strong className="text-primary">Governance Role Separation:</strong> Signing off Stage 6 human governance roles (SME, Instructional Designer, Compliance Authoriser) requires explicit assignment below — even for <strong>company_admin</strong> accounts — and three distinct authenticated reviewers must sign off each role.
              </div>

              {isAdmin && (
                <form
                  onSubmit={handleInviteMember}
                  className="p-4 bg-surface border border-slate-200 rounded-lg space-y-3"
                >
                  <div className="text-xs font-bold text-primary flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-accent-ink" />
                    <span>Add or Invite Team Member</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <input
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="colleague@company.com"
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded"
                    />
                    <input
                      type="text"
                      value={inviteFullName}
                      onChange={e => setInviteFullName(e.target.value)}
                      placeholder="Full name"
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded"
                    />
                    <select
                      value={inviteRole}
                      onChange={e => {
                        const nextRole = e.target.value as CompanyRole;
                        setInviteRole(nextRole);
                        if (nextRole !== 'reviewer' && nextRole !== 'company_admin') {
                          setInviteGovernanceRoles([]);
                        }
                      }}
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded"
                    >
                      <option value="author">Author (create & edit courses)</option>
                      <option value="reviewer">Reviewer (review, QA & assigned governance)</option>
                      <option value="viewer">Viewer (read-only)</option>
                      <option value="company_admin">Company Admin (workspace control)</option>
                    </select>
                    <input
                      type="password"
                      value={inviteTempPassword}
                      onChange={e => setInviteTempPassword(e.target.value)}
                      placeholder="Optional initial password (min 8 chars)"
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded"
                    />
                  </div>
                  {(inviteRole === 'reviewer' || inviteRole === 'company_admin') && (
                    <div className="pt-1 space-y-1.5">
                      <div className="text-[11px] font-semibold text-slate-700">
                        Authorised Governance Roles (Optional — required to approve Stage 6 gates)
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {VALID_GOVERNANCE_ROLES.map(govRole => {
                          const checked = inviteGovernanceRoles.includes(govRole);
                          return (
                            <label
                              key={govRole}
                              className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  setInviteGovernanceRoles(prev =>
                                    e.target.checked
                                      ? Array.from(new Set([...prev, govRole]))
                                      : prev.filter(r => r !== govRole)
                                  );
                                }}
                              />
                              <span>{GOVERNANCE_ROLE_LABELS[govRole]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3.5 py-1.5 rounded bg-primary hover:bg-primary-dark text-primary-contrast text-xs font-bold cursor-pointer"
                  >
                    Add Member
                  </button>
                </form>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-bold text-primary">
                  Active & Invited Members ({members.length})
                </h3>
                {members.map(m => {
                  const assignedGov = Array.isArray(m.governanceRoles) ? m.governanceRoles : [];
                  const canHoldGovernance = m.role === 'reviewer' || m.role === 'company_admin';
                  return (
                    <div
                      key={m.id}
                      className="p-3 border border-slate-200 rounded-lg space-y-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-bold text-primary">
                            {m.profile?.fullName || m.profile?.email || m.userId}
                          </div>
                          <div className="text-slate-500">{m.profile?.email}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {isAdmin ? (
                            <>
                              <select
                                aria-label="Member role"
                                value={m.role}
                                onChange={e => {
                                  const nextRole = e.target.value as CompanyRole;
                                  const keepGov =
                                    nextRole === 'reviewer' || nextRole === 'company_admin'
                                      ? assignedGov
                                      : [];
                                  void handleUpdateMember(m.id, {
                                    role: nextRole,
                                    governanceRoles: keepGov,
                                  });
                                }}
                                className="px-2 py-1 border border-slate-200 rounded text-xs"
                              >
                                <option value="company_admin">company_admin</option>
                                <option value="author">author</option>
                                <option value="reviewer">reviewer</option>
                                <option value="viewer">viewer</option>
                              </select>
                              <select
                                aria-label="Member status"
                                value={m.membershipStatus}
                                onChange={e =>
                                  void handleUpdateMember(m.id, {
                                    membershipStatus: e.target.value as MembershipStatus,
                                  })
                                }
                                className="px-2 py-1 border border-slate-200 rounded text-xs"
                              >
                                <option value="active">active</option>
                                <option value="invited">invited</option>
                                <option value="suspended">suspended</option>
                              </select>
                            </>
                          ) : (
                            <span className="px-2 py-1 bg-slate-100 rounded font-semibold">
                              {m.role} · {m.membershipStatus}
                            </span>
                          )}
                        </div>
                      </div>

                      {canHoldGovernance && (
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-3 text-[11px]">
                          <span className="font-semibold text-slate-600">Governance Approval Authority:</span>
                          {isAdmin ? (
                            VALID_GOVERNANCE_ROLES.map(govRole => {
                              const checked = assignedGov.includes(govRole);
                              return (
                                <label
                                  key={govRole}
                                  className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={e => {
                                      const nextGov = e.target.checked
                                        ? Array.from(new Set([...assignedGov, govRole]))
                                        : assignedGov.filter(r => r !== govRole);
                                      void handleUpdateMember(m.id, { governanceRoles: nextGov });
                                    }}
                                  />
                                  <span>{GOVERNANCE_ROLE_LABELS[govRole]}</span>
                                </label>
                              );
                            })
                          ) : assignedGov.length > 0 ? (
                            <span className="text-slate-700 font-medium">
                              {assignedGov.map(r => GOVERNANCE_ROLE_LABELS[r]).join(' · ')}
                            </span>
                          ) : (
                            <span className="text-slate-400">None assigned</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'usage' && (
            <div className="space-y-4">
              {usage ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-surface border border-slate-200 border-t-2 border-t-accent rounded-lg">
                      <div className="text-[11px] text-slate-500">AI Requests</div>
                      <div className="text-lg font-bold text-primary tabular-nums">
                        {usage.totalCalls}
                      </div>
                    </div>
                    <div className="p-3 bg-surface border border-slate-200 border-t-2 border-t-accent rounded-lg">
                      <div className="text-[11px] text-slate-500">Input Tokens</div>
                      <div className="text-lg font-bold text-primary tabular-nums">
                        {usage.totalInputTokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 bg-surface border border-slate-200 border-t-2 border-t-accent rounded-lg">
                      <div className="text-[11px] text-slate-500">Output Tokens</div>
                      <div className="text-lg font-bold text-primary tabular-nums">
                        {usage.totalOutputTokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 bg-surface border border-slate-200 border-t-2 border-t-accent rounded-lg">
                      <div className="text-[11px] text-slate-500">Est. Cost (USD)</div>
                      <div className="text-lg font-bold text-primary tabular-nums">
                        ${usage.totalEstimatedCost.toFixed(4)}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-primary">Recent AI Operations</h4>
                    {usage.recentRecords.length === 0 ? (
                      <p className="text-xs text-slate-500">
                        No recorded Groq AI calls for this workspace yet.
                      </p>
                    ) : (
                      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                        {usage.recentRecords.slice(0, 15).map(rec => (
                          <div
                            key={rec.id}
                            className="px-3 py-2 flex items-center justify-between gap-2"
                          >
                            <div>
                              <span className="font-semibold text-primary">{rec.operation}</span>
                              <span className="text-slate-400 ml-2">{rec.model}</span>
                            </div>
                            <div className="tabular-nums text-slate-600">
                              {rec.inputTokens} in / {rec.outputTokens} out
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-500">Loading AI usage summary...</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
