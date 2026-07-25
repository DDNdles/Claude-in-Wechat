import { useProjectStore } from '../../stores/projectStore';
import ProjectCard from './ProjectCard';
import { useState } from 'react';

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
    await createProject(newName.trim());
    setNewName('');
    setShowCreate(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">📊 仪表盘</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>
            {projects.length} 个项目 · {runningProjects.length} 个运行中
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => setShowCreate(!showCreate)}>
            + 新建项目
          </button>
          <button className="btn btn-ghost" onClick={() => useProjectStore.getState().loadProjects()}>
            🔄 刷新
          </button>
        </div>
      </div>

      {/* Create project dialog */}
      {showCreate && (
        <div className="card">
          <h3 className="font-semibold mb-3">新建项目</h3>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="项目名称..."
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <button className="btn btn-primary" onClick={handleCreate} disabled={!newName.trim()}>
              创建
            </button>
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* Running projects */}
      {runningProjects.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-muted)' }}>
            🟢 运行中 ({runningProjects.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {runningProjects.map(project => (
              <ProjectCard key={project.id} project={project} onClick={() => onProjectClick(project.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Other projects */}
      {otherProjects.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-muted)' }}>
            📁 其他项目 ({otherProjects.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {otherProjects.map(project => (
              <ProjectCard key={project.id} project={project} onClick={() => onProjectClick(project.id)} />
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
          加载中...
        </div>
      )}

      {!loading && projects.length === 0 && (
        <div className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
          <p className="text-4xl mb-4">📁</p>
          <p className="text-lg">暂无项目</p>
          <p className="text-sm mt-1">点击"+ 新建项目"创建，或在微信发送 /new 项目名</p>
        </div>
      )}
    </div>
  );
}
