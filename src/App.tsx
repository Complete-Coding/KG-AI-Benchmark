import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import { BenchmarkProvider } from './context/BenchmarkContext';
import Dashboard from './pages/Dashboard';
import NotFound from './pages/NotFound';
import Profiles from './pages/Profiles';
import Datasets from './pages/Datasets';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';

const App = () => {
  return (
    <BenchmarkProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/profiles" element={<Profiles />} />
          <Route path="/datasets" element={<Datasets />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:runId" element={<RunDetail />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BenchmarkProvider>
  );
};

export default App;
