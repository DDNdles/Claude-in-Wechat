import { useProjectStore } from '../../stores/projectStore';
import ProjectCard from './ProjectCard';
import { useState } from 'react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Card } from '@shared/components/ui/card';
import { toast } from 'sonner';
import { Plus, RefreshCw, FolderOpen, Play, Inbox } from 'lucide-react';

interface ProjectListProps {
  onProjectClick: (projectId: string) => void;
}

export default function ProjectList({ onProjectClick }: ProjectListProps) {
  const { projects, loading, createProject } = useProjectStore();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const runningProjects = projects.filter(p => p.status === 'running');
  const otherProjects = projects.filter(p => p.status !== 'running');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const resp = await createProject(newName.trim());
    if (resp.success) {
      toast.success(`项目「${newName.trim()}」已创建`);
      setNewName('');
      setShowCreate(false);
    } else {
      toast.error(resp.error || '创建失败');
    }
  };

  return (
    <div className="space-y-7 max-w-6xl">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight-title">仪表盘</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {projects.length} 个项目 · {runningProjects.length} 个运行中
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => useProjectStore.getState().loadProjects()}>
            <RefreshCw className="w-3.5 h-3.5" />
            刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-3.5 h-3.5" />
            新建项目
          </Button>
        </div>
      </div>

      {/* Create project */}
      {showCreate && (
        <Card className="glass-card rounded-2xl p-4 animate-float-in">
          <h3 className="font-semibold text-sm mb-3">新建项目</h3>
          <div className="flex gap-2">
            <Input
              placeholder="输入项目名称…"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
              className="flex-1"
            />
            <Button onClick={handleCreate} disabled={!newName.trim()}>创建</Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>取消</Button>
          </div>
        </Card>
      )}

      {/* Running projects */}
      {runningProjects.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3.5">
            <span className="w-1.5 h-1.5 rounded-full glow-dot-running" style={{ backgroundColor: 'oklch(0.74 0.19 145)' }} />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">运行中</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {runningProjects.map(p => (
              <ProjectCard key={p.id} project={p} onClick={() => onProjectClick(p.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Other projects */}
      {otherProjects.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3.5">
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">其他项目</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {otherProjects.map(p => (
              <ProjectCard key={p.id} project={p} onClick={() => onProjectClick(p.id)} />
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-20 text-muted-foreground">
          <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p className="text-sm">加载中…</p>
        </div>
      )}

      {!loading && projects.length === 0 && (
        <Card className="glass-card rounded-2xl py-16 text-center animate-float-in">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: 'oklch(0.74 0.19 145 / 0.1)' }}>
            <Inbox className="w-7 h-7 text-primary" />
          </div>
          <p className="text-lg font-medium mb-1">暂无项目</p>
          <p className="text-sm text-muted-foreground mb-5">
            点击「新建项目」创建，或在微信发送 /new 项目名
          </p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" />
            新建项目
          </Button>
        </Card>
      )}
    </div>
  );
}