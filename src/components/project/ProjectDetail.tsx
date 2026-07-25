import { useProjectStore } from '../../stores/projectStore';
import ProgressBar from '../dashboard/ProgressBar';
import TaskList from './TaskList';

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function ProjectDetail({ projectId, onBack }: ProjectDetailProps) {
  const project = useProjectStore(s => s.getProject(projectId));
  const { updateProject } = useProjectStore();

  if (!project) {
    return (
      <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
        <p>项目未找到</p>
        <button className="btn btn-ghost mt-4" onClick={onBack}>← 返回</button>
      </div>
    );
  }

  const handleOpenTerminal = async () => {
    const api = window.electronAPI;
    if (api) {
      await api.claudeOpenProjectDir(projectId, project.path, project.name);
    }
  };

  const handleStartClaude = async () => {
    const api = window.electronAPI;
    if (api) {
      await api.projectOpen(projectId);
      await api.claudeOpenTerminal(projectId, project.path, project.name);
    }
    updateProject(projectId, { status: 'running', lastActiveAt: new Date().toISOString() });
  };

  const statusLabels: Record<string, string> = {
    running: '🟢 运行中',
    idle: '⚪ 空闲',
    completed: '✅ 已完成',
    error: '❌ 错误',
    waiting: '⏳ 等待中',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button className="btn btn-ghost text-lg" onClick={onBack}>←</button>
          <div>
            <h2 className="text-2xl font-bold">📁 {project.name}</h2>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {statusLabels[project.status] || project.status}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {project.status !== 'running' && (
            <button className="btn btn-primary" onClick={handleStartClaude}>
              ▶️ 启动 Claude
            </button>
          )}
          <button className="btn btn-ghost" onClick={handleOpenTerminal}>
            🖥️ 打开终端
          </button>
        </div>
      </div>

      {/* Progress Section */}
      <div className="card">
        <h3 className="font-semibold mb-3">📊 进度</h3>
        <ProgressBar progress={project.progress} status={project.status} />
        <div className="flex items-center justify-between mt-2 text-sm">
          <span>{project.progress}%</span>
          {project.currentStep && project.totalSteps && (
            <span style={{ color: 'var(--color-text-muted)' }}>
              步骤 {project.currentStep}/{project.totalSteps}
            </span>
          )}
          <span style={{ color: 'var(--color-text-muted)' }}>启动方式: {project.launchMode === 'wechat' ? '微信' : '桌面'}</span>
        </div>
      </div>

      {/* Token Usage */}
      <div className="card">
        <h3 className="font-semibold mb-3">💰 Token 使用</h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-blue-400">{formatTokens(project.sessionTokens)}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>本次会话</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-400">{formatTokens(project.dailyTokens)}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>今日总计</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-400">
              ~${((project.dailyTokens / 1000) * 0.003).toFixed(2)}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>估算费用</p>
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="card">
        <h3 className="font-semibold mb-3">📋 任务清单</h3>
        {project.tasks && project.tasks.length > 0 ? (
          <TaskList tasks={project.tasks} />
        ) : (
          <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {project.status === 'running'
              ? '等待 Claude Code 生成任务清单...'
              : '暂无任务清单。启动项目后 Claude Code 会自动规划任务。'}
          </p>
        )}
      </div>

      {/* Recent Output */}
      {project.lastOutput && (
        <div className="card">
          <h3 className="font-semibold mb-3">📝 最近输出</h3>
          <pre className="text-xs font-mono whitespace-pre-wrap p-3 rounded-lg" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)', maxHeight: '300px', overflow: 'auto' }}>
            {project.lastOutput}
          </pre>
        </div>
      )}

      {/* Project Info */}
      <div className="card">
        <h3 className="font-semibold mb-3">ℹ️ 项目信息</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span style={{ color: 'var(--color-text-muted)' }}>路径: </span>
            <span className="font-mono text-xs">{project.path}</span>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)' }}>PID: </span>
            <span>{project.pid || 'N/A'}</span>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)' }}>创建时间: </span>
            <span>{new Date(project.createdAt).toLocaleString('zh-CN')}</span>
          </div>
          <div>
            <span style={{ color: 'var(--color-text-muted)' }}>最近活跃: </span>
            <span>{new Date(project.lastActiveAt).toLocaleString('zh-CN')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
