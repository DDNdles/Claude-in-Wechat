import type { TaskItem } from '../../../shared/types';
import { cn } from '@shared/lib/utils';
import { Badge } from '@shared/components/ui/badge';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

interface TaskListProps {
  tasks: TaskItem[];
}

const STATUS_ICON: Record<string, React.ElementType> = {
  completed: CheckCircle2,
  in_progress: Loader2,
  pending: Circle,
};

const STATUS_CLASS: Record<string, string> = {
  completed: 'text-green-400',
  in_progress: 'text-blue-400 animate-spin',
  pending: 'text-muted-foreground/40',
};

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  in_progress: '进行中',
  pending: '待处理',
};

export default function TaskList({ tasks }: TaskListProps) {
  if (!tasks || tasks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        暂无任务清单。启动项目后 Claude Code 会自动规划任务。
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {tasks.map((task) => {
        const Icon = STATUS_ICON[task.status] || Circle;
        return (
          <div
            key={task.id}
            className={cn(
              'flex items-start gap-3 p-2.5 rounded-lg transition-colors',
              'hover:bg-accent/50',
            )}
          >
            <div className={STATUS_CLASS[task.status]}>
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn(
                'text-sm',
                task.status === 'completed' && 'line-through text-muted-foreground',
              )}>
                {task.subject}
              </p>
              {task.description && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {task.description}
                </p>
              )}
              {task.status === 'in_progress' && task.activeForm && (
                <p className="text-xs mt-1 text-primary animate-pulse">
                  {task.activeForm}
                </p>
              )}
            </div>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] shrink-0 font-normal">
              {STATUS_LABEL[task.status] || task.status}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}