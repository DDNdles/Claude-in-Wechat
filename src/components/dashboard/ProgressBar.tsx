import type { ProjectStatus } from '../../../shared/types';
import { cn } from '@shared/lib/utils';

interface ProgressBarProps {
  progress: number;
  status: ProjectStatus;
}

export default function ProgressBar({ progress, status }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, progress));
  const isRunning = status === 'running';
  const isCompleted = status === 'completed';
  const isError = status === 'error';

  const fill = isError
    ? 'linear-gradient(90deg, oklch(0.58 0.22 22), oklch(0.68 0.22 22))'
    : isCompleted
      ? 'linear-gradient(90deg, oklch(0.58 0.17 280), oklch(0.70 0.15 280))'
      : 'linear-gradient(90deg, oklch(0.64 0.19 145), oklch(0.76 0.19 145))';
  const glow = isError ? 'oklch(0.64 0.22 22 / 0.5)' : isCompleted ? 'oklch(0.66 0.17 280 / 0.5)' : 'oklch(0.74 0.19 145 / 0.5)';

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'oklch(1 0 0 / 0.06)' }}>
      <div
        className={cn('h-full rounded-full transition-all duration-700 ease-out', isRunning && 'animate-pulse-glow')}
        style={{
          width: `${clamped}%`,
          background: fill,
          boxShadow: clamped > 0 ? `0 0 10px ${glow}` : 'none',
        }}
      />
    </div>
  );
}