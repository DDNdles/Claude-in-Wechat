import { useState } from 'react';
import type { Project } from '../../../shared/types';
import ProgressBar from './ProgressBar';
import ConfirmDialog from '../common/ConfirmDialog';
import Toast from '../common/Toast';
import { useProjectStore } from '../../stores/projectStore';

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
}

const STATUS_CONFIG: Record<string, { emoji: string; label: string; className: string }> = {
  running: { emoji: '🟢', label: '运行中', className: 'running' },
  idle: { emoji: '⚪', label: '空闲', className: 'idle' },
  completed: { emoji: '✅', label: '已完成', className: 'completed' },
  error: { emoji: '❌', label: '错误', className: 'error' },
  waiting: { emoji: '⏳', label: '等待中', className: 'idle' },
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

export default function ProjectCard({ project, onClick }: ProjectCardProps) {
  const [showDelete, setShowDelete] = useState(false);
  const [toast, setToast] = useState('');

  const statusConfig = STATUS_CONFIG[project.status] || STATUS_CONFIG.idle;
  const { deleteProject, openProject } = useProjectStore();

  const handleOpenProject = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setToast('正在打开项目...');
    try {
      const resp = await openProject(project.id);
      if (resp.success) {
        setToast(`✅ 已打开项目「${project.name}」`);
      } else {
        setToast(`❌ 打开失败: ${resp.error || '未知错误'}`);
      }
    } catch {
      setToast('❌ 无法连接后端服务');
    }
    setTimeout(() => setToast(''), 3000);
  };

  const handleOpenTerminal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.electronAPI?.ccOpenTerminal) {
      window.electronAPI.ccOpenTerminal(project.id);
      setToast('🖥️ 正在打开终端窗口...');
    } else {
      // Fallback for non-Electron env
      setToast(`📁 项目路径: ${project.path}`);
    }
    setTimeout(() => setToast(''), 3000);
  };

  const handleDelete = async () => {
    setToast('正在删除...');
    const resp = await deleteProject(project.id);
    if (resp.success) {
      setToast(`✅ 已删除「${project.name}」`);
    } else {
      setToast(`❌ 删除失败: ${resp.error || '未知错误'}`);
    }
    setShowDelete(false);
    setTimeout(() => setToast(''), 3000);
  };

  return (
    <>
      <div className="card cursor-pointer group" onClick={onClick}>
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base truncate">📁 {project.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className={`status-dot ${statusConfig.className}`} />
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {statusConfig.emoji} {statusConfig.label}
              </span>
            </div>
          </div>
          {/* Delete button (shown on hover) */}
          <button
            className="btn btn-ghost text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
            onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}
            title="删除项目"
          >
            🗑️
          </button>
        </div>

        {/* Progress */}
        <div className="mb-3">
          <ProgressBar progress={project.progress} status={project.status} />
          {project.currentStep && project.totalSteps && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
              步骤 {project.currentStep}/{project.totalSteps}
            </p>
          )}
        </div>

        {/* Token & Meta */}
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-text-muted)' }}>
          <span>💰 {formatTokens(project.sessionTokens)} tok</span>
          <span>{timeAgo(project.lastActiveAt)}</span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            className="btn btn-primary text-xs flex-1"
            onClick={handleOpenProject}
          >
            {project.status === 'running' ? '🔄 查看' : '▶️ 启动'}
          </button>
          <button
            className="btn btn-ghost text-xs"
            onClick={handleOpenTerminal}
            title="在终端中打开项目"
          >
            🖥️ 终端
          </button>
        </div>
      </div>

      {/* Delete confirmation */}
      {showDelete && (
        <ConfirmDialog
          title="删除项目"
          message={`确定要删除「${project.name}」吗？项目文件夹会保留在磁盘上。`}
          confirmLabel="删除"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}

      {/* Toast notification */}
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </>
  );
}
