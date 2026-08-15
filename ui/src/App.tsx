import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import { Dashboard } from './pages/Dashboard';
import { Reservations } from './pages/Reservations';
import { VirtualMachines } from './pages/VirtualMachines';
import { Workloads } from './pages/Workloads';
import { Setup } from './pages/Setup';

export const App: React.FunctionComponent = () => (
  <Routes>
    <Route element={<AppLayout />}>
      <Route path="/" element={<Dashboard />} />
      <Route path="/reservations" element={<Reservations />} />
      <Route path="/vms" element={<VirtualMachines />} />
      <Route path="/workloads" element={<Workloads />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>
);
