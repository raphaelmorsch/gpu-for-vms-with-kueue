import { useEffect, useState } from 'react';
import {
  Alert,
  Card,
  CardBody,
  CardTitle,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  Grid,
  GridItem,
  Label,
  PageSection,
  Spinner,
  Title
} from '@patternfly/react-core';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table';
import { api } from '../api';
import type { Overview } from '../types';

const formatRecord = (record: Record<string, number>) =>
  Object.entries(record)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ') || '0';

export const Dashboard: React.FunctionComponent = () => {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .overview()
      .then((overview) => {
        if (!cancelled) {
          setData(overview);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Dashboard de GPUs e VMs</Title>
        <Content component="p">
          Capacidade de GPU fake no cluster, cotas Kueue e máquinas virtuais do OpenShift Virtualization.
        </Content>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Não foi possível carregar o dashboard" isInline>
            {error}
          </Alert>
        )}
        {isLoading && <Spinner aria-label="Carregando dashboard" />}
        {data && (
          <Grid hasGutter>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>GPUs alocáveis</CardTitle>
                <CardBody>
                  <Content component="h2">{data.allocatable['nvidia.com/gpu'] ?? 0}</Content>
                  <Content component="p">nvidia.com/gpu nos nodes</Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>Uso nas filas</CardTitle>
                <CardBody>
                  <Content component="h2">{data.usage['nvidia.com/gpu'] ?? 0}</Content>
                  <Content component="p">GPUs admitidas pelo Kueue</Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>VMs com GPU</CardTitle>
                <CardBody>
                  <Content component="h2">
                    {data.runningGpuVirtualMachines}/{data.gpuVirtualMachines}
                  </Content>
                  <Content component="p">em execução / total</Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} md={6} xl={3}>
              <Card isFullHeight>
                <CardTitle>Workloads Kueue</CardTitle>
                <CardBody>
                  <Content component="h2">{data.admittedWorkloads}</Content>
                  <Content component="p">{data.pendingWorkloads} pendente(s)</Content>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} xl={6}>
              <Card>
                <CardTitle>Cotas e capacidade</CardTitle>
                <CardBody>
                  <DescriptionList isHorizontal>
                    <DescriptionListGroup>
                      <DescriptionListTerm>Capacidade</DescriptionListTerm>
                      <DescriptionListDescription>{formatRecord(data.capacity)}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>Alocável</DescriptionListTerm>
                      <DescriptionListDescription>{formatRecord(data.allocatable)}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>Quota Kueue</DescriptionListTerm>
                      <DescriptionListDescription>{formatRecord(data.quota)}</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                      <DescriptionListTerm>Reservas gerenciadas</DescriptionListTerm>
                      <DescriptionListDescription>{data.reservations}</DescriptionListDescription>
                    </DescriptionListGroup>
                  </DescriptionList>
                </CardBody>
              </Card>
            </GridItem>
            <GridItem span={12} xl={6}>
              <Card>
                <CardTitle>Nodes com GPU</CardTitle>
                <CardBody>
                  {data.nodes.length === 0 ? (
                    <EmptyState titleText="Nenhum node GPU" headingLevel="h2" icon={CubesIcon}>
                      <EmptyStateBody>Nenhum node com recursos NVIDIA foi encontrado.</EmptyStateBody>
                    </EmptyState>
                  ) : (
                    <Table aria-label="Nodes com GPU" variant="compact">
                      <Thead>
                        <Tr>
                          <Th>Node</Th>
                          <Th>Produto</Th>
                          <Th>Alocável</Th>
                          <Th>Tipo</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {data.nodes.map((node) => (
                          <Tr key={node.name}>
                            <Td dataLabel="Node">{node.name}</Td>
                            <Td dataLabel="Produto">{node.product || '—'}</Td>
                            <Td dataLabel="Alocável">
                              {Object.entries(node.allocatable)
                                .map(([key, value]) => `${key}=${value}`)
                                .join(', ') || '0'}
                            </Td>
                            <Td dataLabel="Tipo">
                              {node.fake ? <Label color="orange">Fake GPU</Label> : <Label color="green">GPU</Label>}
                            </Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </GridItem>
          </Grid>
        )}
      </PageSection>
    </>
  );
};
