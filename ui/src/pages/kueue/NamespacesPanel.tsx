import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  EmptyState,
  EmptyStateBody,
  FormSelect,
  FormSelectOption,
  Label,
  SearchInput,
  Spinner,
  Switch,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { api } from '../../api';
import type { KueueNamespace, PriorityClassItem } from '../../types';

export const NamespacesPanel: React.FunctionComponent = () => {
  const [items, setItems] = useState<KueueNamespace[]>([]);
  const [priorityClasses, setPriorityClasses] = useState<PriorityClassItem[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [result, classes] = await Promise.all([api.kueueNamespaces(), api.priorityClasses()]);
    setItems(result.items);
    setPriorityClasses(classes.items);
  }, []);

  useEffect(() => {
    load()
      .catch((err: Error) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [load]);

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) {
      return items;
    }
    return items.filter(
      (item) => item.name.toLowerCase().includes(query) || item.displayName.toLowerCase().includes(query)
    );
  }, [filter, items]);

  const onToggle = async (item: KueueNamespace, managed: boolean) => {
    setError(null);
    setInfo(null);
    setPending(item.name);
    try {
      await api.manageNamespace(item.name, { managed, createDefaultLocalQueue: true });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const onPriority = async (item: KueueNamespace, priorityClass: string, applyToExisting: boolean) => {
    setError(null);
    setInfo(null);
    setPending(item.name);
    try {
      const result = await api.setNamespacePriority(item.name, {
        priorityClass: priorityClass || null,
        applyToExisting
      });
      if (applyToExisting && result.applied) {
        const extra = result.applied.errors.length
          ? ` ${result.applied.errors.length} aviso(s).`
          : '';
        setInfo(
          `${item.name}: aplicado a ${result.applied.workloads} workload(s), ${result.applied.virtualMachines} VM(s).${extra}`
        );
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <p>
        Namespaces com o rótulo <code>kueue.openshift.io/managed=true</code> passam a ser validados pelo webhook do
        Kueue. Ao ativar, a UI cria a LocalQueue <strong>default</strong> se ela ainda não existir. A classe de
        prioridade default aplica-se às VMs novas desta UI; use Aplicar para os workloads já existentes.
      </p>
      {error && (
        <Alert variant="danger" title="Erro nos namespaces" isInline>
          {error}
        </Alert>
      )}
      {info && (
        <Alert variant="success" title="Namespace actualizado" isInline>
          {info}
        </Alert>
      )}
      <Toolbar id="kueue-namespaces-toolbar">
        <ToolbarContent>
          <ToolbarItem>
            <SearchInput
              aria-label="Filtrar namespaces"
              placeholder="Filtrar namespaces"
              value={filter}
              onChange={(_event, value) => setFilter(value)}
              onClear={() => setFilter('')}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Label color="blue">{items.filter((item) => item.managed).length} geridos</Label>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isLoading ? (
        <Spinner aria-label="Carregando namespaces" />
      ) : visible.length === 0 ? (
        <EmptyState titleText="Nenhum namespace" headingLevel="h2" icon={CubesIcon}>
          <EmptyStateBody>Nenhum namespace corresponde ao filtro.</EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="Namespaces geridos pelo Kueue">
          <Thead>
            <Tr>
              <Th>Namespace</Th>
              <Th>Tipo</Th>
              <Th>Gestão Kueue</Th>
              <Th>Priority class</Th>
            </Tr>
          </Thead>
          <Tbody>
            {visible.map((item) => (
              <Tr key={item.name}>
                <Td dataLabel="Namespace">
                  {item.displayName}
                  {item.displayName !== item.name ? ` (${item.name})` : ''}
                </Td>
                <Td dataLabel="Tipo">
                  {item.system || item.protected ? (
                    <Label color="grey">Sistema / protegido</Label>
                  ) : (
                    <Label color="green">Utilizador</Label>
                  )}
                </Td>
                <Td dataLabel="Gestão Kueue">
                  <Switch
                    id={`kueue-ns-${item.name}`}
                    label="Gerido pelo Kueue"
                    isChecked={item.managed}
                    isDisabled={item.protected || item.system || pending === item.name}
                    onChange={(_event, checked) => {
                      void onToggle(item, checked);
                    }}
                  />
                </Td>
                <Td dataLabel="Priority class">
                  {item.system || item.protected || !item.managed ? (
                    '—'
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <FormSelect
                        id={`kueue-prio-${item.name}`}
                        value={item.defaultPriorityClass || ''}
                        isDisabled={pending === item.name}
                        onChange={(_event, value) => {
                          void onPriority(item, value, false);
                        }}
                        aria-label={`Priority class de ${item.name}`}
                      >
                        <FormSelectOption value="" label="Nenhuma" />
                        {priorityClasses.map((cls) => (
                          <FormSelectOption
                            key={cls.name}
                            value={cls.name}
                            label={`${cls.name} (${cls.value})`}
                          />
                        ))}
                      </FormSelect>
                      <Button
                        variant="secondary"
                        isDisabled={pending === item.name || !item.defaultPriorityClass}
                        onClick={() => {
                          void onPriority(item, item.defaultPriorityClass || '', true);
                        }}
                      >
                        Aplicar
                      </Button>
                    </div>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </>
  );
};
