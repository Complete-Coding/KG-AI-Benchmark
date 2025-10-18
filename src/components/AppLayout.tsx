import { NavLink, Outlet } from 'react-router-dom';
import Logo from './Logo';
import { useTheme } from '@/context/ThemeContext';

const navigation = [
  { label: 'Dashboard', to: '/' },
  { label: 'Profiles', to: '/profiles' },
  { label: 'Runs', to: '/runs' },
];

const AppLayout = () => {
  const { mode, setMode } = useTheme();

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

  return (
    <div className="grid grid-cols-[280px_1fr] min-h-screen lg:grid-cols-1 transition-theme">
      <aside className="bg-gradient-to-b from-slate-800 to-slate-900 dark:from-slate-900 dark:to-black text-slate-50 p-10 pr-8 flex flex-col gap-10 transition-theme">
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
      <div className="bg-gradient-to-b from-accent-500/5 to-sky-500/5 dark:from-accent-900/10 dark:to-sky-900/10 p-10 pl-12 flex flex-col gap-8 transition-theme">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            KG AI Benchmark
          </h1>
          <span className="bg-accent-500/12 text-accent-600 dark:text-accent-400 font-semibold px-3 py-2 rounded-full text-sm">
            Tech preview
          </span>
        </header>
        <main className="flex flex-col gap-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
