import { useState, useEffect, useCallback } from 'react';
import { useProjectStore } from './stores/projectStore';
import { useRelayStore } from './stores/relayStore';
import { useSettingsStore } from './stores/settingsStore';
import Layout from './components/layout/Layout';
import ProjectList from './components/dashboard/ProjectList';
import ProjectDetail from './components/project/ProjectDetail';
import SettingsPanel from './components/settings/SettingsPanel';
import SetupWizard from './components/wizard/SetupWizard';

type Page = 'dashboard' | 'project' | 'settings';

function applyTheme(theme: string) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.add(prefersDark ? 'dark' : 'light');
  } else {
    root.classList.add(theme);
  }
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const { projects, loadProjects } = useProjectStore();
  const { hasAccount, running, refreshStatus } = useRelayStore();
  const { settings, loadSettings } = useSettingsStore();

  useEffect(() => {
    async function init() {
      await loadProjects();
      await loadSettings();
      await refreshStatus();
      setInitialized(true);
    }
    init();
  }, []);

  // Apply theme from settings
  useEffect(() => {
    applyTheme(settings.theme);
    if (settings.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [settings.theme]);

  useEffect(() => {
    useProjectStore.getState().startPolling();
    return () => {
      useProjectStore.getState().stopPolling();
    };
  }, []);

  useEffect(() => {
    if (initialized && !settings.wechatEnabled) {
      setShowSetup(true);
    }
  }, [initialized, settings.wechatEnabled]);

  const handleProjectClick = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setPage('project');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedProjectId(null);
    setPage('dashboard');
    loadProjects();
  }, [loadProjects]);

  const handleSetupComplete = useCallback(() => {
    setShowSetup(false);
    loadSettings();
    refreshStatus();
  }, [loadSettings, refreshStatus]);

  const renderPage = () => {
    if (showSetup) {
      return <SetupWizard onComplete={handleSetupComplete} />;
    }
    switch (page) {
      case 'dashboard':
        return <ProjectList onProjectClick={handleProjectClick} />;
      case 'project':
        return selectedProjectId ? (
          <ProjectDetail projectId={selectedProjectId} onBack={handleBack} />
        ) : (
          <ProjectList onProjectClick={handleProjectClick} />
        );
      case 'settings':
        return <SettingsPanel />;
      default:
        return <ProjectList onProjectClick={handleProjectClick} />;
    }
  };

  const runningProjects = projects.filter(p => p.status === 'running');

  return (
    <Layout
      currentPage={page}
      onNavigate={(p) => { setPage(p); setSelectedProjectId(null); }}
      hasAccount={hasAccount}
      running={running}
      projectCount={projects.length}
      runningCount={runningProjects.length}
    >
      {renderPage()}
    </Layout>
  );
}

export default App;