import { useState } from 'react';
import type { Project } from '../../../shared/types';
import ProgressBar from './ProgressBar';
import { useProjectStore } from '../../stores/projectStore';
import { Card } from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { toast } from 'sonner';
import { Play, Terminal, Trash2, Coins, Smartphone, Monitor } from 'lucide-react';

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
}

const STATUS: Record<string, { label: string; dotClass: string; textClass: string }> = {
  running:   { label: '运行中', dotClass: 'glow-dot-running', textClass: 'text-[oklch(0.74_0.19_145)]' },
  idle:      { label: '空闲',   dotClass: '',                  textClass: 'text-muted-foreground' },
  completed: { label: '已完成', dotClass: '',                  textClass: 'text-[oklch(0.66_0.17_280)]' },
  error:     { label: '错误',   dotClass: 'glow-dot-error',    textClass: 'text-destructive' },
  waiting:   { label: '等待中', dotClass: '',                  textClass: 'text-[oklch(0.72_0.15_55)]' },
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

export default function ProjectCard({ project, onClick }: ProjectCardProps) {
  const [showDelete, setShowDelete] = useState(false);
  const s = STATUS[project.status] || STATUS.idle;
  const { deleteProject, openProject } = useProjectStore();
  const isRunning = project.status === 'running';

  const handleStart = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const api = window.electronAPI;
    if (!api) { toast.error('Electron API 不可用'); return; }
    toast.promise(
      (async () => {
        await openProject(project.id);
        const resp = await api.claudeOpenTerminal(project.id, project.path, project.name);
        if (!resp.success) throw new Error(resp.error || '启动失败');
        return resp;
      })(),
      { loading: '正在启动 Claude Code…', success: 'Claude Code 已启动', error: (err: Error) => `启动失败: ${err.message}` },
    );
  };

  const handleTerminal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const api = window.electronAPI;
    if (!api) { toast.error('Electron API 不可用'); return; }
    const resp = await api.claudeOpenProjectDir(project.id, project.path, project.name);
    if (resp.success) toast.success(resp.data?.message || '终端已打开');
    else toast.error(resp.error || '打开失败');
  };

  const handleDelete = async () => {
    const resp = await deleteProject(project.id);
    if (resp.success) toast.success(`已删除「${project.name}」`);
    else toast.error(resp.error || '删除失败');
    setShowDelete(false);
  };

  return (
    <>
      <Card
        className="glass-card glass-hover cursor-pointer group rounded-2xl animate-float-in"
        onClick={onClick}
      >
        <div className="p-5 space-y-4">
          {/* Header: name + status */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-[15px] truncate tracking-tight-title">{project.name}</h3>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'animate-pulse-glow' : ''} ${s.dotClass}`}
                  style={{ backgroundColor: isRunning ? 'oklch(0.74 0.19 145)' : project.status === 'error' ? 'oklch(0.64 0.22 22)' : project.status === 'completed' ? 'oklch(0.66 0.17 280)' : 'oklch(0.6 0.01 250 / 0.6)' }}
                />
                <span className={`text-[11px] font-medium ${s.textClass}`}>{s.label}</span>
                <span className="text-[11px] text-muted-foreground">·</span>
                <span className="text-[11px] text-muted-foreground">{timeAgo(project.lastActiveAt)}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
              onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Progress */}
          <div className="space-y-1.5">
            <ProgressBar progress={project.progress} status={project.status} />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="tabular-nums">{project.progress}%</span>
              {project.currentStep && project.totalSteps ? (
                <span className="tabular-nums">步骤 {project.currentStep}/{project.totalSteps}</span>
              ) : <span />}
            </div>
          </div>

          {/* Meta row */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Coins className="w-3 h-3" />
              <span className="tabular-nums">{formatTokens(project.sessionTokens)}</span>
            </div>
            <div className="flex items-center gap-1">
              {project.launchMode === 'wechat'
                ? <Smartphone className="w-3 h-3" />
                : <Monitor className="w-3 h-3" />}
              <span>{project.launchMode === 'wechat' ? '微信' : '桌面'}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button size="sm" className="flex-1 h-8" onClick={handleStart}>
              <Play className="w-3.5 h-3.5" />
              {isRunning ? '调出窗口' : '启动 Claude'}
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={handleTerminal}>
              <Terminal className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除项目</DialogTitle>
            <DialogDescription>
              确定要删除「{project.name}」吗？项目文件夹会保留在磁盘上。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}