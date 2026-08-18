import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionGroup,
  Alert,
  Button,
  Checkbox,
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
  ToolbarItem,
  TreeView
} from '@patternfly/react-core';
import type { TreeViewDataItem } from '@patternfly/react-core';
import TopologyIcon from '@patternfly/react-icons/dist/esm/icons/topology-icon';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../../api';
import type { KueueNamespace, ResourceFlavorItem, TopologyItem, TopologyNode } from '../../types';

const treeItems = (nodes: TopologyNode[], prefix = ''): TreeViewDataItem[] =>
  nodes.map((node) => {
    const id = `${prefix}${node.label}=${node.value}`;
    const gpus = node.gpus ? ` · ${node.gpus} GPU` : '';
    const item: TreeViewDataItem = {
      id,
      name: `${node.value} (${node.nodes} node${node.nodes === 1 ? '' : 's'}${gpus})`,
      title: node.label
    };
    if (node.children?.length) {
      item.children = treeItems(node.children, `${id}/`);
    }
    return item;
  });

export const TopologyPanel: React.FunctionComponent = () => {
  const [items, setItems] = useState<TopologyItem[]>([]);
  const [flavors, setFlavors] = useState<ResourceFlavorItem[]>([]);
  const [namespaces, setNamespaces] = useState<KueueNamespace[]>([]);
  const [suggestedLevels, setSuggestedLevels] = useState<string[]>([
    'topology.kubernetes.io/zone',
    'kubernetes.io/hostname'
  ]);
  const [availableLabels, setAvailableLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [viewing, setViewing] = useState<TopologyItem | null>(null);
  const [name, setName] = useState('rack');
  const [levels, setLevels] = useState<string[]>(['topology.kubernetes.io/zone', 'kubernetes.io/hostname']);
  const [bindFlavor, setBindFlavor] = useState('');
  const [pendingNs, setPendingNs] = useState<string | null>(null);
  const [applyTasExisting, setApplyTasExisting] = useState(false);

  const load = useCallback(async () => {
    const [topologies, ns] = await Promise.all([api.topologies(), api.kueueNamespaces()]);
    setItems(topologies.items);
    setFlavors(topologies.flavors);
    setSuggestedLevels(topologies.suggestedLevels);
    setAvailableLabels(topologies.availableNodeLabels);
    setNamespaces(ns.items.filter((item) => item.managed && !item.system && !item.protected));
  }, []);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const labelOptions = useMemo(() => {
    const extra = levels.filter((level) => level && !availableLabels.includes(level));
    return [...availableLabels, ...extra];
  }, [availableLabels, levels]);

  const topologyLevels = useMemo(() => Array.from(new Set(items.flatMap((item) => item.levels))), [items]);

  const openCreate = () => {
    setName('gpu-topology');
    setLevels(suggestedLevels.length ? suggestedLevels : ['kubernetes.io/hostname']);
    setBindFlavor('');
    setIsOpen(true);
  };

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    setInfo(null);
    try {
      const created = await api.createTopology({ name, levels: levels.filter(Boolean) });
      if (bindFlavor) {
        const flavor = flavors.find((item) => item.name === bindFlavor);
        await api.updateFlavor(bindFlavor, {
          name: bindFlavor,
          nodeLabels: flavor?.nodeLabels || {},
          topologyName: created.item.name
        });
      }
      setIsOpen(false);
      setInfo(
        bindFlavor
          ? `Topologia ${created.item.name} criada e ligada ao ResourceFlavor ${bindFlavor}.`
          : `Topologia ${created.item.name} criada. Ligue-a a um ResourceFlavor para activar TAS.`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (item: TopologyItem) => {
    setError(null);
    setInfo(null);
    try {
      await api.deleteTopology(item.name);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onBindFlavor = async (flavorName: string, topologyName: string) => {
    setError(null);
    setInfo(null);
    const flavor = flavors.find((item) => item.name === flavorName);
    try {
      await api.updateFlavor(flavorName, {
        name: flavorName,
        nodeLabels: flavor?.nodeLabels || {},
        topologyName
      });
      setInfo(`ResourceFlavor ${flavorName} passou a usar a topologia ${topologyName}. O spec fica imutável.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onNamespaceTas = async (item: KueueNamespace, mode: string, level: string) => {
    setError(null);
    setInfo(null);
    setPendingNs(item.name);
    const required = mode === 'required' ? level : null;
    const preferred = mode === 'preferred' ? level : null;
    try {
      await api.setNamespaceTas(item.name, { required, preferred, applyToExisting: applyTasExisting });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingNs(null);
    }
  };

  const unboundFlavors = flavors.filter((item) => !item.topologyName && Object.keys(item.nodeLabels || {}).length > 0);

  return (
    <>
      <p>
        Topology-Aware Scheduling (TAS) agrupa nodes pelos rótulos da CR Topology e admite pods no mesmo domínio
        (zona, rack, hostname). Ligue a Topology a um ResourceFlavor usado pelas ClusterQueues de GPU. Os níveis são
        imutáveis depois de criar o objecto.
      </p>
      {error && (
        <Alert variant="danger" title="Erro na topologia TAS" isInline>
          {error}
        </Alert>
      )}
      {info && (
        <Alert variant="success" title="Topologia actualizada" isInline>
          {info}
        </Alert>
      )}
      <Toolbar id="topology-toolbar">
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={openCreate}>
              Criar Topology
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isLoading ? (
        <Spinner aria-label="Carregando topologias" />
      ) : items.length === 0 ? (
        <EmptyState titleText="Nenhuma Topology" headingLevel="h2" icon={TopologyIcon}>
          <EmptyStateBody>
            Crie uma Topology (por exemplo zona + hostname) e ligue-a ao flavor gpu-pool para activar TAS nas VMs.
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="Topologies Kueue">
          <Thead>
            <Tr>
              <Th>Nome</Th>
              <Th>Níveis (largo → estreito)</Th>
              <Th>ResourceFlavors</Th>
              <Th>Uso</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={item.name}>
                <Td dataLabel="Nome">{item.name}</Td>
                <Td dataLabel="Níveis">{item.levels.join(' → ')}</Td>
                <Td dataLabel="ResourceFlavors">{item.flavors.join(', ') || '—'}</Td>
                <Td dataLabel="Uso">
                  {item.inUse ? <Label color="blue">Em uso</Label> : <Label color="grey">Livre</Label>}
                </Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      { title: 'Ver árvore', onClick: () => setViewing(item) },
                      ...unboundFlavors.map((flavor) => ({
                        title: `Ligar a ${flavor.name}`,
                        onClick: () => {
                          void onBindFlavor(flavor.name, item.name);
                        }
                      })),
                      { title: 'Excluir', onClick: () => onDelete(item) }
                    ]}
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {namespaces.length > 0 && (
        <>
          <Title headingLevel="h2">Pedido TAS por namespace</Title>
          <p>
            Opcional: anotar VMs e Jobs novos neste namespace para exigir ou preferir um nível da topologia (por
            exemplo o mesmo hostname). Sem este pedido, o Kueue ainda usa TAS se o ResourceFlavor tiver topologyName.
          </p>
          <Checkbox
            id="tas-apply-existing"
            label="Aplicar também às VMs e Jobs já existentes no namespace"
            isChecked={applyTasExisting}
            onChange={(_event, checked) => setApplyTasExisting(checked)}
            style={{ marginBottom: '1rem' }}
          />
          <Table aria-label="Pedido TAS por namespace">
            <Thead>
              <Tr>
                <Th>Namespace</Th>
                <Th>Modo</Th>
                <Th>Nível</Th>
              </Tr>
            </Thead>
            <Tbody>
              {namespaces.map((item) => {
                const mode = item.tasRequired ? 'required' : item.tasPreferred ? 'preferred' : 'none';
                const level = item.tasRequired || item.tasPreferred || topologyLevels[0] || 'kubernetes.io/hostname';
                return (
                  <Tr key={item.name}>
                    <Td dataLabel="Namespace">{item.name}</Td>
                    <Td dataLabel="Modo">
                      <FormSelect
                        id={`tas-mode-${item.name}`}
                        value={mode}
                        isDisabled={pendingNs === item.name}
                        onChange={(_event, value) => {
                          void onNamespaceTas(item, value, level);
                        }}
                        aria-label={`Modo TAS de ${item.name}`}
                      >
                        <FormSelectOption value="none" label="Sem pedido extra" />
                        <FormSelectOption value="preferred" label="Preferred (melhor esforço)" />
                        <FormSelectOption value="required" label="Required (obrigatório)" />
                      </FormSelect>
                    </Td>
                    <Td dataLabel="Nível">
                      <FormSelect
                        id={`tas-level-${item.name}`}
                        value={level}
                        isDisabled={pendingNs === item.name || mode === 'none'}
                        onChange={(_event, value) => {
                          void onNamespaceTas(item, mode, value);
                        }}
                        aria-label={`Nível TAS de ${item.name}`}
                      >
                        {(topologyLevels.includes(level) ? topologyLevels : [level, ...topologyLevels]).map((entry) => (
                          <FormSelectOption key={entry} value={entry} label={entry} />
                        ))}
                      </FormSelect>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </>
      )}

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} variant="medium" aria-labelledby="topology-title">
        <ModalHeader title="Criar Topology" labelId="topology-title" />
        <ModalBody>
          <Form>
            <FormGroup label="Nome" isRequired fieldId="topology-name">
              <TextInput id="topology-name" value={name} onChange={(_event, value) => setName(value)} />
            </FormGroup>
            {levels.map((level, index) => (
              <FormGroup
                key={`level-${index}`}
                label={index === 0 ? 'Níveis (do mais largo ao mais estreito)' : undefined}
                fieldId={`topology-level-${index}`}
                isRequired={index === 0}
              >
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <FormSelect
                    id={`topology-level-${index}`}
                    value={level}
                    onChange={(_event, value) =>
                      setLevels((current) => current.map((item, idx) => (idx === index ? value : item)))
                    }
                    aria-label={`Nível ${index + 1}`}
                  >
                    {(labelOptions.includes(level) ? labelOptions : [level, ...labelOptions]).map((option) => (
                      <FormSelectOption key={option} value={option} label={option} />
                    ))}
                  </FormSelect>
                  <Button
                    variant="secondary"
                    isDisabled={levels.length <= 1}
                    onClick={() => setLevels((current) => current.filter((_, idx) => idx !== index))}
                  >
                    Remover
                  </Button>
                </div>
              </FormGroup>
            ))}
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  kubernetes.io/hostname, se usado, tem de ser o último nível. Os níveis não podem ser editados depois.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
            <ActionGroup>
              <Button variant="secondary" onClick={() => setLevels((current) => [...current, 'kubernetes.io/hostname'])}>
                Adicionar nível
              </Button>
            </ActionGroup>
            <FormGroup label="Ligar a ResourceFlavor (opcional)" fieldId="topology-bind">
              <FormSelect
                id="topology-bind"
                value={bindFlavor}
                onChange={(_event, value) => setBindFlavor(value)}
                aria-label="ResourceFlavor para TAS"
              >
                <FormSelectOption value="" label="Não ligar agora" />
                {unboundFlavors.map((item) => (
                  <FormSelectOption key={item.name} value={item.name} label={item.name} />
                ))}
              </FormSelect>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    O flavor precisa de nodeLabels. Depois de definir topologyName o spec do flavor fica imutável.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <ActionGroup>
              <Button
                variant="primary"
                onClick={onSave}
                isDisabled={isSaving || !name || levels.every((level) => !level)}
                isLoading={isSaving}
              >
                Criar
              </Button>
              <Button variant="link" onClick={() => setIsOpen(false)} isDisabled={isSaving}>
                Cancelar
              </Button>
            </ActionGroup>
          </Form>
        </ModalBody>
      </Modal>

      <Modal isOpen={Boolean(viewing)} onClose={() => setViewing(null)} variant="medium" aria-labelledby="topology-view">
        <ModalHeader title={viewing ? `Árvore ${viewing.name}` : 'Árvore'} labelId="topology-view" />
        <ModalBody>
          {viewing &&
            (viewing.tree.length ? (
              <TreeView data={treeItems(viewing.tree)} defaultAllExpanded aria-label={`Árvore ${viewing.name}`} />
            ) : (
              <p>Nenhum node corresponde aos rótulos desta Topology.</p>
            ))}
        </ModalBody>
      </Modal>
    </>
  );
};
