import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionGroup,
  Alert,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  NumberInput,
  PageSection,
  Spinner,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../api';
import type { GpuResource, NamespaceItem, Reservation } from '../types';

const gpuSummary = (quota: Record<string, number>) =>
  Object.entries(quota)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ') || '0';

export const Reservations: React.FunctionComponent = () => {
  const [items, setItems] = useState<Reservation[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([]);
  const [gpuResources, setGpuResources] = useState<GpuResource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [namespace, setNamespace] = useState('gpu-vms');
  const [gpuResource, setGpuResource] = useState('nvidia.com/gpu');
  const [gpuCount, setGpuCount] = useState(1);
  const [cpu, setCpu] = useState('8');
  const [memory, setMemory] = useState('32Gi');

  const load = useCallback(async () => {
    setError(null);
    const [reservations, ns, gpus] = await Promise.all([api.reservations(), api.namespaces(), api.gpuResources()]);
    setItems(reservations.items);
    setNamespaces(ns.items);
    setGpuResources(gpus.items);
    if (ns.items.length && !ns.items.some((item) => item.name === namespace)) {
      setNamespace(ns.items[0].name);
    }
  }, [namespace]);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const managed = useMemo(() => items.filter((item) => item.managed || item.name?.startsWith('gpuvm-')), [items]);

  const onCreate = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await api.createReservation({
        namespace,
        gpu_resource: gpuResource,
        gpu_count: gpuCount,
        cpu,
        memory
      });
      setIsModalOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (name: string) => {
    setError(null);
    try {
      await api.deleteReservation(name);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Reservas de GPU</Title>
        <p>Cada reserva cria um ClusterQueue Kueue e a LocalQueue gpu-reserved no namespace escolhido.</p>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Erro nas reservas" isInline>
            {error}
          </Alert>
        )}
        <Toolbar id="reservations-toolbar">
          <ToolbarContent>
            <ToolbarItem>
              <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                Criar reserva
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
        {isLoading ? (
          <Spinner aria-label="Carregando reservas" />
        ) : managed.length === 0 ? (
          <EmptyState titleText="Nenhuma reserva de GPU" headingLevel="h2" icon={CubesIcon}>
            <EmptyStateBody>
              Crie uma reserva para garantir cotas nvidia.com/gpu (ou MIG) antes de ligar as VMs.
            </EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                  Criar reserva
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        ) : (
          <Table aria-label="Reservas de GPU">
            <Thead>
              <Tr>
                <Th>ClusterQueue</Th>
                <Th>Namespace</Th>
                <Th>GPUs reservadas</Th>
                <Th>Em uso</Th>
                <Th>Workloads</Th>
                <Th>Estado</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {managed.map((row) => (
                <Tr key={row.name}>
                  <Td dataLabel="ClusterQueue">{row.name}</Td>
                  <Td dataLabel="Namespace">{row.namespace || '—'}</Td>
                  <Td dataLabel="GPUs reservadas">{gpuSummary(row.gpuQuota)}</Td>
                  <Td dataLabel="Em uso">{gpuSummary(row.usage)}</Td>
                  <Td dataLabel="Workloads">
                    {row.admittedWorkloads} admitido(s), {row.pendingWorkloads} pendente(s)
                  </Td>
                  <Td dataLabel="Estado">
                    {row.active ? <Label color="green">Ativa</Label> : <Label color="orange">Inativa</Label>}
                  </Td>
                  <Td isActionCell>
                    <ActionsColumn
                      items={[
                        {
                          title: 'Excluir reserva',
                          onClick: () => onDelete(row.name)
                        }
                      ]}
                    />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        aria-labelledby="create-reservation-title"
        variant="medium"
      >
        <ModalHeader title="Criar reserva de GPU" labelId="create-reservation-title" />
        <ModalBody>
          <Form id="create-reservation-form">
            <FormGroup label="Namespace" isRequired fieldId="reservation-namespace">
              <FormSelect
                id="reservation-namespace"
                value={namespace}
                onChange={(_event, value) => setNamespace(value)}
                aria-label="Namespace da reserva"
              >
                {namespaces.map((item) => (
                  <FormSelectOption key={item.name} value={item.name} label={item.displayName} />
                ))}
              </FormSelect>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>O namespace será rotulado como gerenciado pelo Kueue.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Recurso de GPU" isRequired fieldId="reservation-gpu-resource">
              <FormSelect
                id="reservation-gpu-resource"
                value={gpuResource}
                onChange={(_event, value) => setGpuResource(value)}
                aria-label="Recurso de GPU"
              >
                {(gpuResources.length ? gpuResources : [{ name: 'nvidia.com/gpu', allocatable: 0 }]).map((item) => (
                  <FormSelectOption
                    key={item.name}
                    value={item.name}
                    label={`${item.name} (${item.allocatable} alocáveis)`}
                  />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="Quantidade" isRequired fieldId="reservation-gpu-count">
              <NumberInput
                id="reservation-gpu-count"
                value={gpuCount}
                min={0}
                max={64}
                onMinus={() => setGpuCount((value) => Math.max(0, value - 1))}
                onPlus={() => setGpuCount((value) => Math.min(64, value + 1))}
                onChange={(event) => {
                  const next = Number((event.target as HTMLInputElement).value);
                  if (!Number.isNaN(next)) {
                    setGpuCount(next);
                  }
                }}
                inputAriaLabel="Quantidade de GPUs"
                minusBtnAriaLabel="Diminuir GPUs"
                plusBtnAriaLabel="Aumentar GPUs"
              />
            </FormGroup>
            <FormGroup label="CPU da fila" fieldId="reservation-cpu">
              <FormSelect id="reservation-cpu" value={cpu} onChange={(_event, value) => setCpu(value)} aria-label="CPU">
                {['4', '8', '16', '32'].map((value) => (
                  <FormSelectOption key={value} value={value} label={value} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="Memória da fila" fieldId="reservation-memory">
              <FormSelect
                id="reservation-memory"
                value={memory}
                onChange={(_event, value) => setMemory(value)}
                aria-label="Memória"
              >
                {['16Gi', '32Gi', '64Gi', '128Gi'].map((value) => (
                  <FormSelectOption key={value} value={value} label={value} />
                ))}
              </FormSelect>
            </FormGroup>
            <ActionGroup>
              <Button variant="primary" onClick={onCreate} isDisabled={isSaving} isLoading={isSaving}>
                Reservar
              </Button>
              <Button variant="link" onClick={() => setIsModalOpen(false)} isDisabled={isSaving}>
                Cancelar
              </Button>
            </ActionGroup>
          </Form>
        </ModalBody>
        <ModalFooter />
      </Modal>
    </>
  );
};
