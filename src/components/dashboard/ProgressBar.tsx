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

  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full"
      style={{ backgroundColor: 'oklch(1 0 0 / 0.06)' }}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-700 ease-out',
          isRunning && 'animate-pulse-glow',
        )}
        style={{
          width: `${clamped}%`,
          background: isError
            ? 'linear-gradient(90deg, oklch(0.55 0.22 22), oklch(0.65 0.22 22))'
            : isCompleted
              ? 'linear-gradient(90deg, oklch(0.55 0.18 280), oklch(0.68 0.16 280))'
              : 'linear-gradient(90deg, oklch(0.62 0.19 145), oklch(0.74 0.19 145))',
          boxShadow: clamped > 0
            ? `0 0 8px ${isError ? 'oklch(0.62 0.22 22 / 0.5)' : isCompleted ? 'oklch(0.62 0.18 280 / 0.5)' : 'oklch(0.72 0.19 145 / 0.5)'}`
            : 'none',
        }}
      />
    </div>
  );
}