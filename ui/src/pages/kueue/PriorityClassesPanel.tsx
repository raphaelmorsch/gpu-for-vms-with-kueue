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
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalHeader,
  Spinner,
  TextArea,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import SortAmountDownIcon from '@patternfly/react-icons/dist/esm/icons/sort-amount-down-icon';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../../api';
import type { KueueNamespace, PriorityApplyResult, PriorityClassItem } from '../../types';

const summarizeApplied = (applied?: Record<string, PriorityApplyResult>) => {
  if (!applied || !Object.keys(applied).length) {
    return null;
  }
  const totals = Object.values(applied).reduce(
    (acc, item) => ({
      workloads: acc.workloads + item.workloads,
      jobs: acc.jobs + item.jobs,
      pods: acc.pods + item.pods,
      virtualMachines: acc.virtualMachines + item.virtualMachines,
      errors: acc.errors + item.errors.length
    }),
    { workloads: 0, jobs: 0, pods: 0, virtualMachines: 0, errors: 0 }
  );
  const base = `Aplicado a ${totals.workloads} workload(s), ${totals.virtualMachines} VM(s), ${totals.jobs} job(s), ${totals.pods} pod(s).`;
  return totals.errors ? `${base} ${totals.errors} aviso(s) ao aplicar (workloads admitidos podem rejeitar a mudança de prioridade).` : base;
};

