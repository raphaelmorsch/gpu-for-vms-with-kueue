import { useCallback, useEffect, useState } from 'react';
import {
  ActionGroup,
  Alert,
  Button,
  Checkbox,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  Modal,
  ModalBody,
  ModalHeader,
  Spinner,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../../api';
import type { AdminLocalQueue, ClusterQueueItem } from '../../types';

export const LocalQueuesPanel: React.FunctionComponent = () => {
  const [items, setItems] = useState<AdminLocalQueue[]>([]);
  const [clusterQueues, setClusterQueues] = useState<ClusterQueueItem[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<AdminLocalQueue | null>(null);
  const [name, setName] = useState('team-queue');
  const [namespace, setNamespace] = useState('gpu-vms');
  const [clusterQueue, setClusterQueue] = useState('default');
  const [defaultQueue, setDefaultQueue] = useState(false);

  const load = useCallback(async () => {
    const [queues, cqs, ns] = await Promise.all([api.adminLocalQueues(), api.clusterQueues(), api.kueueNamespaces()]);
    setItems(queues.items);
    setClusterQueues(cqs.items);
    const managed = ns.items.filter((item) => item.managed).map((item) => item.name);
    setNamespaces(managed.length ? managed : ns.items.filter((item) => !item.system).map((item) => item.name));
  }, []);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName('team-queue');
    setNamespace(namespaces[0] || 'gpu-vms');
    setClusterQueue(clusterQueues[0]?.name || 'default');
    setDefaultQueue(false);
    setIsOpen(true);
  };

  const openEdit = (item: AdminLocalQueue) => {
    setEditing(item);
    setName(item.name);
    setNamespace(item.namespace);
    setClusterQueue(item.clusterQueue);
    setDefaultQueue(item.defaultQueue);
    setIsOpen(true);
  };

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    const body = { name, namespace, clusterQueue, defaultQueue };
    try {
      if (editing) {
        await api.updateLocalQueue(editing.namespace, editing.name, body);
      } else {
        await api.createLocalQueue(body);
      }
      setIsOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (item: AdminLocalQueue) => {
    setError(null);
    try {
      await api.deleteLocalQueue(item.namespace, item.name);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <p>
        Uma LocalQueue é o ponto de entrada no namespace. Os workloads usam o rótulo{' '}
        <code>kueue.x-k8s.io/queue-name</code> para escolher a fila. A fila default recebe jobs sem esse rótulo.
      </p>
      {error && (
        <Alert variant="danger" title="Erro nas LocalQueues" isInline>
          {error}
        </Alert>
      )}
      <Toolbar id="localqueue-toolbar">
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={openCreate}>
              Criar LocalQueue
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isLoading ? (
        <Spinner aria-label="Carregando LocalQueues" />
      ) : items.length === 0 ? (
        <EmptyState titleText="Nenhuma LocalQueue" headingLevel="h2" icon={CubesIcon}>
          <EmptyStateBody>Crie uma LocalQueue num namespace gerido pelo Kueue.</EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="LocalQueues">
          <Thead>
            <Tr>
              <Th>Nome</Th>
              <Th>Namespace</Th>
              <Th>ClusterQueue</Th>
              <Th>Default</Th>
              <Th>Workloads</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={`${item.namespace}/${item.name}`}>
                <Td dataLabel="Nome">{item.name}</Td>
                <Td dataLabel="Namespace">{item.namespace}</Td>
                <Td dataLabel="ClusterQueue">{item.clusterQueue}</Td>
                <Td dataLabel="Default">
                  {item.defaultQueue ? <Label color="blue">Fila default</Label> : '—'}
                </Td>
                <Td dataLabel="Workloads">
                  {item.admittedWorkloads} admitido(s), {item.pendingWorkloads} pendente(s)
                </Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      { title: 'Editar', onClick: () => openEdit(item) },
                      { title: 'Excluir', onClick: () => onDelete(item) }
                    ]}
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} variant="medium" aria-labelledby="localqueue-title">
        <ModalHeader title={editing ? 'Editar LocalQueue' : 'Criar LocalQueue'} labelId="localqueue-title" />
        <ModalBody>
          <Form>
            <FormGroup label="Nome" isRequired fieldId="lq-name">
              <TextInput id="lq-name" value={name} isDisabled={Boolean(editing)} onChange={(_e, value) => setName(value)} />
            </FormGroup>
            <FormGroup label="Namespace" isRequired fieldId="lq-namespace">
              <FormSelect
                id="lq-namespace"
                value={namespace}
                isDisabled={Boolean(editing)}
                onChange={(_e, value) => setNamespace(value)}
                aria-label="Namespace da LocalQueue"
              >
                {(namespaces.includes(namespace) ? namespaces : [namespace, ...namespaces]).map((item) => (
                  <FormSelectOption key={item} value={item} label={item} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup label="ClusterQueue" isRequired fieldId="lq-cq">
              <FormSelect
                id="lq-cq"
                value={clusterQueue}
                onChange={(_e, value) => setClusterQueue(value)}
                aria-label="ClusterQueue da LocalQueue"
              >
                {clusterQueues.map((item) => (
                  <FormSelectOption key={item.name} value={item.name} label={item.name} />
                ))}
              </FormSelect>
            </FormGroup>
            <FormGroup fieldId="lq-default">
              <Checkbox
                id="lq-default"
                label="Fila default do namespace"
                isChecked={defaultQueue}
                onChange={(_e, checked) => setDefaultQueue(checked)}
              />
            </FormGroup>
            <ActionGroup>
              <Button variant="primary" onClick={onSave} isDisabled={isSaving || !name} isLoading={isSaving}>
                Guardar
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
