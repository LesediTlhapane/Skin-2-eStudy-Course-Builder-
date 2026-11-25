import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Loader2,
  Palette,
  Save,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  AiUsageSummary,
  CompanyMembership,
  CompanyRole,
  MembershipStatus,
} from '../types';
import { useTenant } from '../context/TenantContext';
import { apiFetch, parseApiJson } from '../utils/apiClient';

interface CompanySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'branding' | 'team' | 'usage';

export const CompanySettingsModal: React.FC<CompanySettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { activeCompany, activeRole, updateLocalActiveCompany } = useTenant();
  const isAdmin = activeRole === 'company_admin';

  const [tab, setTab] = useState<TabKey>('branding');
  const [companyName, setCompanyName] = useState(activeCompany?.companyName || '');
  const [logoUrl, setLogoUrl] = useState(activeCompany?.logoUrl || '');
  const [primaryColour, setPrimaryColour] = useState(activeCompany?.primaryColour || '#052B66');
  const [secondaryColour, setSecondaryColour] = useState(
    activeCompany?.secondaryColour || '#45CC42'
  );

  const [members, setMembers] = useState<CompanyMembership[]>([]);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteRole, setInviteRole] = useState<CompanyRole>('author');
  const [inviteTempPassword, setInviteTempPassword] = useState('');

  useEffect(() => {
    if (!isOpen || !activeCompany) return;
    setCompanyName(activeCompany.companyName);
    setLogoUrl(activeCompany.logoUrl || '');
    setPrimaryColour(activeCompany.primaryColour || '#052B66');
    setSecondaryColour(activeCompany.secondaryColour || '#45CC42');
    setNotice(null);
    setErrorMsg(null);
  }, [isOpen, activeCompany]);

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
          logoUrl: logoUrl.trim() || null,
          primaryColour,
          secondaryColour,
        }),
      });
      const data = await parseApiJson<any>(res);
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save company branding.');
      }
      updateLocalActiveCompany(data.company);
      setNotice('Company branding and settings updated.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to update company settings.');
    } finally {
      setBusy(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    setErrorMsg(null);
    setNotice(null);
    try {
      const res = await apiFetch('/api/v2/tenant/members/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          fullName: inviteFullName.trim(),
          role: inviteRole,
          temporaryPassword: inviteTempPassword.trim() || undefined,
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
      setNotice(`Added ${data.member.profile?.email || 'team member'} (${data.member.role}).`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Team invitation failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateMember = async (
    memberId: string,
    patch: { role?: CompanyRole; membershipStatus?: MembershipStatus }
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
      <div className="bg-white rounded-xl border border-slate-200 max-w-3xl w-full max-h-[90vh] flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-[#052B66]" />
            <div>
              <h2 className="text-base font-bold text-[#052B66]">
                {activeCompany.companyName} · Organisation Settings
              </h2>
              <p className="text-xs text-slate-500">
                Slug: <span className="font-mono">{activeCompany.companySlug}</span> · Your role:{' '}
                <span className="font-semibold text-[#052B66]">{activeRole}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-slate-200 px-6 gap-2 bg-slate-50">
          {[
            { id: 'branding' as const, label: 'Branding & Profile', icon: Palette },
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
                className={`px-3 py-2.5 text-xs font-bold flex items-center gap-1.5 border-b-2 cursor-pointer ${
                  tab === item.id
                    ? 'border-[#052B66] text-[#052B66]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
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
            <form onSubmit={handleSaveBranding} className="space-y-4">
              {!isAdmin && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                  Only a <strong className="text-[#052B66]">company_admin</strong> can edit company
                  branding settings.
                </div>
              )}
              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Company Display Name</span>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50"
                />
              </label>

              <label className="block space-y-1 text-xs font-semibold text-slate-700">
                <span>Company Logo URL (https://...)</span>
                <input
                  type="url"
                  disabled={!isAdmin}
                  value={logoUrl}
                  onChange={e => setLogoUrl(e.target.value)}
                  placeholder="https://cdn.yourcompany.com/logo.png (leave blank for default monogram)"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50"
                />
              </label>

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

              {isAdmin && (
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5 text-[#45CC42]" />}
                  <span>Save Branding & Settings</span>
                </button>
              )}
            </form>
          )}

          {tab === 'team' && (
            <div className="space-y-5">
              {isAdmin && (
                <form
                  onSubmit={handleInviteMember}
                  className="p-4 bg-[#F5F7FA] border border-slate-200 rounded-lg space-y-3"
                >
                  <div className="text-xs font-bold text-[#052B66] flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-[#45CC42]" />
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
                      onChange={e => setInviteRole(e.target.value as CompanyRole)}
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded"
                    >
                      <option value="author">Author (create & edit courses)</option>
                      <option value="reviewer">Reviewer (review & approve)</option>
                      <option value="viewer">Viewer (read-only)</option>
                      <option value="company_admin">Company Admin (full workspace control)</option>
                    </select>
                    <input
                      type="password"
                      value={inviteTempPassword}
                      onChange={e => setInviteTempPassword(e.target.value)}
                      placeholder="Optional initial password (min 8 chars)"
                      className="px-3 py-1.5 text-xs bg-white border border-slate-200 rounded"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-3.5 py-1.5 rounded bg-[#052B66] text-white text-xs font-bold cursor-pointer"
                  >
                    Add Member
                  </button>
                </form>
              )}

              <div className="space-y-2">
                <h3 className="text-xs font-bold text-[#052B66]">
                  Active & Invited Members ({members.length})
                </h3>
                {members.map(m => (
                  <div
                    key={m.id}
                    className="p-3 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-bold text-[#052B66]">
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
                            onChange={e =>
                              void handleUpdateMember(m.id, { role: e.target.value as CompanyRole })
                            }
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
                ))}
              </div>
            </div>
          )}

          {tab === 'usage' && (
            <div className="space-y-4">
              {usage ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded-lg">
                      <div className="text-[11px] text-slate-500">AI Requests</div>
                      <div className="text-lg font-bold text-[#052B66] tabular-nums">
                        {usage.totalCalls}
                      </div>
                    </div>
                    <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded-lg">
                      <div className="text-[11px] text-slate-500">Input Tokens</div>
                      <div className="text-lg font-bold text-[#052B66] tabular-nums">
                        {usage.totalInputTokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded-lg">
                      <div className="text-[11px] text-slate-500">Output Tokens</div>
                      <div className="text-lg font-bold text-[#052B66] tabular-nums">
                        {usage.totalOutputTokens.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 bg-[#F5F7FA] border border-slate-200 rounded-lg">
                      <div className="text-[11px] text-slate-500">Est. Cost (USD)</div>
                      <div className="text-lg font-bold text-[#052B66] tabular-nums">
                        ${usage.totalEstimatedCost.toFixed(4)}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-[#052B66]">Recent AI Operations</h4>
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
                              <span className="font-semibold text-[#052B66]">{rec.operation}</span>
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
