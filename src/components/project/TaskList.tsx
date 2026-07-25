import type { TaskItem } from '../../../shared/types';

interface TaskListProps {
  tasks: TaskItem[];
}

const STATUS_ICONS: Record<string, string> = {
  completed: '✅',
  in_progress: '🔄',
  pending: '⬜',
};

export default function TaskList({ tasks }: TaskListProps) {
  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-start gap-3 p-2 rounded-lg transition-colors"
          style={{
            backgroundColor: task.status === 'in_progress' ? 'rgba(59,130,246,0.1)' : 'transparent',
          }}
        >
          <span className="text-lg mt-0.5">{STATUS_ICONS[task.status] || '⬜'}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${task.status === 'completed' ? 'line-through opacity-60' : ''}`}>
              {task.subject}
            </p>
            {task.description && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {task.description}
              </p>
            )}
            {task.status === 'in_progress' && task.activeForm && (
              <p className="text-xs mt-1 text-blue-400 animate-pulse">
                {task.activeForm}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
