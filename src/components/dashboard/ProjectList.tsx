import { useProjectStore } from '../../stores/projectStore';
import ProjectCard from './ProjectCard';
import { useState } from 'react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Card } from '@shared/components/ui/card';
import { Badge } from '@shared/components/ui/badge';
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
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">仪表盘</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {projects.length} 个项目 · {runningProjects.length} 个运行中
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => useProjectStore.getState().loadProjects()}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            刷新
          </Button>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            新建项目
          </Button>
        </div>
      </div>

      {/* Create project */}
      {showCreate && (
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-3">新建项目</h3>
          <div className="flex gap-2">
            <Input
              placeholder="输入项目名称..."
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
          <div className="flex items-center gap-2 mb-3">
            <Play className="w-3.5 h-3.5 text-green-400" />
            <h3 className="text-sm font-semibold text-muted-foreground">
              运行中
            </h3>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{runningProjects.length}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {runningProjects.map(project => (
              <ProjectCard key={project.id} project={project} onClick={() => onProjectClick(project.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Other projects */}
      {otherProjects.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-muted-foreground">
              其他项目
            </h3>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{otherProjects.length}</Badge>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {otherProjects.map(project => (
              <ProjectCard key={project.id} project={project} onClick={() => onProjectClick(project.id)} />
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-16 text-muted-foreground">
          <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin" />
          <p>加载中...</p>
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="text-center py-16">
          <Inbox className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-lg text-muted-foreground mb-1">暂无项目</p>
          <p className="text-sm text-muted-foreground/60 mb-4">
            点击「新建项目」创建，或在微信发送 /new 项目名
          </p>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1.5" />
            新建项目
          </Button>
        </div>
      )}
    </div>
  );
}