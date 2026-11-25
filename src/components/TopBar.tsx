import React, { useState } from 'react';
import {
  Building2,
  ChevronDown,
  CloudUpload,
  Cpu,
  LogOut,
  Plus,
  Settings,
  User,
} from 'lucide-react';
import type {
  AIModelMeta,
  AIProvider,
  CompanyMembership,
  CompanyRole,
  CompanyWorkspace,
  CourseProject,
  UserProfile,
} from '../types';
import type { AppRoute } from '../hooks/useV2Store';
import { BrandLogo } from './BrandLogo';

interface TopBarProps {
  route: AppRoute;
  activeProject: CourseProject | null;
  selectedProvider: AIProvider;
  selectedModel: string;
  availableModels: AIModelMeta[];
  keysStatus: { groq: boolean };
  activeCompany?: CompanyWorkspace | null;
  activeRole?: CompanyRole | null;
  profile?: UserProfile | null;
  memberships?: CompanyMembership[];
  pendingLocalMigrationCount?: number;
  onNavigate: (route: AppRoute) => void;
  onSelectProvider: (provider: AIProvider) => void;
  onSelectModel: (model: string) => void;
  onOpenNewCourse: () => void;
  onSwitchCompany?: (companyId: string) => void;
  onOpenCompanySettings?: () => void;
  onOpenLocalMigration?: () => void;
  onSignOut?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  route,
  activeProject,
  selectedProvider,
  selectedModel,
  availableModels,
  keysStatus,
  activeCompany,
  activeRole,
  profile,
  memberships = [],
  pendingLocalMigrationCount = 0,
  onNavigate,
  onSelectModel,
  onOpenNewCourse,
  onSwitchCompany,
  onOpenCompanySettings,
  onOpenLocalMigration,
  onSignOut,
}) => {
  const providerModels = availableModels.filter(m => m.provider === selectedProvider);
  const [menuOpen, setMenuOpen] = useState(false);

  const primaryColour = activeCompany?.primaryColour || '#052B66';
  const secondaryColour = activeCompany?.secondaryColour || '#45CC42';

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-6">
      {/* Zone 1: Brand Title */}
      <button
        type="button"
        onClick={() => onNavigate('dashboard')}
        className="flex items-center gap-3 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#052B66] rounded"
      >
        <BrandLogo
          size="md"
          companyName={activeCompany?.companyName}
          logoUrl={activeCompany?.logoUrl}
          primaryColour={primaryColour}
          secondaryColour={secondaryColour}
        />
      </button>

      {/* Zone 2: Clean Single-Line Nav Links */}
      <nav className="flex items-center gap-5 overflow-x-auto">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className={`text-sm font-semibold whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
            route === 'dashboard'
              ? 'border-b-2 text-[#052B66]'
              : 'text-slate-600 hover:text-[#052B66]'
          }`}
          style={
            route === 'dashboard'
              ? { color: primaryColour, borderColor: secondaryColour }
              : undefined
          }
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => onNavigate('templates')}
          className={`text-sm font-semibold whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
            route === 'templates'
              ? 'border-b-2 text-[#052B66]'
              : 'text-slate-600 hover:text-[#052B66]'
          }`}
          style={
            route === 'templates'
              ? { color: primaryColour, borderColor: secondaryColour }
              : undefined
          }
        >
          Templates
        </button>
        {activeProject && (
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className={`text-sm font-semibold whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer max-w-[200px] truncate ${
              route === 'workspace'
                ? 'border-b-2 text-[#052B66]'
                : 'text-slate-600 hover:text-[#052B66]'
            }`}
            style={
              route === 'workspace'
                ? { color: primaryColour, borderColor: secondaryColour }
                : undefined
            }
          >
            Workspace: {activeProject.brief.title || 'Untitled'}
          </button>
        )}
      </nav>

      {/* Zone 3: Company Switcher, Groq Selector, New Course, Account Menu */}
      <div className="flex items-center gap-2.5 shrink-0">
        {memberships.length > 1 && activeCompany && onSwitchCompany && (
          <div className="hidden xl:flex items-center gap-1.5 bg-[#F5F7FA] border border-slate-200 rounded-lg px-2 py-1.5">
            <Building2 className="w-3.5 h-3.5 text-[#052B66]" />
            <select
              aria-label="Switch Company Workspace"
              value={activeCompany.id}
              onChange={e => onSwitchCompany(e.target.value)}
              className="text-xs font-semibold text-[#052B66] bg-transparent focus:outline-none max-w-[140px] truncate cursor-pointer"
            >
              {memberships.map(m => (
                <option key={m.companyId} value={m.companyId}>
                  {m.company?.companyName || m.companyId}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="hidden lg:flex items-center gap-2 bg-[#F5F7FA] border border-slate-200 rounded-lg px-2.5 py-1.5">
          <Cpu className="w-3.5 h-3.5 text-[#052B66] shrink-0" />
          <span className="text-xs font-semibold text-[#052B66] whitespace-nowrap">
            Groq {!keysStatus.groq ? '(No key)' : ''}
          </span>
          <span className="text-slate-300">|</span>
          <select
            aria-label="Groq AI Model"
            value={selectedModel}
            onChange={e => onSelectModel(e.target.value)}
            className="text-xs text-slate-700 bg-transparent focus:outline-none max-w-[165px] truncate cursor-pointer"
          >
            {providerModels.length > 0 ? (
              providerModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))
            ) : (
              <option value={selectedModel}>{selectedModel}</option>
            )}
          </select>
        </div>

        <button
          type="button"
          onClick={onOpenNewCourse}
          className="px-3.5 py-2 rounded-lg text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
          style={{ backgroundColor: primaryColour }}
        >
          <Plus className="w-4 h-4" style={{ color: secondaryColour }} />
          <span>New Course</span>
        </button>

        {profile && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen(v => !v)}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-[#F5F7FA] text-xs font-semibold text-[#052B66] flex items-center gap-1.5 cursor-pointer"
            >
              <User className="w-3.5 h-3.5" />
              <span className="hidden sm:inline max-w-[110px] truncate">
                {profile.fullName || profile.email}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1.5 text-xs">
                  <div className="px-3.5 py-2 border-b border-slate-100">
                    <div className="font-bold text-[#052B66] truncate">
                      {profile.fullName || 'Workspace User'}
                    </div>
                    <div className="text-slate-500 truncate">{profile.email}</div>
                    {activeCompany && (
                      <div className="mt-1 text-[11px] font-semibold text-slate-600">
                        {activeCompany.companyName} · {activeRole}
                      </div>
                    )}
                  </div>

                  {memberships.length > 1 && activeCompany && onSwitchCompany && (
                    <div className="px-3.5 py-2 border-b border-slate-100 xl:hidden">
                      <div className="text-[11px] font-semibold text-slate-500 mb-1">
                        Switch Workspace
                      </div>
                      <select
                        value={activeCompany.id}
                        onChange={e => {
                          onSwitchCompany(e.target.value);
                          setMenuOpen(false);
                        }}
                        className="w-full px-2 py-1 border border-slate-200 rounded text-xs"
                      >
                        {memberships.map(m => (
                          <option key={m.companyId} value={m.companyId}>
                            {m.company?.companyName || m.companyId}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {onOpenCompanySettings && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenCompanySettings();
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-700 font-medium cursor-pointer"
                    >
                      <Settings className="w-3.5 h-3.5 text-[#052B66]" />
                      <span>Organisation Settings & Team</span>
                    </button>
                  )}

                  {onOpenLocalMigration && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenLocalMigration();
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-slate-50 flex items-center justify-between gap-2 text-slate-700 font-medium cursor-pointer"
                    >
                      <span className="flex items-center gap-2">
                        <CloudUpload className="w-3.5 h-3.5 text-[#052B66]" />
                        <span>Migrate Local Courses</span>
                      </span>
                      {pendingLocalMigrationCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold text-[10px]">
                          {pendingLocalMigrationCount}
                        </span>
                      )}
                    </button>
                  )}

                  {onSignOut && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onSignOut();
                      }}
                      className="w-full px-3.5 py-2 text-left hover:bg-red-50 flex items-center gap-2 text-red-700 font-semibold border-t border-slate-100 mt-1 cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign Out</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
