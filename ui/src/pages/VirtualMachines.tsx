import { useCallback, useEffect, useState } from 'react';
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
  ModalHeader,
  NumberInput,
  PageSection,
  Spinner,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../api';
import type { GpuResource, LocalQueue, NamespaceItem, VirtualMachine } from '../types';

const statusColor = (status: string): 'green' | 'orange' | 'red' | 'blue' | 'grey' => {
  if (status === 'Running') {
    return 'green';
  }
  if (status === 'Stopped' || status === 'Halted') {
    return 'grey';
  }
  if (status.toLowerCase().includes('error') || status === 'CrashLoopBackOff') {
    return 'red';
  }
  if (status === 'Starting' || status === 'Provisioning' || status === 'WaitingForVolumeBinding') {
    return 'orange';
  }
  return 'blue';
};

const gpuCell = (gpus: Record<string, string>) =>
  Object.entries(gpus)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || '—';

export const VirtualMachines: React.FunctionComponent = () => {
  const [items, setItems] = useState<VirtualMachine[]>([]);
  const [namespaces, setNamespaces] = useState<NamespaceItem[]>([]);
  const [queues, setQueues] = useState<LocalQueue[]>([]);
  const [gpuResources, setGpuResources] = useState<GpuResource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [namespace, setNamespace] = useState('gpu-vms');
  const [name, setName] = useState('fedora-gpu');
  const [queue, setQueue] = useState('gpu-reserved');
  const [gpuResource, setGpuResource] = useState('nvidia.com/gpu');
  const [gpuCount, setGpuCount] = useState(1);
  const [cpu, setCpu] = useState('1');
  const [memory, setMemory] = useState('2Gi');

  const load = useCallback(async () => {
    const [vms, ns, gpus, localQueues] = await Promise.all([
      api.vms(),
      api.namespaces(),
      api.gpuResources(),
      api.localQueues(namespace)
    ]);
    setItems(vms.items);
    setNamespaces(ns.items);
    setGpuResources(gpus.items);
    setQueues(localQueues.items);
    if (localQueues.items.length && !localQueues.items.some((item) => item.name === queue)) {
      setQueue(localQueues.items[0].name);
    }
  }, [namespace, queue]);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const onCreate = async () => {
    setIsSaving(true);
    setError(null);
    setInfo(null);
    try {
      const created = await api.createVm({
        namespace,
        name,
        queue,
        gpu_resource: gpuResource,
        gpu_count: gpuCount,
        cpu,
        memory,
        run_strategy: 'Always'
      });
      setIsModalOpen(false);
      setInfo(
        `VM ${created.item.name} criada. Login fedora / ${created.item.password}. GPU em requests e limits: ${gpuResource}=${gpuCount}. Fila Kueue: ${queue}.`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const runAction = async (vm: VirtualMachine, action: string) => {
    setError(null);
    try {
      if (action === 'delete') {
        await api.deleteVm(vm.namespace, vm.name);
      } else {
        await api.vmAction(vm.namespace, vm.name, action);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <PageSection>
        <Title headingLevel="h1">Máquinas virtuais com GPU</Title>
        <p>
          As VMs pedem GPU em <strong>requests</strong> e <strong>limits</strong>. O pod virt-launcher só inicia depois
          que o Kueue admite a cota.
        </p>
      </PageSection>
      <PageSection>
        {error && (
          <Alert variant="danger" title="Erro nas máquinas virtuais" isInline>
            {error}
          </Alert>
        )}
        {info && (
          <Alert variant="success" title="VM criada" isInline>
            {info}
          </Alert>
        )}
        <Toolbar id="vms-toolbar">
          <ToolbarContent>
            <ToolbarItem>
              <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                Criar VM com GPU
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
        {isLoading ? (
          <Spinner aria-label="Carregando VMs" />
        ) : items.length === 0 ? (
          <EmptyState titleText="Nenhuma máquina virtual" headingLevel="h2" icon={CubesIcon}>
            <EmptyStateBody>Crie uma VM Fedora com GPU em requests e limits e uma fila Kueue.</EmptyStateBody>
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={() => setIsModalOpen(true)}>
                  Criar VM com GPU
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          </EmptyState>
        ) : (
          <Table aria-label="Máquinas virtuais">
            <Thead>
              <Tr>
                <Th>Nome</Th>
                <Th>Namespace</Th>
                <Th>Estado</Th>
                <Th>Fila Kueue</Th>
                <Th>GPU (requests/limits)</Th>
                <Th>Estratégia</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {items.map((vm) => (
                <Tr key={`${vm.namespace}/${vm.name}`}>
                  <Td dataLabel="Nome">{vm.name}</Td>
                  <Td dataLabel="Namespace">{vm.namespace}</Td>
                  <Td dataLabel="Estado">
                    <Label color={statusColor(vm.status)}>{vm.status}</Label>
                  </Td>
                  <Td dataLabel="Fila Kueue">{vm.queue || '—'}</Td>
                  <Td dataLabel="GPU (requests/limits)">{gpuCell(vm.gpus)}</Td>
                  <Td dataLabel="Estratégia">{vm.runStrategy}</Td>
                  <Td isActionCell>
                    <ActionsColumn
                      items={[
                        { title: 'Iniciar', onClick: () => runAction(vm, 'start') },
                        { title: 'Parar', onClick: () => runAction(vm, 'stop') },
                        { title: 'Reiniciar', onClick: () => runAction(vm, 'restart') },
                        { isSeparator: true },
                        { title: 'Excluir', onClick: () => runAction(vm, 'delete') }
                      ]}
                    />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </PageSection>
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} variant="medium" aria-labelledby="create-vm-title">
        <ModalHeader title="Criar VM com GPU" labelId="create-vm-title" />
        <ModalBody>
          <Form>
            <FormGroup label="Nome" isRequired fieldId="vm-name">
              <TextInput id="vm-name" value={name} onChange={(_event, value) => setName(value)} isRequired />
            </FormGroup>
            <FormGroup label="Namespace" isRequired fieldId="vm-namespace">
              <FormSelect
                id="vm-namespace"
                value={namespace}
                onChange={(_event, value) => setNamespace(value)}
                aria-label="Namespace da VM"
              >
                {namespaces.map((item) => (
                  <FormSelectOption key={item.name} value={item.name} label={item.displayName} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="LocalQueue Kueue" isRequired fieldId="vm-queue">
              <FormSelect id="vm-queue" value={queue} onChange={(_event, value) => setQueue(value)} aria-label="Fila">
                {(queues.length ? queues : [{ name: 'default', namespace, clusterQueue: 'default', pendingWorkloads: 0, admittedWorkloads: 0 }]).map(
                  (item) => (
                    <FormSelectOption
                      key={item.name}
                      value={item.name}
                      label={`${item.name} → ${item.clusterQueue}`}
                    />
                  )
                )}
              </FormSelect>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>Use gpu-reserved para consumir a cota da reserva, ou default para a fila compartilhada.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Recurso de GPU" isRequired fieldId="vm-gpu-resource">
              <FormSelect
                id="vm-gpu-resource"
                value={gpuResource}
                onChange={(_event, value) => setGpuResource(value)}
                aria-label="Recurso de GPU da VM"
              >
                {(gpuResources.length ? gpuResources : [{ name: 'nvidia.com/gpu', allocatable: 0 }]).map((item) => (
                  <FormSelectOption key={item.name} value={item.name} label={item.name} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="GPUs em requests e limits" isRequired fieldId="vm-gpu-count">
              <NumberInput
                id="vm-gpu-count"
                value={gpuCount}
                min={1}
                max={8}
                onMinus={() => setGpuCount((value) => Math.max(1, value - 1))}
                onPlus={() => setGpuCount((value) => Math.min(8, value + 1))}
                onChange={(event) => {
                  const next = Number((event.target as HTMLInputElement).value);
                  if (!Number.isNaN(next)) {
                    setGpuCount(next);
                  }
                }}
                inputAriaLabel="Quantidade de GPUs da VM"
                minusBtnAriaLabel="Diminuir GPUs da VM"
                plusBtnAriaLabel="Aumentar GPUs da VM"
              />
            </FormGroup>
            <FormGroup label="CPU" fieldId="vm-cpu">
              <FormSelect id="vm-cpu" value={cpu} onChange={(_event, value) => setCpu(value)} aria-label="CPU da VM">
                {['1', '2', '4'].map((value) => (
                  <FormSelectOption key={value} value={value} label={value} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="Memória" fieldId="vm-memory">
              <FormSelect id="vm-memory" value={memory} onChange={(_event, value) => setMemory(value)} aria-label="Memória da VM">
                {['2Gi', '4Gi', '8Gi'].map((value) => (
                  <FormSelectOption key={value} value={value} label={value} />
                ))}
              </FormSelect>
            </FormGroup>
            <ActionGroup>
              <Button variant="primary" onClick={onCreate} isDisabled={isSaving || !name} isLoading={isSaving}>
                Criar VM
              </Button>
              <Button variant="link" onClick={() => setIsModalOpen(false)} isDisabled={isSaving}>
                Cancelar
              </Button>
            </ActionGroup>
          </Form>
        </ModalBody>
      </Modal>
    </>
  );
};
