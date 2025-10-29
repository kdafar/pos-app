import React from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import { useStore } from '../src/store';

// Use a tolerant bridge (pos / electronAPI / api)
const invoke = (channel: string, ...args: any[]) =>
  ((window as any).__bridge || (window as any).pos || (window as any).electronAPI || (window as any).api)
    ?.invoke?.(channel, ...args);

// Keep this outside of React so it doesn't recreate each render
const toggleTheme = async () => {
  const isDark = document.documentElement.classList.toggle('dark');
  await invoke?.('store:set', 'ui.theme', isDark ? 'dark' : 'light');
};

export function Layout() {
  // ✅ Select pieces individually (no object literal -> no fresh ref each render)
  const collapsed = useStore(s => s.collapsed);
  const brand = useStore(s => s.brand);
  const toggleCollapsed = useStore(s => s.actions.toggleCollapsed);

  const location = useLocation();

  return (
    <div
      className="h-screen w-screen overflow-hidden grid"
      style={{ gridTemplateColumns: collapsed ? '76px 1fr' : '260px 1fr' }}
    >
      {/* Sidebar */}
      <aside className="h-full card p-3 flex flex-col">
        <div className="flex items-center justify-between gap-2 px-2">
          <div className="font-bold tracking-wide text-sm">
            {collapsed ? '🍣' : `🍣 ${brand}`}
          </div>
          <div className="flex items-center gap-1">
            <button className="btn btn-ghost" title="Toggle theme" onClick={toggleTheme}>🌓</button>
            <button className="btn btn-ghost" title="Collapse" onClick={toggleCollapsed}>
              {collapsed ? '➡️' : '⬅️'}
            </button>
          </div>
        </div>

        <nav className="mt-2 space-y-1">
          <SectionLabel hidden={collapsed}>Orders</SectionLabel>
          <NavLink to="/"         text="Order Process" icon="🧾"  collapsed={collapsed} active={location.pathname === '/'} />
          <NavLink to="/orders"    text="Recent Orders" icon="📜"  collapsed={collapsed} active={location.pathname === '/orders'} />
          <SectionLabel hidden={collapsed}>Catalog</SectionLabel>
          <NavLink to="/categories" text="Categories"   icon="🗂️"  collapsed={collapsed} active={location.pathname === '/categories'} />
          <NavLink to="/items"      text="Items"        icon="📦"  collapsed={collapsed} active={location.pathname === '/items'} />
          <NavLink to="/addons"     text="Addons"       icon="➕"  collapsed={collapsed} active={location.pathname === '/addons'} />
          <NavLink to="/promos"     text="Promocodes"   icon="🏷️"  collapsed={collapsed} active={location.pathname === '/promos'} />
          <SectionLabel hidden={collapsed}>System</SectionLabel>
          <NavLink to="/payment-methods" text="Payment Methods" icon="💳" collapsed={collapsed} active={location.pathname === '/payment-methods'} />
          <NavLink to="/locations" text="Locations"    icon="📍"  collapsed={collapsed} active={location.pathname === '/locations'} />
          <NavLink to="/settings"   text="Settings"     icon="⚙️"  collapsed={collapsed} active={location.pathname === '/settings'} />
        </nav>

        <div className="mt-auto">
          <button className="btn w-full btn-ghost">🚪 {collapsed ? '' : 'Logout'}</button>
        </div>
      </aside>

      {/* Main center */}
      <main className="h-full overflow-y-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({
  to, text, icon, collapsed, active = false,
}: { to: string; text: string; icon?: string; collapsed?: boolean; active?: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl ${active ? 'bg-slate-800/70' : 'hover:bg-slate-800/50'}`}
    >
      <span>{icon || '•'}</span>
      {!collapsed && <span className="text-sm muted">{text}</span>}
    </Link>
  );
}

function SectionLabel({ children, hidden }: { children: React.ReactNode; hidden?: boolean }) {
  if (hidden) return <div className="mt-2" />;
  return <div className="mt-2 mb-1 uppercase tracking-wide text-xs muted px-2">{children}</div>;
}
