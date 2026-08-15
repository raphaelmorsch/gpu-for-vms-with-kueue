import { useEffect, useState } from 'react';
import {
  Alert,
  EmptyState,
  EmptyStateBody,
  Label,
  PageSection,
  Spinner,
  Title
} from '@patternfly/react-core';
import SearchIcon from '@patternfly/react-icons/dist/esm/icons/search-icon';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../api';
import type { Workload } from '../types';

export const Workloads: React.FunctionComponent = () => {
  const [items, setItems] = useState<Workload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .workloads()
      .then((result) => setItems(result.items))
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Workloads Kueue</Title>
        <p>Workloads criados automaticamente para pods virt-launcher e outros jobs gerenciados.</p>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Erro ao listar workloads" isInline>
            {error}
          </Alert>
        )}
        {isLoading && <Spinner aria-label="Carregando workloads" />}
        {!isLoading && items.length === 0 && (
          <EmptyState titleText="Nenhum workload" headingLevel="h2" icon={SearchIcon}>
            <EmptyStateBody>Ainda não há workloads Kueue neste cluster.</EmptyStateBody>
          </EmptyState>
        )}
        {!isLoading && items.length > 0 && (
          <Table aria-label="Workloads Kueue">
            <Thead>
              <Tr>
                <Th>Nome</Th>
                <Th>Namespace</Th>
                <Th>LocalQueue</Th>
                <Th>ClusterQueue</Th>
                <Th>Estado</Th>
                <Th>Recursos</Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr key={`${item.namespace}/${item.name}`}>
                  <Td dataLabel="Nome">{item.name}</Td>
                  <Td dataLabel="Namespace">{item.namespace}</Td>
                  <Td dataLabel="LocalQueue">{item.queue || '—'}</Td>
                  <Td dataLabel="ClusterQueue">{item.clusterQueue || '—'}</Td>
                  <Td dataLabel="Estado">
                    {item.finished ? (
                      <Label color="grey">Finalizado</Label>
                    ) : item.admitted ? (
                      <Label color="green">Admitido</Label>
                    ) : item.quotaReserved ? (
                      <Label color="blue">Cota reservada</Label>
                    ) : (
                      <Label color="orange">Pendente</Label>
                    )}
                  </Td>
                  <Td dataLabel="Recursos">
                    {Object.entries(item.resources)
                      .map(([key, value]) => `${key}=${value}`)
                      .join(', ') || '—'}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
};
