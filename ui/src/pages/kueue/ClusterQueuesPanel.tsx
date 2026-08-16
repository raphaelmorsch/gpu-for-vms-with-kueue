import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionGroup,
  Alert,
  Button,
  EmptyState,
  EmptyStateBody,
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
  Spinner,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../../api';
import type { CatalogResource, ClusterQueueItem, QuotaRow } from '../../types';

const KUBEVIRT_RESOURCES = [
  'cpu',
  'memory',
  'ephemeral-storage',
  'devices.kubevirt.io/kvm',
  'devices.kubevirt.io/tun',
  'devices.kubevirt.io/vhost-net'
];

const GPU_RESOURCES = [
  'nvidia.com/gpu',
  'nvidia.com/mig-1g.23gb',
  'nvidia.com/mig-2g.47gb',
  'nvidia.com/mig-3g.93gb',
  'nvidia.com/mig-7g.189gb'
];

const defaultQuota = (catalog: CatalogResource[], name: string) =>
  catalog.find((item) => item.name === name)?.defaultQuota || '0';

const gpuVmPreset = (catalog: CatalogResource[], flavors: string[]): QuotaRow[] => {
  const vmFlavor = flavors.includes('vm-flavor') ? 'vm-flavor' : flavors[0] || 'vm-flavor';
  const gpuFlavor = flavors.includes('gpu-pool') ? 'gpu-pool' : flavors[0] || 'gpu-pool';
  return [
    ...KUBEVIRT_RESOURCES.map((name) => ({
      name,
      flavor: vmFlavor,
      nominalQuota: defaultQuota(catalog, name) || (name === 'memory' ? '128Gi' : name === 'cpu' ? '32' : '1000')
    })),
    ...GPU_RESOURCES.map((name) => ({
      name,
      flavor: gpuFlavor,
      nominalQuota: defaultQuota(catalog, name)
    }))
  ];
};

const quotaSummary = (quota: Record<string, string>) =>
  Object.entries(quota)
    .filter(([, value]) => value && value !== '0')
    .map(([key, value]) => `${key}=${value}`)
    .join(', ') || '—';

