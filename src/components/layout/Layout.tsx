import type { ReactNode } from 'react';
import { cn } from '@shared/lib/utils';
import {
  LayoutDashboard,
  Settings,
  FolderOpen,
  Radio,
  Cable,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Badge } from '@shared/components/ui/badge';
import { Separator } from '@shared/components/ui/separator';
import { ScrollArea } from '@shared/components/ui/scroll-area';

type Page = 'dashboard' | 'project' | 'settings';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  hasAccount: boolean;
  running: boolean;
  projectCount: number;
  runningCount: number;
}

export default function Layout({
  children,
  currentPage,
  onNavigate,
  hasAccount,
  running,
  projectCount,
  runningCount,
}: LayoutProps) {
  const navItems = [
    {
      id: 'dashboard' as Page,
      label: '仪表盘',
      icon: LayoutDashboard,
      badge: runningCount > 0 ? runningCount : undefined,
    },
    {
      id: 'settings' as Page,
      label: '设置',
      icon: Settings,
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-border flex flex-col bg-card">
        {/* Logo */}
        <div className="px-4 py-5 draggable">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
              <Cable className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground leading-tight">
                Claude in WeChat
              </h1>
              <p className="text-[11px] text-muted-foreground">v0.5.3</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Navigation */}
        <ScrollArea className="flex-1 px-2 py-3">
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <Button
                  key={item.id}
                  variant={isActive ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'w-full justify-start gap-2.5 h-9',
                    isActive && 'bg-secondary font-medium',
                  )}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <Badge variant="default" className="h-5 px-1.5 text-[10px] bg-primary/90">
                      {item.badge}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </nav>
        </ScrollArea>

        {/* Status footer */}
        <div className="p-3 border-t border-border space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Radio className={cn('w-3 h-3', running ? 'text-green-400' : 'text-muted-foreground/50')} />
              <span>桥接</span>
            </div>
            <Badge variant={running ? 'default' : 'secondary'} className="h-5 px-1.5 text-[10px]">
              {running ? '在线' : '离线'}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen className="w-3 h-3" />
              <span>项目</span>
            </div>
            <span className="text-muted-foreground tabular-nums">{projectCount}</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}