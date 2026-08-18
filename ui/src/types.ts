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
  priorityClass?: string;
  gpus: Record<string, string>;
  runStrategy: string;
  creationTimestamp?: string;
  managed: boolean;
  username?: string;
  password?: string;
}

export interface WorkloadTopologyDomain {
  levels: string[];
  values: string[];
  count: number;
}

export interface WorkloadTopology {
  podSet: string;
  domains: WorkloadTopologyDomain[];
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
  priority?: number | null;
  priorityClass?: string;
  topology?: WorkloadTopology[];
}

export interface CatalogResource {
  name: string;
  group: string;
  label: string;
  defaultQuota: string;
  allocatable: number;
  inUse: boolean;
}

export interface CatalogFlavor {
  name: string;
  nodeLabels: Record<string, string>;
  topologyName?: string;
}

export interface QuotaRow {
  name: string;
  flavor: string;
  nominalQuota: string;
  borrowingLimit?: string | null;
  lendingLimit?: string | null;
}

export interface ClusterQueueItem {
  name: string;
  cohort?: string;
  queueingStrategy: string;
  stopPolicy: string;
  selector: { mode: string; namespaces: string[] };
  preemption: Record<string, unknown>;
  quotas: QuotaRow[];
  quota: Record<string, string>;
  coveredResources: string[];
  flavors: string[];
  admittedWorkloads: number;
  pendingWorkloads: number;
  reservingWorkloads: number;
  active: boolean;
  protected: boolean;
  managedReservation: boolean;
}

export interface KueueNamespace {
  name: string;
  displayName: string;
  managed: boolean;
  system: boolean;
  protected: boolean;
  defaultPriorityClass?: string | null;
  tasRequired?: string | null;
  tasPreferred?: string | null;
}

export interface AdminLocalQueue {
  name: string;
  namespace: string;
  clusterQueue: string;
  pendingWorkloads: number;
  admittedWorkloads: number;
  defaultQueue: boolean;
}

export interface ResourceFlavorItem {
  name: string;
  nodeLabels: Record<string, string>;
  topologyName?: string;
  inUse?: boolean;
}

export interface TopologyNode {
  label: string;
  value: string;
  nodes: number;
  gpus: number;
  missing?: boolean;
  nodeNames?: string[];
  children?: TopologyNode[];
}

export interface TopologyItem {
  name: string;
  levels: string[];
  flavors: string[];
  inUse: boolean;
  tree: TopologyNode[];
  nodeCount?: number;
}

export interface PriorityClassItem {
  name: string;
  value: number;
  description: string;
  namespaces: string[];
  workloads: number;
}

export interface PriorityApplyResult {
  workloads: number;
  jobs: number;
  pods: number;
  virtualMachines: number;
  errors: string[];
}

export interface PermissionCheck {
  name: string;
  ok: boolean;
  detail: string;
  action?: string | null;
}

export interface KueueDashboard {
  operator: {
    available: boolean;
    detail: string;
    frameworks: string[];
    quotaCheckStrategy?: string | null;
    managementState?: string;
  };
  knownFrameworks: string[];
  namespaces: { managed: number; managedNames: string[]; total: number };
  clusterQueues: {
    total: number;
    active: number;
    pendingWorkloads: number;
    admittedWorkloads: number;
    items: ClusterQueueItem[];
  };
  localQueues: number;
  flavors: string[];
  topologies?: { total: number; names: string[]; tasFlavors: string[] };
  priorityClasses?: { name: string; value: number }[];
  workloads: { total: number; admitted: number; pending: number; finished: number };
  coveredResources: string[];
  permissions: PermissionCheck[];
}

