import type {
  AdminLocalQueue,
  CatalogFlavor,
  CatalogResource,
  ClusterQueueItem,
  GpuResource,
  KueueDashboard,
  KueueNamespace,
  LocalQueue,
  NamespaceItem,
  Overview,
  PermissionCheck,
  PriorityApplyResult,
  PriorityClassItem,
  QuotaRow,
  Reservation,
  ResourceFlavorItem,
  SetupCheck,
  TopologyItem,
  VirtualMachine,
  Workload
} from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    },
    ...init
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      detail = await response.text();
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return response.json() as Promise<T>;
}

export const api = {
  overview: () => request<Overview>('/api/overview'),
  setup: () => request<{ checks: SetupCheck[] }>('/api/setup'),
  namespaces: () => request<{ items: NamespaceItem[] }>('/api/namespaces'),
  gpuResources: () => request<{ items: GpuResource[] }>('/api/gpu-resources'),
  localQueues: (namespace?: string) =>
    request<{ items: LocalQueue[] }>(namespace ? `/api/localqueues?namespace=${namespace}` : '/api/localqueues'),
  reservations: () => request<{ items: Reservation[] }>('/api/reservations'),
  createReservation: (body: {
    namespace: string;
    gpu_resource: string;
    gpu_count: number;
    cpu: string;
    memory: string;
  }) => request<{ item: Reservation }>('/api/reservations', { method: 'POST', body: JSON.stringify(body) }),
  deleteReservation: (name: string) =>
    request<{ status: string }>(`/api/reservations/${name}`, { method: 'DELETE' }),
  vms: (namespace?: string) => request<{ items: VirtualMachine[] }>(namespace ? `/api/vms?namespace=${namespace}` : '/api/vms'),
  createVm: (body: {
    namespace: string;
    name: string;
    queue: string;
    gpu_resource: string;
    gpu_count: number;
    cpu: string;
    memory: string;
    run_strategy: string;
  }) => request<{ item: VirtualMachine }>('/api/vms', { method: 'POST', body: JSON.stringify(body) }),
  vmAction: (namespace: string, name: string, action: string) =>
    request<{ status: string }>(`/api/vms/${namespace}/${name}/action`, {
      method: 'POST',
      body: JSON.stringify({ action })
    }),
  deleteVm: (namespace: string, name: string) =>
    request<{ status: string }>(`/api/vms/${namespace}/${name}`, { method: 'DELETE' }),
  workloads: () => request<{ items: Workload[] }>('/api/workloads'),
  kueueDashboard: () => request<KueueDashboard>('/api/kueue/dashboard'),
  kueueCatalog: () => request<{ items: CatalogResource[]; flavors: CatalogFlavor[] }>('/api/kueue/catalog'),
  kueueNamespaces: () => request<{ items: KueueNamespace[] }>('/api/kueue/namespaces'),
  manageNamespace: (name: string, body: { managed: boolean; createDefaultLocalQueue?: boolean }) =>
    request<{ name: string; managed: boolean; createdDefaultLocalQueue: boolean }>(
      `/api/kueue/namespaces/${name}/manage`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  clusterQueues: () => request<{ items: ClusterQueueItem[] }>('/api/kueue/clusterqueues'),
  createClusterQueue: (body: {
    name: string;
    cohortName?: string | null;
    queueingStrategy: string;
    namespaceSelectorMode: string;
    namespaces: string[];
    stopPolicy: string;
    reclaimWithinCohort: string;
    withinClusterQueue: string;
    quotas: QuotaRow[];
  }) => request<{ item: ClusterQueueItem }>('/api/kueue/clusterqueues', { method: 'POST', body: JSON.stringify(body) }),
  updateClusterQueue: (
    name: string,
    body: {
      name: string;
      cohortName?: string | null;
      queueingStrategy: string;
      namespaceSelectorMode: string;
      namespaces: string[];
      stopPolicy: string;
      reclaimWithinCohort: string;
      withinClusterQueue: string;
      quotas: QuotaRow[];
    }
  ) => request<{ item: ClusterQueueItem }>(`/api/kueue/clusterqueues/${name}`, { method: 'PUT', body: JSON.stringify(body) }),
  setClusterQueueStopPolicy: (name: string, stopPolicy: string) =>
    request<{ item: ClusterQueueItem }>(`/api/kueue/clusterqueues/${name}/stop-policy`, {
      method: 'POST',
      body: JSON.stringify({ stopPolicy })
    }),
  deleteClusterQueue: (name: string) =>
    request<{ status: string }>(`/api/kueue/clusterqueues/${name}`, { method: 'DELETE' }),
  adminLocalQueues: (namespace?: string) =>
    request<{ items: AdminLocalQueue[] }>(
      namespace ? `/api/kueue/localqueues?namespace=${namespace}` : '/api/kueue/localqueues'
    ),
  createLocalQueue: (body: { name: string; namespace: string; clusterQueue: string; defaultQueue: boolean }) =>
    request<{ item: AdminLocalQueue }>('/api/kueue/localqueues', { method: 'POST', body: JSON.stringify(body) }),
  updateLocalQueue: (
    namespace: string,
    name: string,
    body: { name: string; namespace: string; clusterQueue: string; defaultQueue: boolean }
  ) =>
    request<{ item: AdminLocalQueue }>(`/api/kueue/localqueues/${namespace}/${name}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    }),
  deleteLocalQueue: (namespace: string, name: string) =>
    request<{ status: string }>(`/api/kueue/localqueues/${namespace}/${name}`, { method: 'DELETE' }),
  flavors: () => request<{ items: ResourceFlavorItem[] }>('/api/kueue/flavors'),
  createFlavor: (body: { name: string; nodeLabels: Record<string, string>; topologyName?: string | null }) =>
    request<{ item: ResourceFlavorItem }>('/api/kueue/flavors', { method: 'POST', body: JSON.stringify(body) }),
  updateFlavor: (name: string, body: { name: string; nodeLabels: Record<string, string>; topologyName?: string | null }) =>
    request<{ item: ResourceFlavorItem }>(`/api/kueue/flavors/${name}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteFlavor: (name: string) => request<{ status: string }>(`/api/kueue/flavors/${name}`, { method: 'DELETE' }),
  topologies: () =>
    request<{
      items: TopologyItem[];
      suggestedLevels: string[];
      availableNodeLabels: string[];
      flavors: ResourceFlavorItem[];
    }>('/api/kueue/topologies'),
  createTopology: (body: { name: string; levels: string[] }) =>
    request<{ item: TopologyItem }>('/api/kueue/topologies', { method: 'POST', body: JSON.stringify(body) }),
  deleteTopology: (name: string) => request<{ status: string }>(`/api/kueue/topologies/${name}`, { method: 'DELETE' }),
  priorityClasses: () => request<{ items: PriorityClassItem[] }>('/api/kueue/priority-classes'),
  createPriorityClass: (body: {
    name: string;
    value: number;
    description: string;
    namespaces: string[];
    applyToExisting: boolean;
  }) =>
    request<{ item: PriorityClassItem; applied: Record<string, PriorityApplyResult> }>('/api/kueue/priority-classes', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  updatePriorityClass: (
    name: string,
    body: { name: string; value: number; description: string; namespaces: string[]; applyToExisting: boolean }
  ) =>
    request<{ item: PriorityClassItem; applied: Record<string, PriorityApplyResult> }>(
      `/api/kueue/priority-classes/${name}`,
      { method: 'PUT', body: JSON.stringify(body) }
    ),
  deletePriorityClass: (name: string) =>
    request<{ status: string }>(`/api/kueue/priority-classes/${name}`, { method: 'DELETE' }),
  setNamespacePriority: (name: string, body: { priorityClass: string | null; applyToExisting: boolean }) =>
    request<{ name: string; priorityClass: string | null; applied: PriorityApplyResult | null }>(
      `/api/kueue/namespaces/${name}/priority`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  setNamespaceTas: (
    name: string,
    body: { required: string | null; preferred: string | null; applyToExisting: boolean }
  ) =>
    request<{ name: string; tasRequired: string | null; tasPreferred: string | null }>(
      `/api/kueue/namespaces/${name}/tas`,
      { method: 'POST', body: JSON.stringify(body) }
    ),
  integrations: () => request<{ frameworks: string[]; knownFrameworks: string[]; available: boolean }>('/api/kueue/integrations'),
  saveIntegrations: (frameworks: string[]) =>
    request<{ frameworks: string[] }>('/api/kueue/integrations', {
      method: 'PUT',
      body: JSON.stringify({ frameworks })
    }),
  permissions: () => request<{ checks: PermissionCheck[] }>('/api/kueue/permissions'),
  grantKubevirtPermissions: () => request<{ status: string; checks: PermissionCheck[] }>('/api/kueue/permissions/kubevirt', { method: 'POST' })
};
