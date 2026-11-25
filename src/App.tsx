import { useState } from 'react';
import { Loader2 } from 'lucide-react';
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

  if (!session || !activeCompany || isPasswordRecoveryMode) {
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
        selectedProvider={store.selectedProvider}
        selectedModel={store.selectedModel}
        availableModels={store.availableModels}
        keysStatus={store.keysStatus}
        activeCompany={activeCompany}
        activeRole={activeRole}
        profile={profile}
        memberships={memberships}
        pendingLocalMigrationCount={store.pendingLocalMigrationCount}
        onNavigate={store.setRoute}
        onSelectProvider={store.setProvider}
        onSelectModel={store.setModel}
        onOpenNewCourse={() => {
          setPreselectedTemplateId(undefined);
          setIsNewCourseModalOpen(true);
        }}
        onSwitchCompany={companyId => void setActiveCompanyId(companyId)}
        onOpenCompanySettings={() => setIsCompanySettingsOpen(true)}
        onOpenLocalMigration={() => setIsLocalMigrationOpen(true)}
        onSignOut={() => void signOut()}
      />

      {store.route === 'dashboard' && (
        <Dashboard
          projects={store.projects}
          templates={store.allTemplates}
          activeCompany={activeCompany}
          pendingLocalMigrationCount={store.pendingLocalMigrationCount}
          onOpenLocalMigration={() => setIsLocalMigrationOpen(true)}
          onOpenProject={id => store.openProject(id)}
          onCreateNewCourse={() => {
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
          selectedProvider={store.selectedProvider}
          selectedModel={store.selectedModel}
          onSaveTemplate={store.saveTemplate}
          onDuplicateTemplate={store.duplicateTemplate}
          onDeleteTemplate={store.deleteTemplate}
          onUseTemplate={tplId => {
            setPreselectedTemplateId(tplId);
            setIsNewCourseModalOpen(true);
          }}
          onCreateCourseFromFilledDoc={project => store.createProject(project)}
        />
      )}

      {store.route === 'workspace' && store.activeProject && (
        <CourseWorkspace
          project={store.activeProject}
          template={activeTemplate}
          saveState={store.saveState}
          lastSavedAt={store.lastSavedAt}
          saveError={store.saveError}
          selectedProvider={store.selectedProvider}
          selectedModel={store.selectedModel}
          onBackToDashboard={() => store.setRoute('dashboard')}
          onFlushSaveNow={store.flushSaveNow}
          onUpdateProject={(updater, snapshot) =>
            store.updateProject(store.activeProject!.id, updater, snapshot)
          }
          onRestoreVersion={snapshotId =>
            store.restoreProjectVersion(store.activeProject!.id, snapshotId)
          }
        />
      )}

      <CreateCourseModal
        isOpen={isNewCourseModalOpen}
        templates={store.allTemplates}
        selectedProvider={store.selectedProvider}
        selectedModel={store.selectedModel}
        initialTemplateId={preselectedTemplateId}
        onClose={() => setIsNewCourseModalOpen(false)}
        onCreateProject={store.createProject}
      />

      <CompanySettingsModal
        isOpen={isCompanySettingsOpen}
        onClose={() => setIsCompanySettingsOpen(false)}
      />

      <LocalMigrationModal
        isOpen={isLocalMigrationOpen}
        companyName={activeCompany.companyName}
        readLocalBackup={readLocalBackupSnapshot}
        onClose={() => setIsLocalMigrationOpen(false)}
        onMigrationComplete={store.reloadCloudWorkspace}
      />
    </div>
  );
}
