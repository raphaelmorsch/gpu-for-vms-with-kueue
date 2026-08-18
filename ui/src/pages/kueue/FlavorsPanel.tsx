import { useCallback, useEffect, useState } from 'react';
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
import type { ResourceFlavorItem, TopologyItem } from '../../types';

const parseLabels = (value: string): Record<string, string> => {
  const labels: Record<string, string> = {};
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx > 0) {
        labels[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
      }
    });
  return labels;
};

const formatLabels = (labels: Record<string, string>) =>
  Object.entries(labels)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');

export const FlavorsPanel: React.FunctionComponent = () => {
  const [items, setItems] = useState<ResourceFlavorItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<ResourceFlavorItem | null>(null);
  const [name, setName] = useState('');
  const [labels, setLabels] = useState('');
  const [topologyName, setTopologyName] = useState('');
  const [topologies, setTopologies] = useState<TopologyItem[]>([]);

  const load = useCallback(async () => {
    const [flavors, topology] = await Promise.all([api.flavors(), api.topologies()]);
    setItems(flavors.items);
    setTopologies(topology.items);
  }, []);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName('gpu-pool');
    setLabels('run.ai/simulated-gpu-node-pool=default');
    setTopologyName('');
    setIsOpen(true);
  };

  const openEdit = (item: ResourceFlavorItem) => {
    setEditing(item);
    setName(item.name);
    setLabels(formatLabels(item.nodeLabels));
    setTopologyName(item.topologyName || '');
    setIsOpen(true);
  };

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    const body = { name, nodeLabels: parseLabels(labels), topologyName: topologyName || null };
    try {
      if (editing) {
        await api.updateFlavor(editing.name, body);
      } else {
        await api.createFlavor(body);
      }
      setIsOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (item: ResourceFlavorItem) => {
    setError(null);
    try {
      await api.deleteFlavor(item.name);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <p>
        ResourceFlavors descrevem pools de nodes. As ClusterQueues referenciam flavors para ligar cotas a rótulos
        como GPU fake, SO Linux ou topologia.
      </p>
      {error && (
        <Alert variant="danger" title="Erro nos ResourceFlavors" isInline>
          {error}
        </Alert>
      )}
      <Toolbar id="flavor-toolbar">
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={openCreate}>
              Criar ResourceFlavor
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isLoading ? (
        <Spinner aria-label="Carregando ResourceFlavors" />
      ) : items.length === 0 ? (
        <EmptyState titleText="Nenhum ResourceFlavor" headingLevel="h2" icon={CubesIcon}>
          <EmptyStateBody>Crie um flavor antes de referenciá-lo numa ClusterQueue.</EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="ResourceFlavors">
          <Thead>
            <Tr>
              <Th>Nome</Th>
              <Th>Node labels</Th>
              <Th>Topologia</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={item.name}>
                <Td dataLabel="Nome">{item.name}</Td>
                <Td dataLabel="Node labels">{formatLabels(item.nodeLabels) || '—'}</Td>
                <Td dataLabel="Topologia">{item.topologyName || '—'}</Td>
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
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} variant="medium" aria-labelledby="flavor-title">
        <ModalHeader title={editing ? 'Editar ResourceFlavor' : 'Criar ResourceFlavor'} labelId="flavor-title" />
        <ModalBody>
          <Form>
            <FormGroup label="Nome" isRequired fieldId="flavor-name">
              <TextInput
                id="flavor-name"
                value={name}
                isDisabled={Boolean(editing)}
                onChange={(_e, value) => setName(value)}
              />
            </FormGroup>
            <FormGroup label="Node labels" fieldId="flavor-labels">
              <TextInput
                id="flavor-labels"
                value={labels}
                isDisabled={Boolean(editing?.topologyName)}
                onChange={(_e, value) => setLabels(value)}
                placeholder="kubernetes.io/os=linux, run.ai/simulated-gpu-node-pool=default"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {editing?.topologyName
                      ? 'Node labels e topologyName são imutáveis neste flavor porque o TAS já está activo.'
                      : 'Lista chave=valor separada por vírgulas. Obrigatória se ligar uma Topology.'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Topology (TAS)" fieldId="flavor-topology">
              <FormSelect
                id="flavor-topology"
                value={topologyName}
                isDisabled={Boolean(editing?.topologyName)}
                onChange={(_event, next) => setTopologyName(next)}
                aria-label="Topology do ResourceFlavor"
              >
                <FormSelectOption value="" label="Sem TAS" />
                {topologies.map((item) => (
                  <FormSelectOption key={item.name} value={item.name} label={`${item.name} (${item.levels.join(' → ')})`} />
                ))}
              </FormSelect>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Depois de gravar topologyName, o spec deste ResourceFlavor deixa de poder ser alterado.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
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
