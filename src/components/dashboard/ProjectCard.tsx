import { useState } from 'react';
import type { Project } from '../../../shared/types';
import ProgressBar from './ProgressBar';
import { useProjectStore } from '../../stores/projectStore';
import { Card } from '@shared/components/ui/card';
import { Button } from '@shared/components/ui/button';
import { Badge } from '@shared/components/ui/badge';
import { Separator } from '@shared/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { toast } from 'sonner';
import {
  Play,
  Terminal,
  Trash2,
  Clock,
  Coins,
  Folder,
} from 'lucide-react';

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  running: { label: '运行中', variant: 'default' },
  idle: { label: '空闲', variant: 'secondary' },
  completed: { label: '已完成', variant: 'outline' },
  error: { label: '错误', variant: 'destructive' },
  waiting: { label: '等待中', variant: 'secondary' },
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
  const statusConfig = STATUS_CONFIG[project.status] || STATUS_CONFIG.idle;
  const { deleteProject, openProject } = useProjectStore();

  const handleStartClaude = async (e: React.MouseEvent) => {
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
      {
        loading: '正在启动 Claude Code...',
        success: () => 'Claude Code 已启动',
        error: (err) => `启动失败: ${err.message}`,
      },
    );
  };

  const handleOpenTerminal = async (e: React.MouseEvent) => {
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
        className="cursor-pointer transition-all duration-200 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 group"
        onClick={onClick}
      >
        <div className="p-4 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                <h3 className="font-semibold text-sm truncate">{project.name}</h3>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <Badge variant={statusConfig.variant} className="h-5 px-1.5 text-[10px]">
                  {statusConfig.label}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {timeAgo(project.lastActiveAt)}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0"
              onClick={(e) => { e.stopPropagation(); setShowDelete(true); }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Progress */}
          <div className="space-y-1">
            <ProgressBar progress={project.progress} status={project.status} />
            {project.currentStep && project.totalSteps ? (
              <p className="text-[11px] text-muted-foreground text-right">
                步骤 {project.currentStep}/{project.totalSteps}
              </p>
            ) : null}
          </div>

          {/* Meta */}
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <Coins className="w-3 h-3" />
              {formatTokens(project.sessionTokens)}
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {project.launchMode === 'wechat' ? '微信' : '桌面'}
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex gap-1.5">
            <Button
              variant="default"
              size="sm"
              className="flex-1 h-8 text-xs"
              onClick={handleStartClaude}
            >
              <Play className="w-3 h-3 mr-1" />
              启动
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={handleOpenTerminal}
            >
              <Terminal className="w-3 h-3 mr-1" />
              终端
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