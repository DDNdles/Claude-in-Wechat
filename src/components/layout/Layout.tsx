import type { ReactNode } from 'react';
import { cn } from '@shared/lib/utils';
import {
  LayoutDashboard,
  Settings,
  FolderOpen,
  Radio,
  Cable,
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
      {/* Sidebar — translucent glass */}
      <aside
        className="w-60 flex-shrink-0 flex flex-col"
        style={{
          backgroundColor: 'var(--sidebar)',
          backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          borderRight: '1px solid var(--sidebar-border)',
        }}
      >
        {/* Logo */}
        <div className="px-4 py-5 draggable">
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, oklch(0.72 0.19 145 / 0.25), oklch(0.72 0.19 145 / 0.08))',
                boxShadow: '0 0 16px -2px oklch(0.72 0.19 145 / 0.4)',
              }}
            >
              <Cable className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground leading-tight tracking-tight-title">
                Claude in WeChat
              </h1>
              <p className="text-[11px] text-muted-foreground">v0.5.5</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Navigation */}
        <ScrollArea className="flex-1 px-2.5 py-3">
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
                    'w-full justify-start gap-2.5 h-9 rounded-lg',
                    isActive && 'font-medium',
                  )}
                  onClick={() => onNavigate(item.id)}
                >
                  <Icon className="w-4 h-4" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.badge && (
                    <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                      {item.badge}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </nav>
        </ScrollArea>

        {/* Status footer */}
        <div className="px-3 py-3 space-y-2.5" style={{ borderTop: '1px solid var(--sidebar-border)' }}>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Radio className={cn('w-3 h-3', running && 'text-primary')} />
              <span>桥接</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  running && 'status-glow-running',
                )}
                style={{ backgroundColor: running ? 'var(--primary)' : 'oklch(0.55 0 0 / 0.5)' }}
              />
              <span className="text-muted-foreground">{running ? '在线' : '离线'}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen className="w-3 h-3" />
              <span>项目</span>
            </div>
            <span className="text-foreground/80 tabular-nums font-medium">{projectCount}</span>
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