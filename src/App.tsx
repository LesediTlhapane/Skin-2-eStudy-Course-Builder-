import { useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useTenant } from './context/TenantContext';
import { useV2Store } from './hooks/useV2Store';
import { readLocalBackupSnapshot } from './hooks/useV2Store';
import { TopBar } from './components/TopBar';
import { Dashboard } from './components/Dashboard';
import { TemplateStudio } from './components/TemplateStudio';
import { CourseWorkspace } from './components/CourseWorkspace';
import { CreateCourseModal } from './components/CreateCourseModal';
import { AuthScreens } from './components/auth/AuthScreens';
import { CompanySettingsModal } from './components/CompanySettingsModal';
import { LocalMigrationModal } from './components/LocalMigrationModal';

import { getRolePermissions } from './utils/rbac';

export default function App() {
  const {
    isInitializing,
    session,
    accessToken,
    profile,
    memberships,
    activeCompany,
    activeRole,
    isPasswordRecoveryMode,
    isPasswordSetupMode,
    workspaceNotice,
    setWorkspaceNotice,
    setActiveCompanyId,
    signOut,
  } = useTenant();

  const store = useV2Store({
    companyId: activeCompany?.id || null,
    accessToken,
    isCloudMode: Boolean(session && activeCompany),
  });

  const [isNewCourseModalOpen, setIsNewCourseModalOpen] = useState(false);
  const [preselectedTemplateId, setPreselectedTemplateId] = useState<string | undefined>(undefined);
  const [isCompanySettingsOpen, setIsCompanySettingsOpen] = useState(false);
  const [isLocalMigrationOpen, setIsLocalMigrationOpen] = useState(false);

  const perms = getRolePermissions(activeRole);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm font-semibold text-primary">
          <Loader2 className="w-5 h-5 animate-spin text-accent-ink" />
          <span>Loading your workspace...</span>
        </div>
      </div>
    );
  }

  if (!session || !activeCompany || isPasswordRecoveryMode || isPasswordSetupMode) {
    return <AuthScreens />;
  }

  const activeTemplate = store.activeProject
    ? store.allTemplates.find(t => t.id === store.activeProject?.templateId)
    : undefined;

  return (
    <div className="min-h-screen bg-surface text-slate-900 flex flex-col">
      <TopBar
        route={store.route}
        activeProject={store.activeProject}
        activeCompany={activeCompany}
        activeRole={activeRole}
        profile={profile}
        memberships={memberships}
        pendingLocalMigrationCount={store.pendingLocalMigrationCount}
        onNavigate={store.setRoute}
        onOpenNewCourse={() => {
          if (!perms.canCreateOrDeleteCourse) return;
          setPreselectedTemplateId(undefined);
          setIsNewCourseModalOpen(true);
        }}
        onSwitchCompany={companyId => void setActiveCompanyId(companyId)}
        onOpenCompanySettings={() => setIsCompanySettingsOpen(true)}
        onOpenLocalMigration={() => {
          if (!perms.canCreateOrDeleteCourse) return;
          setIsLocalMigrationOpen(true);
        }}
        onSignOut={() => void signOut()}
      />

      {store.saveError && (
        <div className="bg-red-50 border-b border-red-200 px-4 sm:px-6 py-2.5 text-xs text-red-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{store.saveError}</span>
          </div>
          <button
            type="button"
            onClick={store.clearSaveError}
            aria-label="Dismiss save error"
            className="p-1 text-red-700 hover:text-red-900 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {workspaceNotice && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{workspaceNotice}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setWorkspaceNotice(null);
                setIsCompanySettingsOpen(true);
              }}
              className="px-2.5 py-1 rounded bg-primary text-primary-contrast font-semibold cursor-pointer"
            >
              Open Branding Settings
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceNotice(null)}
              aria-label="Dismiss notice"
              className="p-1 text-amber-700 hover:text-amber-900 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {store.route === 'dashboard' && (
        <Dashboard
          projects={store.projects}
          templates={store.allTemplates}
          activeCompany={activeCompany}
          activeRole={activeRole}
          pendingLocalMigrationCount={store.pendingLocalMigrationCount}
          onOpenLocalMigration={() => {
            if (perms.canCreateOrDeleteCourse) setIsLocalMigrationOpen(true);
          }}
          onOpenProject={id => store.openProject(id)}
          onCreateNewCourse={() => {
            if (!perms.canCreateOrDeleteCourse) return;
            setPreselectedTemplateId(undefined);
            setIsNewCourseModalOpen(true);
          }}
          onDuplicateProject={store.duplicateProject}
          onDeleteProject={store.deleteProject}
          onOpenTemplates={() => store.setRoute('templates')}
          onExportWorkspace={store.exportWorkspaceJson}
          onImportWorkspace={store.importWorkspaceJson}
        />
      )}

      {store.route === 'templates' && (
        <TemplateStudio
          templates={store.allTemplates}
          activeRole={activeRole}
          selectedProvider={store.selectedProvider}
          selectedModel={store.selectedModel}
          onSaveTemplate={store.saveTemplate}
          onDuplicateTemplate={store.duplicateTemplate}
          onDeleteTemplate={store.deleteTemplate}
          onUseTemplate={tplId => {
            if (!perms.canCreateOrDeleteCourse) return;
            setPreselectedTemplateId(tplId);
            setIsNewCourseModalOpen(true);
          }}
          onCreateCourseFromFilledDoc={
            perms.canCreateOrDeleteCourse ? project => store.createProject(project) : undefined
          }
        />
      )}

      {store.route === 'workspace' && store.activeProject && (
        <CourseWorkspace
          project={store.activeProject}
          template={activeTemplate}
          activeRole={activeRole}
          saveState={store.saveState}
          lastSavedAt={store.lastSavedAt}
          saveError={store.saveError}
          selectedProvider={store.selectedProvider}
          selectedModel={store.selectedModel}
          onBackToDashboard={() => store.setRoute('dashboard')}
          onFlushSaveNow={store.flushSaveNow}
          onLoadVersions={store.loadCourseVersions}
          onUpdateProject={(updater, snapshot) => {
            if (perms.isReadOnly) return;
            store.updateProject(store.activeProject!.id, updater, snapshot);
          }}
          onRestoreVersion={snapshotId => {
            if (perms.isReadOnly) return;
            store.restoreProjectVersion(store.activeProject!.id, snapshotId);
          }}
        />
      )}

      {perms.canCreateOrDeleteCourse && (
        <CreateCourseModal
          isOpen={isNewCourseModalOpen}
          templates={store.allTemplates}
          selectedProvider={store.selectedProvider}
          selectedModel={store.selectedModel}
          initialTemplateId={preselectedTemplateId}
          onClose={() => setIsNewCourseModalOpen(false)}
          onCreateProject={store.createProject}
        />
      )}

      <CompanySettingsModal
        isOpen={isCompanySettingsOpen}
        onClose={() => setIsCompanySettingsOpen(false)}
      />

      {perms.canCreateOrDeleteCourse && (
        <LocalMigrationModal
          isOpen={isLocalMigrationOpen}
          companyName={activeCompany.companyName}
          readLocalBackup={readLocalBackupSnapshot}
          onClose={() => setIsLocalMigrationOpen(false)}
          onMigrationComplete={store.reloadCloudWorkspace}
        />
      )}
    </div>
  );
}
