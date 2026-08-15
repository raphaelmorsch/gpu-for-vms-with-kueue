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
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../api';
import type { SetupCheck } from '../types';

export const Setup: React.FunctionComponent = () => {
  const [checks, setChecks] = useState<SetupCheck[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api
      .setup()
      .then((result) => setChecks(result.checks))
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Configuração do cluster</Title>
        <p>
          Verifica Kueue, OpenShift Virtualization, allowlist de GPU no HyperConverged e os direitos do ServiceAccount
          kueue-controller-manager no KubeVirt.
        </p>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Erro ao verificar o cluster" isInline>
            {error}
          </Alert>
        )}
        {isLoading && <Spinner aria-label="Verificando cluster" />}
        {!isLoading && checks.length === 0 && (
          <EmptyState titleText="Sem verificações" headingLevel="h2" icon={CubesIcon}>
            <EmptyStateBody>A API não devolveu o estado da configuração.</EmptyStateBody>
          </EmptyState>
        )}
        {!isLoading && checks.length > 0 && (
          <Table aria-label="Verificações de configuração">
            <Thead>
              <Tr>
                <Th>Componente</Th>
                <Th>Estado</Th>
                <Th>Detalhe</Th>
              </Tr>
            </Thead>
            <Tbody>
              {checks.map((check) => (
                <Tr key={check.name}>
                  <Td dataLabel="Componente">{check.name}</Td>
                  <Td dataLabel="Estado">
                    {check.ok ? <Label color="green">Pronto</Label> : <Label color="red">Pendente</Label>}
                  </Td>
                  <Td dataLabel="Detalhe">{check.detail}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
    </>
  );
};
