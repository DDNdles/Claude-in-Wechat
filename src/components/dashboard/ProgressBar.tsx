import type { ProjectStatus } from '../../../shared/types';
import { Progress } from '@shared/components/ui/progress';
import { cn } from '@shared/lib/utils';

interface ProgressBarProps {
  progress: number;
  status: ProjectStatus;
}

export default function ProgressBar({ progress, status }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, progress));

  return (
    <Progress
      value={clamped}
      className={cn(
        'h-2',
        status === 'completed' && '[&>div]:bg-violet-500',
        status === 'error' && '[&>div]:bg-destructive',
        status === 'running' && 'animate-pulse-glow',
      )}
    />
  );
}