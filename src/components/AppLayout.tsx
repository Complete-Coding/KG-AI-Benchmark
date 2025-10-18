import { NavLink, Outlet } from 'react-router-dom';
import Logo from './Logo';

const navigation = [{ label: 'Overview', to: '/' }];

const AppLayout = () => {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__header">
          <Logo />
          <p className="sidebar__subtitle">Benchmarking toolkit</p>
        </div>
        <nav className="sidebar__nav">
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              className={({ isActive }) =>
                `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="app-shell__content">
        <header className="app-header">
          <h1>KG AI Benchmark</h1>
          <span className="app-header__tag">Tech preview</span>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
