export interface GpuNode {
  name: string;
  product?: string;
  fake: boolean;
  pool?: string;
  allocatable: Record<string, string>;
  gpuCountLabel?: string;
}

export interface Overview {
  nodes: GpuNode[];
  capacity: Record<string, number>;
  allocatable: Record<string, number>;
  quota: Record<string, number>;
  usage: Record<string, number>;
  virtualMachines: number;
  gpuVirtualMachines: number;
  runningGpuVirtualMachines: number;
  workloads: number;
  admittedWorkloads: number;
  pendingWorkloads: number;
  reservations: number;
}

export interface SetupCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface NamespaceItem {
  name: string;
  displayName: string;
  managed: boolean;
}

export interface GpuResource {
  name: string;
  allocatable: number;
}

export interface LocalQueue {
  name: string;
  namespace: string;
  clusterQueue: string;
  pendingWorkloads: number;
  admittedWorkloads: number;
}

export interface Reservation {
  name: string;
  namespace?: string;
  cohort?: string;
  managed: boolean;
  quota: Record<string, number>;
  gpuQuota: Record<string, number>;
  usage: Record<string, number>;
  reservation: Record<string, number>;
  admittedWorkloads: number;
  pendingWorkloads: number;
  active: boolean;
}

export interface VirtualMachine {
  name: string;
  namespace: string;
  status: string;
  ready: boolean;
  queue?: string;
  gpus: Record<string, string>;
  runStrategy: string;
  creationTimestamp?: string;
  managed: boolean;
  username?: string;
  password?: string;
}

export interface Workload {
  name: string;
  namespace: string;
  queue?: string;
  admitted: boolean;
  finished: boolean;
  quotaReserved: boolean;
  clusterQueue?: string;
  resources: Record<string, string>;
  creationTimestamp?: string;
}