export const ClusterQueuesPanel: React.FunctionComponent = () => {
  const [items, setItems] = useState<ClusterQueueItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogResource[]>([]);
  const [flavorNames, setFlavorNames] = useState<string[]>(['vm-flavor', 'gpu-pool']);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ClusterQueueItem | null>(null);
  const [name, setName] = useState('team-queue');
  const [cohortName, setCohortName] = useState('');
  const [queueingStrategy, setQueueingStrategy] = useState('BestEffortFIFO');
  const [selectorMode, setSelectorMode] = useState('managed');
  const [namespaces, setNamespaces] = useState('');
  const [stopPolicy, setStopPolicy] = useState('None');
  const [reclaimWithinCohort, setReclaimWithinCohort] = useState('Never');
  const [withinClusterQueue, setWithinClusterQueue] = useState('Never');
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [customResource, setCustomResource] = useState('');

  const load = useCallback(async () => {
    const [queues, cat] = await Promise.all([api.clusterQueues(), api.kueueCatalog()]);
    setItems(queues.items);
    setCatalog(cat.items);
    const names = cat.flavors.map((item) => item.name).filter(Boolean);
    setFlavorNames(names.length ? names : ['vm-flavor', 'gpu-pool']);
  }, []);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const resources = useMemo(() => {
    const names = new Set(catalog.map((item) => item.name));
    quotas.forEach((row) => names.add(row.name));
    return Array.from(names).sort();
  }, [catalog, quotas]);

  const openCreate = () => {
    setEditing(null);
    setName('team-queue');
    setCohortName('');
    setQueueingStrategy('BestEffortFIFO');
    setSelectorMode('managed');
    setNamespaces('');
    setStopPolicy('None');
    setReclaimWithinCohort('Never');
    setWithinClusterQueue('Never');
    setQuotas(gpuVmPreset(catalog, flavorNames));
    setIsOpen(true);
  };

  const openEdit = (item: ClusterQueueItem) => {
    setEditing(item);
    setName(item.name);
    setCohortName(item.cohort || '');
    setQueueingStrategy(item.queueingStrategy);
    setSelectorMode(item.selector.mode || 'managed');
    setNamespaces((item.selector.namespaces || []).join(', '));
    setStopPolicy(item.stopPolicy || 'None');
    const preemption = item.preemption as { reclaimWithinCohort?: string; withinClusterQueue?: string };
    setReclaimWithinCohort(preemption.reclaimWithinCohort || 'Never');
    setWithinClusterQueue(preemption.withinClusterQueue || 'Never');
    setQuotas(item.quotas.length ? item.quotas : gpuVmPreset(catalog, flavorNames));
    setIsOpen(true);
  };

  const updateRow = (index: number, patch: Partial<QuotaRow>) => {
    setQuotas((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addResource = (resourceName: string) => {
    const flavor = flavorNames.includes('gpu-pool') && resourceName.includes('gpu') ? 'gpu-pool' : flavorNames[0];
    setQuotas((rows) => [
      ...rows,
      { name: resourceName, flavor, nominalQuota: defaultQuota(catalog, resourceName) }
    ]);
  };

  const payload = () => ({
    name,
    cohortName: cohortName.trim() || null,
    queueingStrategy,
    namespaceSelectorMode: selectorMode,
    namespaces: namespaces
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    stopPolicy,
    reclaimWithinCohort,
    withinClusterQueue,
    quotas: quotas.filter((row) => row.name && row.flavor)
  });

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.updateClusterQueue(editing.name, payload());
      } else {
        await api.createClusterQueue(payload());
      }
      setIsOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (item: ClusterQueueItem) => {
    setError(null);
    try {
      await api.deleteClusterQueue(item.name);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onStop = async (item: ClusterQueueItem, next: string) => {
    setError(null);
    try {
      await api.setClusterQueueStopPolicy(item.name, next);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <p>
        A ClusterQueue define a cota do cluster: CPU, memória, disco, GPUs, dispositivos KubeVirt e qualquer recurso
        que o Kueue consiga gerir. Use o modelo GPU + VM para cobrir virt-launcher.
      </p>
      {error && (
        <Alert variant="danger" title="Erro nas ClusterQueues" isInline>
          {error}
        </Alert>
      )}
      <Toolbar id="clusterqueue-toolbar">
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={openCreate}>
              Criar ClusterQueue
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isLoading ? (
        <Spinner aria-label="Carregando ClusterQueues" />
      ) : items.length === 0 ? (
        <EmptyState titleText="Nenhuma ClusterQueue" headingLevel="h2" icon={CubesIcon}>
          <EmptyStateBody>Crie uma ClusterQueue para publicar cotas no Kueue.</EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="ClusterQueues">
          <Thead>
            <Tr>
              <Th>Nome</Th>
              <Th>Cohort</Th>
              <Th>Estratégia</Th>
              <Th>Recursos</Th>
              <Th>Workloads</Th>
              <Th>Estado</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={item.name}>
                <Td dataLabel="Nome">
                  {item.name} {item.protected ? <Label color="orange">protegida</Label> : null}
                </Td>
                <Td dataLabel="Cohort">{item.cohort || '—'}</Td>
                <Td dataLabel="Estratégia">{item.queueingStrategy}</Td>
                <Td dataLabel="Recursos">{quotaSummary(item.quota)}</Td>
                <Td dataLabel="Workloads">
                  {item.admittedWorkloads} admitido(s), {item.pendingWorkloads} pendente(s)
                </Td>
                <Td dataLabel="Estado">
                  {item.stopPolicy !== 'None' ? (
                    <Label color="orange">{item.stopPolicy}</Label>
                  ) : item.active ? (
                    <Label color="green">Ativa</Label>
                  ) : (
                    <Label color="grey">Inativa</Label>
                  )}
                </Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      { title: 'Editar', onClick: () => openEdit(item) },
                      {
                        title: item.stopPolicy === 'None' ? 'Hold (pausar admissão)' : 'Retomar admissão',
                        onClick: () => onStop(item, item.stopPolicy === 'None' ? 'Hold' : 'None')
                      },
                      { title: 'Hold and drain', onClick: () => onStop(item, 'HoldAndDrain') },
                      { isSeparator: true },
                      {
                        title: 'Excluir',
                        isDisabled: item.protected,
                        onClick: () => onDelete(item)
                      }
                    ]}
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} variant="large" aria-labelledby="cq-title">
        <ModalHeader title={editing ? `Editar ClusterQueue ${editing.name}` : 'Criar ClusterQueue'} labelId="cq-title" />
        <ModalBody>
          {editing?.protected && (
            <Alert variant="warning" title="ClusterQueue default" isInline>
              Alterações aqui afectam a fila partilhada do cluster.
            </Alert>
          )}
          <Form>
            <FormGroup label="Nome" isRequired fieldId="cq-name">
              <TextInput id="cq-name" value={name} isDisabled={Boolean(editing)} onChange={(_e, value) => setName(value)} />
            </FormGroup>
            <FormGroup label="Cohort" fieldId="cq-cohort">
              <TextInput
                id="cq-cohort"
                value={cohortName}
                onChange={(_e, value) => setCohortName(value)}
                placeholder="unreserved"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>Filas no mesmo cohort podem emprestar cota entre si.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Estratégia de fila" fieldId="cq-strategy">
              <FormSelect
                id="cq-strategy"
                value={queueingStrategy}
                onChange={(_e, value) => setQueueingStrategy(value)}
                aria-label="Estratégia"
              >
                <FormSelectOption value="BestEffortFIFO" label="BestEffortFIFO" />
                <FormSelectOption value="StrictFIFO" label="StrictFIFO" />
              </FormSelect>
            </FormGroup>
            <FormGroup label="Namespaces admitidos" fieldId="cq-selector">
              <FormSelect
                id="cq-selector"
                value={selectorMode}
                onChange={(_e, value) => setSelectorMode(value)}
                aria-label="Selector de namespaces"
              >
                <FormSelectOption value="managed" label="Namespaces geridos pelo Kueue" />
                <FormSelectOption value="all" label="Todos os namespaces" />
                <FormSelectOption value="namespaces" label="Lista explícita" />
              </FormSelect>
            </FormGroup>
            {selectorMode === 'namespaces' && (
              <FormGroup label="Namespaces" fieldId="cq-namespaces">
                <TextInput
                  id="cq-namespaces"
                  value={namespaces}
                  onChange={(_e, value) => setNamespaces(value)}
                  placeholder="gpu-vms, user-user1"
                />
              </FormGroup>
            )}
            <FormGroup label="Stop policy" fieldId="cq-stop">
              <FormSelect id="cq-stop" value={stopPolicy} onChange={(_e, value) => setStopPolicy(value)} aria-label="Stop policy">
                <FormSelectOption value="None" label="None (admitir normalmente)" />
                <FormSelectOption value="Hold" label="Hold (pausar novas admissões)" />
                <FormSelectOption value="HoldAndDrain" label="HoldAndDrain" />
              </FormSelect>
            </FormGroup>
            <FormGroup label="Preempção no cohort" fieldId="cq-reclaim">
              <FormSelect
                id="cq-reclaim"
                value={reclaimWithinCohort}
                onChange={(_e, value) => setReclaimWithinCohort(value)}
                aria-label="Preempção no cohort"
              >
                <FormSelectOption value="Never" label="Never" />
                <FormSelectOption value="LowerPriority" label="LowerPriority" />
                <FormSelectOption value="Any" label="Any" />
              </FormSelect>
            </FormGroup>
            <FormGroup label="Preempção na ClusterQueue" fieldId="cq-within">
              <FormSelect
                id="cq-within"
                value={withinClusterQueue}
                onChange={(_e, value) => setWithinClusterQueue(value)}
                aria-label="Preempção na ClusterQueue"
              >
                <FormSelectOption value="Never" label="Never" />
                <FormSelectOption value="LowerPriority" label="LowerPriority" />
                <FormSelectOption value="LowerOrNewerEqualPriority" label="LowerOrNewerEqualPriority" />
              </FormSelect>
            </FormGroup>
            <Title headingLevel="h2" size="lg">
              Cotas por recurso
            </Title>
            <ActionGroup>
              <Button variant="secondary" onClick={() => setQuotas(gpuVmPreset(catalog, flavorNames))}>
                Modelo GPU + KubeVirt
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const missing = KUBEVIRT_RESOURCES.filter((res) => !quotas.some((row) => row.name === res));
                  const flavor = flavorNames.includes('vm-flavor') ? 'vm-flavor' : flavorNames[0];
                  setQuotas((rows) => [
                    ...rows,
                    ...missing.map((res) => ({ name: res, flavor, nominalQuota: defaultQuota(catalog, res) }))
                  ]);
                }}
              >
                Acrescentar dispositivos KubeVirt
              </Button>
            </ActionGroup>
            <Table aria-label="Cotas da ClusterQueue" variant="compact">
              <Thead>
                <Tr>
                  <Th>Recurso</Th>
                  <Th>ResourceFlavor</Th>
                  <Th>Cota nominal</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {quotas.map((row, index) => (
                  <Tr key={`${row.name}-${index}`}>
                    <Td dataLabel="Recurso">
                      <FormSelect
                        value={row.name}
                        onChange={(_e, value) => updateRow(index, { name: value })}
                        aria-label={`Recurso ${index}`}
                      >
                        {resources.map((item) => (
                          <FormSelectOption key={item} value={item} label={item} />
                        ))}
                      </FormSelect>
                    </Td>
                    <Td dataLabel="ResourceFlavor">
                      <FormSelect
                        value={row.flavor}
                        onChange={(_e, value) => updateRow(index, { flavor: value })}
                        aria-label={`Flavor ${index}`}
                      >
                        {flavorNames.map((item) => (
                          <FormSelectOption key={item} value={item} label={item} />
                        ))}
                      </FormSelect>
                    </Td>
                    <Td dataLabel="Cota nominal">
                      <TextInput
                        value={row.nominalQuota}
                        onChange={(_e, value) => updateRow(index, { nominalQuota: value })}
                        aria-label={`Cota ${index}`}
                      />
                    </Td>
                    <Td>
                      <Button variant="link" isDanger onClick={() => setQuotas((rows) => rows.filter((_, i) => i !== index))}>
                        Remover
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
            <FormGroup label="Recurso personalizado" fieldId="cq-custom">
              <TextInput
                id="cq-custom"
                value={customResource}
                onChange={(_e, value) => setCustomResource(value)}
                placeholder="exemplo: example.com/device"
              />
            </FormGroup>
            <ActionGroup>
              <Button
                variant="secondary"
                onClick={() => {
                  if (customResource.trim()) {
                    addResource(customResource.trim());
                    setCustomResource('');
                  }
                }}
              >
                Adicionar recurso
              </Button>
              <Button
                variant="secondary"
                onClick={() => addResource(catalog.find((item) => !quotas.some((row) => row.name === item.name))?.name || 'cpu')}
              >
                Adicionar linha
              </Button>
            </ActionGroup>
            <ActionGroup>
              <Button variant="primary" onClick={onSave} isDisabled={isSaving || !name || quotas.length === 0} isLoading={isSaving}>
                Guardar ClusterQueue
              </Button>
              <Button variant="link" onClick={() => setIsOpen(false)} isDisabled={isSaving}>
                Cancelar
              </Button>
            </ActionGroup>
          </Form>
        </ModalBody>
      </Modal>
    </>
  );
};
