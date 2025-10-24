import { Link } from 'react-router-dom';
import Card from '@/components/ui/Card';

const NotFound = () => {
  return (
    <Card className="flex flex-col gap-4 items-start">
      <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Page not found</h2>
      <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
        The page you are looking for does not exist yet. Head back to the dashboard to continue your
        benchmarking journey.
      </p>
      <Link
        className="inline-flex items-center gap-1.5 font-semibold text-accent-700 dark:text-accent-400 hover:text-accent-800 dark:hover:text-accent-300 transition-colors"
        to="/"
      >
        Return to dashboard
        <span aria-hidden>→</span>
      </Link>
    </Card>
  );
};

export default NotFound;
