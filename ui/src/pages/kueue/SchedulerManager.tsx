import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Checkbox,
  Content,
  Grid,
  GridItem,
  Label,
  PageSection,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../../api';
import type { KueueDashboard, PermissionCheck } from '../../types';

export const SchedulerManager: React.FunctionComponent = () => {
  const [data, setData] = useState<KueueDashboard | null>(null);
  const [frameworks, setFrameworks] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGranting, setIsGranting] = useState(false);

  const load = useCallback(async () => {
    const dashboard = await api.kueueDashboard();
    setData(dashboard);
    setFrameworks(dashboard.operator.frameworks);
  }, []);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const toggleFramework = (name: string, enabled: boolean) => {
    setFrameworks((current) => {
      if (enabled) {
        return current.includes(name) ? current : [...current, name];
      }
      return current.filter((item) => item !== name);
    });
  };

  const onSaveIntegrations = async () => {
    setIsSaving(true);
    setError(null);
    setInfo(null);
    try {
      const result = await api.saveIntegrations(frameworks);
      setFrameworks(result.frameworks);
      setInfo('Integrações do Kueue CR actualizadas. O operator reconcilia o controller.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const onGrant = async () => {
    setIsGranting(true);
    setError(null);
    setInfo(null);
    try {
      await api.grantKubevirtPermissions();
      setInfo('RBAC e SCC do Kueue para KubeVirt aplicados ao ServiceAccount kueue-controller-manager.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsGranting(false);
    }
  };

  const checks: PermissionCheck[] = data?.permissions || [];

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Scheduler Manager</Title>
        <Content component="p">
          Visão do que o Kueue está a admitir no OpenShift, das integrações do controller (Pod, Job, Ray, Training) e
          das permissões necessárias para KubeVirt e outros operators.
        </Content>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Erro no Scheduler Manager" isInline>
            {error}
          </Alert>
        )}
        {info && (
          <Alert variant="success" title="Actualizado" isInline>
            {info}
          </Alert>
        )}
        {isLoading && <Spinner aria-label="Carregando Scheduler Manager" />}
        {data && (
          <Grid hasGutter>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>Operator Kueue</CardTitle>
                <CardBody>
                  {data.operator.available ? <Label color="green">Disponível</Label> : <Label color="red">Indisponível</Label>}
                  <Content component="p">{data.operator.detail}</Content>
                  {data.operator.quotaCheckStrategy && (
                    <Content component="small">quotaCheckStrategy: {data.operator.quotaCheckStrategy}</Content>
                  )}
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>Namespaces geridos</CardTitle>
                <CardBody>
                  <Content component="h2">
                    {data.namespaces.managed}/{data.namespaces.total}
                  </Content>
                  <Content component="p">com kueue.openshift.io/managed=true</Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>Filas</CardTitle>
                <CardBody>
                  <Content component="h2">
                    {data.clusterQueues.active}/{data.clusterQueues.total}
                  </Content>
                  <Content component="p">
                    ClusterQueues activas · {data.localQueues} LocalQueues · {data.flavors.length} flavors
                  </Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>Workloads</CardTitle>
                <CardBody>
                  <Content component="h2">{data.workloads.admitted}</Content>
                  <Content component="p">
                    {data.workloads.pending} pendente(s), {data.workloads.finished} finalizado(s), {data.workloads.total}{' '}
                    total
                  </Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12}>
              <Card>
                <CardTitle>Recursos cobertos pelas ClusterQueues</CardTitle>
                <CardBody>
                  {data.coveredResources.length
                    ? data.coveredResources.map((name) => (
                        <Label key={name} style={{ marginRight: '0.5rem', marginBottom: '0.5rem' }}>
                          {name}
                        </Label>
                      ))
                    : 'Nenhuma cota definida.'}
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} xl={6}>
              <Card>
                <CardTitle>Integrações do controller</CardTitle>
                <CardBody>
                  <Content component="p">
                    O Kueue não substitui o kube-scheduler: admite workloads e depois o scheduler do cluster coloca os
                    pods. A integração <strong>Pod</strong> é obrigatória para virt-launcher do KubeVirt.
                  </Content>
                  <Grid hasGutter>
                    {data.knownFrameworks.map((name) => (
                      <GridItem span={12} md={6} key={name}>
                        <Checkbox
                          id={`fw-${name}`}
                          label={name}
                          isChecked={frameworks.includes(name)}
                          isDisabled={name === 'Pod'}
                          onChange={(_event, checked) => toggleFramework(name, checked)}
                        />
                      </GridItem>
                    ))}
                  </Grid>
                  <Toolbar id="integrations-toolbar">
                    <ToolbarContent>
                      <ToolbarItem>
                        <Button variant="primary" onClick={onSaveIntegrations} isLoading={isSaving} isDisabled={isSaving}>
                          Guardar integrações
                        </Button>
                      </ToolbarItem>
                    </ToolbarContent>
                  </Toolbar>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} xl={6}>
              <Card>
                <CardTitle>Permissões Kueue ↔ operators</CardTitle>
                <CardBody>
                  <Content component="p">
                    O ServiceAccount <code>kueue-controller-manager</code> precisa de RBAC no KubeVirt, SCC e pods para
                    admitir VMs. Outros operators (Training, Ray) usam as integrações acima; o operator do Kueue já traz
                    o RBAC desses frameworks.
                  </Content>
                  <Table aria-label="Permissões do Kueue" variant="compact">
                    <Thead>
                      <Tr>
                        <Th>Verificação</Th>
                        <Th>Estado</Th>
                        <Th>Detalhe</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {checks.map((check) => (
                        <Tr key={check.name}>
                          <Td dataLabel="Verificação">{check.name}</Td>
                          <Td dataLabel="Estado">
                            {check.ok ? <Label color="green">OK</Label> : <Label color="red">Em falta</Label>}
                          </Td>
                          <Td dataLabel="Detalhe">{check.detail}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                  <Toolbar id="permissions-toolbar">
                    <ToolbarContent>
                      <ToolbarItem>
                        <Button variant="secondary" onClick={onGrant} isLoading={isGranting} isDisabled={isGranting}>
                          Conceder permissões KubeVirt
                        </Button>
                      </ToolbarItem>
                    </ToolbarContent>
                  </Toolbar>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} xl={6}>
              <Card isFullHeight>
                <CardTitle>Topology-Aware Scheduling</CardTitle>
                <CardBody>
                  <Content component="h2">{data.topologies?.total ?? 0}</Content>
                  <Content component="p">
                    Topologies: {(data.topologies?.names || []).join(', ') || 'nenhuma'}. Flavors com TAS:{' '}
                    {(data.topologies?.tasFlavors || []).join(', ') || 'nenhum'}.
                  </Content>
                  <Content component="small">
                    Gerido em Queue Manager → Topology (TAS). Ligar um flavor de GPU a uma Topology activa o
                    scheduling consciente da topologia.
                  </Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} xl={6}>
              <Card isFullHeight>
                <CardTitle>WorkloadPriorityClasses</CardTitle>
                <CardBody>
                  {(data.priorityClasses || []).length ? (
                    (data.priorityClasses || []).map((item) => (
                      <Label key={item.name} style={{ marginRight: '0.5rem', marginBottom: '0.5rem' }}>
                        {item.name} = {item.value}
                      </Label>
                    ))
                  ) : (
                    <Content component="p">Nenhuma classe definida.</Content>
                  )}
                  <Content component="small">
                    Associe classes a namespaces em Queue Manager → Priority classes. Workloads novos herdam o rótulo
                    kueue.x-k8s.io/priority-class.
                  </Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12}>
              <Card>
                <CardTitle>ClusterQueues no scheduler</CardTitle>
                <CardBody>
                  <Table aria-label="ClusterQueues no scheduler" variant="compact">
                    <Thead>
                      <Tr>
                        <Th>Nome</Th>
                        <Th>Pendentes</Th>
                        <Th>Admitidos</Th>
                        <Th>Stop</Th>
                        <Th>Recursos</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {data.clusterQueues.items.map((item) => (
                        <Tr key={item.name}>
                          <Td dataLabel="Nome">{item.name}</Td>
                          <Td dataLabel="Pendentes">{item.pendingWorkloads}</Td>
                          <Td dataLabel="Admitidos">{item.admittedWorkloads}</Td>
                          <Td dataLabel="Stop">{item.stopPolicy}</Td>
                          <Td dataLabel="Recursos">{item.coveredResources.join(', ')}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </CardBody>
              </Card>
            </GridItem>
          </Grid>
        )}
      </PageSection>
    </>
  );
};
