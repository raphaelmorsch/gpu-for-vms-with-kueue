import { useState } from 'react';
import { Content, PageSection, Tab, Tabs, TabTitleText, Title } from '@patternfly/react-core';
import { ClusterQueuesPanel } from './ClusterQueuesPanel';
import { FlavorsPanel } from './FlavorsPanel';
import { LocalQueuesPanel } from './LocalQueuesPanel';
import { NamespacesPanel } from './NamespacesPanel';
import { PriorityClassesPanel } from './PriorityClassesPanel';
import { TopologyPanel } from './TopologyPanel';

export const QueueManager: React.FunctionComponent = () => {
  const [activeKey, setActiveKey] = useState<string | number>('namespaces');

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Queue Manager</Title>
        <Content component="p">
          Controla os artefactos de fila do Kueue no OpenShift: namespaces geridos, ClusterQueues, LocalQueues,
          ResourceFlavors, Topology-Aware Scheduling e WorkloadPriorityClasses. As reservas de GPU continuam na aba
          Reservas.
        </Content>
      </PageSection>
      <PageSection type="tabs">
        <Tabs
          activeKey={activeKey}
          onSelect={(_event, eventKey) => setActiveKey(eventKey)}
          aria-label="Secções do Queue Manager"
          isSubtab
          usePageInsets
        >
          <Tab eventKey="namespaces" title={<TabTitleText>Namespaces</TabTitleText>} />
          <Tab eventKey="clusterqueues" title={<TabTitleText>ClusterQueues</TabTitleText>} />
          <Tab eventKey="localqueues" title={<TabTitleText>LocalQueues</TabTitleText>} />
          <Tab eventKey="flavors" title={<TabTitleText>ResourceFlavors</TabTitleText>} />
          <Tab eventKey="topology" title={<TabTitleText>Topology (TAS)</TabTitleText>} />
          <Tab eventKey="priority" title={<TabTitleText>Priority classes</TabTitleText>} />
        </Tabs>
      </PageSection>
      <PageSection>
        {activeKey === 'namespaces' && <NamespacesPanel />}
        {activeKey === 'clusterqueues' && <ClusterQueuesPanel />}
        {activeKey === 'localqueues' && <LocalQueuesPanel />}
        {activeKey === 'flavors' && <FlavorsPanel />}
        {activeKey === 'topology' && <TopologyPanel />}
        {activeKey === 'priority' && <PriorityClassesPanel />}
      </PageSection>
    </>
  );
};
