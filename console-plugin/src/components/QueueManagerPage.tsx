import * as React from 'react';
import { EmbeddedAppPage } from './EmbeddedAppPage';

const QueueManagerPage: React.FC = () => (
  <EmbeddedAppPage appPath="/queues" title="Queue Manager" />
);

export default QueueManagerPage;
