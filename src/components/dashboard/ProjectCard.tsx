import type { Project } from '../../../shared/types';
import ProgressBar from './ProgressBar';

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
  const statusConfig = STATUS_CONFIG[project.status] || STATUS_CONFIG.idle;

  return (
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
        <button
          className="btn btn-ghost text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
        >
          详情 →
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
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {project.status === 'running' ? '查看' : '打开'}
        </button>
        {project.status === 'running' && (
          <button
            className="btn btn-ghost text-xs"
            onClick={(e) => {
              e.stopPropagation();
              if (window.electronAPI?.ccOpenTerminal) {
                window.electronAPI.ccOpenTerminal(project.id);
              }
            }}
          >
            🖥️ 终端
          </button>
        )}
      </div>
    </div>
  );
}
