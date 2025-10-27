import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import Logo from './Logo';
import { useTheme } from '@/context/ThemeContext';

const navigation = [
  { label: 'Dashboard', to: '/' },
  { label: 'Profiles', to: '/profiles' },
  { label: 'Datasets', to: '/datasets' },
  { label: 'Runs', to: '/runs' },
];

const AppLayout = () => {
  const { mode, setMode } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const cycleTheme = () => {
    if (mode === 'light') setMode('dark');
    else if (mode === 'dark') setMode('auto');
    else setMode('light');
  };

  const getThemeIcon = () => {
    if (mode === 'light') return '☀️';
    if (mode === 'dark') return '🌙';
    return '🔄';
  };

  const getThemeLabel = () => {
    if (mode === 'light') return 'Light';
    if (mode === 'dark') return 'Dark';
    return 'Auto';
  };

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="min-h-screen lg:flex lg:overflow-hidden transition-theme">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/75 dark:bg-black/90 backdrop-blur-sm z-40 lg:hidden transition-theme"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          bg-gradient-to-b from-slate-800 to-slate-900 dark:from-slate-900 dark:to-black text-slate-50
          p-4 sm:p-6 lg:p-10 lg:pr-8
          flex flex-col gap-4 sm:gap-6 lg:gap-10
          transition-all duration-300 ease-in-out
          fixed inset-y-0 z-50
          w-[280px] lg:w-[280px]
          ${sidebarOpen ? 'left-0' : '-left-[280px] lg:left-0'}
          lg:h-screen
        `}
      >
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="text-slate-50/65 text-[0.95rem]">Local LLM benchmarking toolkit</p>
        </div>
        <nav className="flex flex-col gap-2">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={closeSidebar}
              className={({ isActive }) =>
                isActive
                  ? 'px-4 py-3 rounded-xl font-medium bg-white text-slate-900 transition-colors'
                  : 'px-4 py-3 rounded-xl font-medium text-slate-50/75 hover:bg-white/12 hover:text-slate-50 transition-colors'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <button
            onClick={cycleTheme}
            className="w-full px-4 py-3 rounded-xl font-medium text-slate-50/75 hover:bg-white/12 hover:text-slate-50 transition-colors flex items-center justify-between"
            title={`Theme: ${getThemeLabel()} (click to change)`}
          >
            <span>Theme: {getThemeLabel()}</span>
            <span className="text-xl">{getThemeIcon()}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 lg:ml-[280px]">
        {/* Mobile header with hamburger */}
        <div className="lg:hidden sticky top-0 z-30 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-4 py-3 flex items-center justify-between transition-theme">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Open menu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-slate-700 dark:text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            KG AI Benchmark
          </span>
          <div className="w-10" /> {/* Spacer for centering */}
        </div>

        <div className="bg-gradient-to-b from-accent-500/5 to-sky-500/5 dark:from-accent-900/10 dark:to-sky-900/10 p-4 sm:p-6 lg:p-10 lg:pl-12 transition-theme min-h-screen lg:h-screen lg:overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
