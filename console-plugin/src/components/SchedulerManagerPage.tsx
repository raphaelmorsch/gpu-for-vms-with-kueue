import * as React from 'react';
import { EmbeddedAppPage } from './EmbeddedAppPage';

const SchedulerManagerPage: React.FC = () => (
  <EmbeddedAppPage appPath="/scheduler" title="Scheduler Manager" />
);

export default SchedulerManagerPage;