export const PriorityClassesPanel: React.FunctionComponent = () => {
  const [items, setItems] = useState<PriorityClassItem[]>([]);
  const [namespaces, setNamespaces] = useState<KueueNamespace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<PriorityClassItem | null>(null);
  const [name, setName] = useState('high-priority');
  const [value, setValue] = useState('10000');
  const [description, setDescription] = useState('');
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);
  const [applyToExisting, setApplyToExisting] = useState(true);

  const load = useCallback(async () => {
    const [classes, ns] = await Promise.all([api.priorityClasses(), api.kueueNamespaces()]);
    setItems(classes.items);
    setNamespaces(ns.items.filter((item) => item.managed && !item.system && !item.protected));
  }, []);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName('interactive');
    setValue('5000');
    setDescription('Workloads interactivos (VMs, notebooks) nestes namespaces');
    setSelectedNamespaces([]);
    setApplyToExisting(true);
    setIsOpen(true);
  };

  const openEdit = (item: PriorityClassItem) => {
    setEditing(item);
    setName(item.name);
    setValue(String(item.value));
    setDescription(item.description);
    setSelectedNamespaces(item.namespaces);
    setApplyToExisting(true);
    setIsOpen(true);
  };

  const toggleNamespace = (namespace: string, checked: boolean) => {
    setSelectedNamespaces((current) =>
      checked ? Array.from(new Set([...current, namespace])) : current.filter((item) => item !== namespace)
    );
  };

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    setInfo(null);
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setError('O valor de prioridade tem de ser um inteiro.');
      setIsSaving(false);
      return;
    }
    const body = {
      name,
      value: parsed,
      description,
      namespaces: selectedNamespaces,
      applyToExisting
    };
    try {
      const result = editing
        ? await api.updatePriorityClass(editing.name, body)
        : await api.createPriorityClass(body);
      setIsOpen(false);
      const applied = summarizeApplied(result.applied);
      setInfo(
        applied
          ? `Classe ${result.item.name} guardada. ${applied}`
          : `Classe ${result.item.name} guardada. Workloads novos nestes namespaces herdam o rótulo.`
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const onDelete = async (item: PriorityClassItem) => {
    setError(null);
    setInfo(null);
    try {
      await api.deletePriorityClass(item.name);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <p>
        WorkloadPriorityClass define a ordem de admissão e preempção no Kueue. Associe a classe a namespaces geridos:
        VMs criadas nesta UI e os workloads que já existirem (se marcar a opção) recebem o rótulo{' '}
        <code>kueue.x-k8s.io/priority-class</code>. Jobs criados noutros UIs precisam do mesmo rótulo, ou volte aqui e
        volte a aplicar.
      </p>
      {error && (
        <Alert variant="danger" title="Erro nas classes de prioridade" isInline>
          {error}
        </Alert>
      )}
      {info && (
        <Alert variant="success" title="Classes de prioridade" isInline>
          {info}
        </Alert>
      )}
      <Toolbar id="wpc-toolbar">
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={openCreate}>
              Criar WorkloadPriorityClass
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isLoading ? (
        <Spinner aria-label="Carregando classes de prioridade" />
      ) : items.length === 0 ? (
        <EmptyState titleText="Nenhuma WorkloadPriorityClass" headingLevel="h2" icon={SortAmountDownIcon}>
          <EmptyStateBody>Crie uma classe (por exemplo high-priority = 10000) e associe-a a namespaces.</EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="WorkloadPriorityClasses">
          <Thead>
            <Tr>
              <Th>Nome</Th>
              <Th>Valor</Th>
              <Th>Descrição</Th>
              <Th>Namespaces</Th>
              <Th>Workloads</Th>
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={item.name}>
                <Td dataLabel="Nome">{item.name}</Td>
                <Td dataLabel="Valor">{item.value}</Td>
                <Td dataLabel="Descrição">{item.description || '—'}</Td>
                <Td dataLabel="Namespaces">{item.namespaces.join(', ') || '—'}</Td>
                <Td dataLabel="Workloads">{item.workloads}</Td>
                <Td isActionCell>
                  <ActionsColumn
                    items={[
                      { title: 'Editar / associar namespaces', onClick: () => openEdit(item) },
                      { title: 'Excluir', onClick: () => onDelete(item) }
                    ]}
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        variant="medium"
        aria-labelledby="wpc-title"
      >
        <ModalHeader
          title={editing ? 'Editar WorkloadPriorityClass' : 'Criar WorkloadPriorityClass'}
          labelId="wpc-title"
        />
        <ModalBody>
          <Form>
            <FormGroup label="Nome" isRequired fieldId="wpc-name">
              <TextInput
                id="wpc-name"
                value={name}
                isDisabled={Boolean(editing)}
                onChange={(_event, next) => setName(next)}
              />
            </FormGroup>
            <FormGroup label="Valor" isRequired fieldId="wpc-value">
              <TextInput id="wpc-value" value={value} onChange={(_event, next) => setValue(next)} />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Inteiro; valores maiores entram primeiro e podem preemptar os menores. Alterar o valor não muda
                    workloads já criados.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup label="Descrição" fieldId="wpc-description">
              <TextArea
                id="wpc-description"
                value={description}
                onChange={(_event, next) => setDescription(next)}
                resizeOrientation="vertical"
              />
            </FormGroup>
            <FormGroup label="Namespaces geridos" fieldId="wpc-namespaces">
              {namespaces.length === 0 ? (
                <HelperText>
                  <HelperTextItem>Não há namespaces geridos pelo Kueue para associar.</HelperTextItem>
                </HelperText>
              ) : (
                namespaces.map((item) => (
                  <Checkbox
                    key={item.name}
                    id={`wpc-ns-${item.name}`}
                    label={
                      item.defaultPriorityClass && item.defaultPriorityClass !== name
                        ? `${item.name} (hoje: ${item.defaultPriorityClass})`
                        : item.name
                    }
                    isChecked={selectedNamespaces.includes(item.name)}
                    onChange={(_event, checked) => toggleNamespace(item.name, checked)}
                  />
                ))
              )}
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Cada namespace tem no máximo uma classe default. Workloads novos desta UI herdam o rótulo.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
            <FormGroup fieldId="wpc-apply">
              <Checkbox
                id="wpc-apply"
                label="Aplicar agora aos workloads, VMs, Jobs e pods já existentes nesses namespaces"
                isChecked={applyToExisting}
                onChange={(_event, checked) => setApplyToExisting(checked)}
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
