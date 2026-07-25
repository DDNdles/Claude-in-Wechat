import type { ProjectStatus } from '../../../shared/types';

interface ProgressBarProps {
  progress: number;
  status: ProjectStatus;
}

export default function ProgressBar({ progress, status }: ProgressBarProps) {
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';

  return (
    <div className="progress-bar-bg">
      <div
        className={`progress-bar-fill ${isRunning ? 'running' : ''}`}
        style={{
          width: `${Math.min(100, Math.max(0, progress))}%`,
          background: isCompleted
            ? 'linear-gradient(90deg, #8b5cf6, #a78bfa)'
            : isRunning
              ? 'linear-gradient(90deg, #3b82f6, #22c55e)'
              : 'rgba(255,255,255,0.1)',
        }}
      />
    </div>
  );
}
