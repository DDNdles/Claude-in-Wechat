import { useProjectStore } from '../../stores/projectStore';
import ProgressBar from '../dashboard/ProgressBar';
import TaskList from './TaskList';
import { Card } from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';
import { Separator } from '@shared/components/ui/separator';
import { ArrowLeft, Play, FolderOpen, Coins, Calendar, Zap, Smartphone, Monitor } from 'lucide-react';
import { toast } from 'sonner';

interface ProjectDetailProps {
  projectId: string;
  onBack: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const STATUS: Record<string, { label: string; className: string; dotColor: string }> = {
  running:   { label: '运行中', className: 'text-[oklch(0.74_0.19_145)]', dotColor: 'oklch(0.74 0.19 145)' },
  idle:      { label: '空闲',   className: 'text-muted-foreground',        dotColor: 'oklch(0.6 0.01 250 / 0.6)' },
  completed: { label: '已完成', className: 'text-[oklch(0.66_0.17_280)]', dotColor: 'oklch(0.66 0.17 280)' },
  error:     { label: '错误',   className: 'text-destructive',             dotColor: 'oklch(0.64 0.22 22)' },
  waiting:   { label: '等待中', className: 'text-[oklch(0.72_0.15_55)]',  dotColor: 'oklch(0.72 0.15 55)' },
};

export default function ProjectDetail({ projectId, onBack }: ProjectDetailProps) {
  const project = useProjectStore(s => s.getProject(projectId));
  const { updateProject } = useProjectStore();

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
        <p className="text-lg mb-3">项目未找到</p>
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
          返回
        </Button>
      </div>
    );
  }

  const s = STATUS[project.status] || STATUS.idle;
  const isRunning = project.status === 'running';

  const handleStart = async () => {
    const api = window.electronAPI;
    if (!api) return;
    await api.projectOpen(projectId);
    const resp = await api.claudeOpenTerminal(projectId, project.path, project.name);
    if (resp.success) {
      updateProject(projectId, { status: 'running', lastActiveAt: new Date().toISOString() });
      toast.success('Claude Code 已启动');
    } else {
      toast.error(resp.error || '启动失败');
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2.5">
              <FolderOpen className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-2xl font-bold tracking-tight-title">{project.name}</h2>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'glow-dot-running animate-pulse-glow' : ''}`} style={{ backgroundColor: s.dotColor }} />
              <span className={`text-sm ${s.className}`}>{s.label}</span>
              <span className="text-sm text-muted-foreground">·</span>
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                {project.launchMode === 'wechat' ? <Smartphone className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
                {project.launchMode === 'wechat' ? '微信启动' : '桌面启动'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleStart}>
            <Play className="w-4 h-4" />
            {isRunning ? '调出窗口' : '启动 Claude'}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Progress + Tokens */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card className="glass-card rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> 进度
          </h3>
          <ProgressBar progress={project.progress} status={project.status} />
          <div className="flex items-center justify-between text-sm">
            <span className="font-mono font-bold tabular-nums">{project.progress}%</span>
            {project.currentStep && project.totalSteps && (
              <span className="text-muted-foreground tabular-nums">步骤 {project.currentStep}/{project.totalSteps}</span>
            )}
          </div>
        </Card>

        <Card className="glass-card rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Coins className="w-4 h-4 text-primary" /> Token 使用
          </h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-xl font-bold text-primary font-mono tabular-nums">{formatTokens(project.sessionTokens)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">本次会话</p>
            </div>
            <div>
              <p className="text-xl font-bold font-mono tabular-nums" style={{ color: 'oklch(0.74 0.19 145)' }}>{formatTokens(project.dailyTokens)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">今日总计</p>
            </div>
            <div>
              <p className="text-xl font-bold font-mono tabular-nums" style={{ color: 'oklch(0.66 0.17 280)' }}>
                ~${((project.dailyTokens / 1000) * 0.003).toFixed(2)}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">估算费用</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Task List */}
      <Card className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-3">任务清单</h3>
        <TaskList tasks={project.tasks} />
      </Card>

      {/* Recent Output */}
      {project.lastOutput && (
        <Card className="glass-card rounded-2xl p-5">
          <h3 className="text-sm font-semibold mb-3">最近输出</h3>
          <pre className="text-xs font-mono whitespace-pre-wrap p-3 rounded-lg text-muted-foreground max-h-72 overflow-auto" style={{ backgroundColor: 'oklch(0 0 0 / 0.2)' }}>
            {project.lastOutput}
          </pre>
        </Card>
      )}

      {/* Project Info */}
      <Card className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Calendar className="w-4 h-4" /> 项目信息
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0">路径</span>
            <span className="font-mono text-xs px-1.5 py-0.5 rounded truncate" style={{ backgroundColor: 'oklch(0 0 0 / 0.2)' }}>{project.path}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0">PID</span>
            <span className="font-mono">{project.pid || 'N/A'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0">创建</span>
            <span>{new Date(project.createdAt).toLocaleString('zh-CN')}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground shrink-0">活跃</span>
            <span>{new Date(project.lastActiveAt).toLocaleString('zh-CN')}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}