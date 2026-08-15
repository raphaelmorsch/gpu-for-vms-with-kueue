import type {
  GpuResource,
  LocalQueue,
  NamespaceItem,
  Overview,
  Reservation,
  SetupCheck,
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
  workloads: () => request<{ items: Workload[] }>('/api/workloads')
};
