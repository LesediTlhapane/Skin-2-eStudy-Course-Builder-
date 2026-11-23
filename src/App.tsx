import { useState } from 'react';
import { useV2Store } from './hooks/useV2Store';
import { TopBar } from './components/TopBar';
import { Dashboard } from './components/Dashboard';
import { TemplateStudio } from './components/TemplateStudio';
import { CourseWorkspace } from './components/CourseWorkspace';
import { CreateCourseModal } from './components/CreateCourseModal';

export default function App() {
  const store = useV2Store();
  const [isNewCourseModalOpen, setIsNewCourseModalOpen] = useState(false);
  const [preselectedTemplateId, setPreselectedTemplateId] = useState<string | undefined>(undefined);

  const activeTemplate = store.activeProject
    ? store.allTemplates.find(t => t.id === store.activeProject?.templateId)
    : undefined;

  return (
    <div className="min-h-screen bg-[#F5F7FA] text-slate-900 flex flex-col">
      <TopBar
        route={store.route}
        activeProject={store.activeProject}
        selectedProvider={store.selectedProvider}
        selectedModel={store.selectedModel}
        availableModels={store.availableModels}
        keysStatus={store.keysStatus}
        onNavigate={store.setRoute}
        onSelectProvider={store.setProvider}
        onSelectModel={store.setModel}
        onOpenNewCourse={() => {
          setPreselectedTemplateId(undefined);
          setIsNewCourseModalOpen(true);
        }}
      />

      {store.route === 'dashboard' && (
        <Dashboard
          projects={store.projects}
          templates={store.allTemplates}
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
        />
      )}

      {store.route === 'workspace' && store.activeProject && (
        <CourseWorkspace
          project={store.activeProject}
          template={activeTemplate}
          saveState={store.saveState}
          selectedProvider={store.selectedProvider}
          selectedModel={store.selectedModel}
          onBackToDashboard={() => store.setRoute('dashboard')}
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
    </div>
  );
}
