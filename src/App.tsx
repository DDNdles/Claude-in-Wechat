import { useState, useEffect, useCallback } from 'react';
import Layout from './components/layout/Layout';
import ProjectList from './components/dashboard/ProjectList';
import ProjectDetail from './components/project/ProjectDetail';
import SettingsPanel from './components/settings/SettingsPanel';
import SetupWizard from './components/wizard/SetupWizard';
import { useProjectStore } from './stores/projectStore';
import { useRelayStore } from './stores/relayStore';
import { useSettingsStore } from './stores/settingsStore';

type Page = 'dashboard' | 'project' | 'settings';

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  const { projects, loadProjects } = useProjectStore();
  const { hasAccount, running, refreshStatus } = useRelayStore();
  const { settings, loadSettings } = useSettingsStore();

  useEffect(() => {
    loadProjects();
    loadSettings();
    refreshStatus();

    if (!settings.wechatEnabled) {
      setShowSetup(true);
    }
  }, []);

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

  const sidebar = (
    <div>
      <div className="px-4 py-6">
        <h1 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
          🔷 Claude in WeChat
        </h1>
        <p className="text-xs text-gray-500 mt-1">v0.3.0</p>
      </div>
      <nav className="px-2 space-y-1">
        <button
          className={`sidebar-link w-full text-left ${page === 'dashboard' ? 'active' : ''}`}
          onClick={() => { setPage('dashboard'); setSelectedProjectId(null); }}
        >
          <span>📊</span>
          <span>仪表盘</span>
        </button>
        <button
          className={`sidebar-link w-full text-left ${page === 'settings' ? 'active' : ''}`}
          onClick={() => setPage('settings')}
        >
          <span>⚙️</span>
          <span>设置</span>
        </button>
      </nav>
    </div>
  );

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

  return (
    <Layout
      sidebar={sidebar}
      statusBar={
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className={`status-dot ${hasAccount ? 'running' : 'idle'}`} />
            <span>微信: {hasAccount ? '已绑定' : '未绑定'}</span>
          </span>
          <span className="text-gray-600">|</span>
          <span className="flex items-center gap-1.5">
            <span className={`status-dot ${running ? 'running' : 'idle'}`} />
            <span>桥接: {running ? '运行中' : '未启动'}</span>
          </span>
          <span className="text-gray-600">|</span>
          <span>项目: {projects.length}</span>
          <span className="text-gray-600">|</span>
          <span className="text-gray-500">v0.3.0</span>
        </div>
      }
    >
      {renderPage()}
    </Layout>
  );
}

export default App;
