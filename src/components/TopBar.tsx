import React from 'react';
import { Plus, Cpu } from 'lucide-react';
import type { AIModelMeta, AIProvider, CourseProject } from '../types';
import type { AppRoute } from '../hooks/useV2Store';
import { BrandLogo } from './BrandLogo';

interface TopBarProps {
  route: AppRoute;
  activeProject: CourseProject | null;
  selectedProvider: AIProvider;
  selectedModel: string;
  availableModels: AIModelMeta[];
  keysStatus: { groq: boolean };
  onNavigate: (route: AppRoute) => void;
  onSelectProvider: (provider: AIProvider) => void;
  onSelectModel: (model: string) => void;
  onOpenNewCourse: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  route,
  activeProject,
  selectedProvider,
  selectedModel,
  availableModels,
  keysStatus,
  onNavigate,
  onSelectModel,
  onOpenNewCourse,
}) => {
  const providerModels = availableModels.filter(m => m.provider === selectedProvider);

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
      {/* Zone 1: Brand Title */}
      <button
        type="button"
        onClick={() => onNavigate('dashboard')}
        className="flex items-center gap-3 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#052B66] rounded"
      >
        <BrandLogo size="md" />
      </button>

      {/* Zone 2: Clean Single-Line Nav Links */}
      <nav className="flex items-center gap-6 overflow-x-auto">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className={`text-sm font-semibold whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
            route === 'dashboard'
              ? 'text-[#052B66] border-b-2 border-[#45CC42]'
              : 'text-slate-600 hover:text-[#052B66]'
          }`}
        >
          Dashboard
        </button>
        <button
          type="button"
          onClick={() => onNavigate('templates')}
          className={`text-sm font-semibold whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
            route === 'templates'
              ? 'text-[#052B66] border-b-2 border-[#45CC42]'
              : 'text-slate-600 hover:text-[#052B66]'
          }`}
        >
          Templates
        </button>
        {activeProject && (
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className={`text-sm font-semibold whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer max-w-[220px] truncate ${
              route === 'workspace'
                ? 'text-[#052B66] border-b-2 border-[#45CC42]'
                : 'text-slate-600 hover:text-[#052B66]'
            }`}
          >
            Workspace: {activeProject.brief.title || 'Untitled'}
          </button>
        )}
      </nav>

      {/* Zone 3: Groq AI Engine Selector & Primary Action */}
      <div className="flex items-center gap-3 shrink-0">
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
            className="text-xs text-slate-700 bg-transparent focus:outline-none max-w-[185px] truncate cursor-pointer"
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
          className="px-4 py-2 rounded-lg bg-[#052B66] hover:bg-[#042150] text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 text-[#45CC42]" />
          <span>New Course</span>
        </button>
      </div>
    </header>
  );
};
