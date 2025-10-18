import { Link } from 'react-router-dom';

const NotFound = () => {
  return (
    <div className="panel">
      <h2>Page not found</h2>
      <p className="panel__subtitle">
        The page you are looking for does not exist yet. Head back to the dashboard to continue your
        benchmarking journey.
      </p>
      <Link className="not-found__link" to="/">
        Return to dashboard
      </Link>
    </div>
  );
};

export default NotFound;
