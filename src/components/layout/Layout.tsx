import type { ReactNode } from 'react';

interface LayoutProps {
  sidebar: ReactNode;
  statusBar: ReactNode;
  children: ReactNode;
}

export default function Layout({ sidebar, statusBar, children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        {sidebar}
        <div className="flex-1" />
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin p-6">
          {children}
        </main>

        {/* Status Bar */}
        <footer className="h-8 flex-shrink-0 border-t flex items-center px-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          {statusBar}
        </footer>
      </div>
    </div>
  );
}
