"""Kueue Queue Manager and Scheduler Manager APIs."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from kubernetes import client
from kubernetes.client.rest import ApiException
from pydantic import BaseModel, Field

from app import (
    APP_LABEL,
    GPU_RESOURCES,
    KUEUE_GROUP,
    KUEUE_VERSION,
    KUBEVIRT_RESOURCES,
    _api_error,
    _list_cluster,
    _list_namespaced,
    _qty,
    api_client,
    core,
    custom,
    rbac,
)

router = APIRouter()

KUEUE_OPERATOR_NS = "openshift-kueue-operator"
KUEUE_SA = "kueue-controller-manager"
OPENSHIFT_KUEUE_GROUP = "kueue.openshift.io"
PROTECTED_NAMESPACES = {
    "gpu-vm-kueue",
    "openshift-kueue-operator",
    "openshift-cnv",
    "kube-system",
    "kube-public",
    "kube-node-lease",
}
PROTECTED_CLUSTERQUEUES = {"default"}
KNOWN_FRAMEWORKS = [
    "Pod",
    "Deployment",
    "StatefulSet",
    "BatchJob",
    "JobSet",
    "PyTorchJob",
    "TFJob",
    "XGBoostJob",
    "MPIJob",
    "PaddleJob",
    "JAXJob",
    "RayJob",
    "RayCluster",
    "TrainJob",
    "AppWrapper",
    "LeaderWorkerSet",
]
STATIC_CATALOG = [
    {"name": "cpu", "group": "compute", "label": "CPU", "defaultQuota": "32"},
    {"name": "memory", "group": "compute", "label": "Memória", "defaultQuota": "128Gi"},
    {"name": "pods", "group": "compute", "label": "Pods", "defaultQuota": "200"},
    {"name": "ephemeral-storage", "group": "storage", "label": "Disco efémero", "defaultQuota": "500Gi"},
    {"name": "hugepages-2Mi", "group": "compute", "label": "HugePages 2Mi", "defaultQuota": "0"},
    {"name": "hugepages-1Gi", "group": "compute", "label": "HugePages 1Gi", "defaultQuota": "0"},
    {"name": "nvidia.com/gpu", "group": "gpu", "label": "NVIDIA GPU", "defaultQuota": "8"},
    {"name": "nvidia.com/mig-1g.23gb", "group": "gpu", "label": "MIG 1g.23gb", "defaultQuota": "0"},
    {"name": "nvidia.com/mig-2g.47gb", "group": "gpu", "label": "MIG 2g.47gb", "defaultQuota": "0"},
    {"name": "nvidia.com/mig-3g.93gb", "group": "gpu", "label": "MIG 3g.93gb", "defaultQuota": "0"},
    {"name": "nvidia.com/mig-7g.189gb", "group": "gpu", "label": "MIG 7g.189gb", "defaultQuota": "0"},
    {"name": "amd.com/gpu", "group": "gpu", "label": "AMD GPU", "defaultQuota": "0"},
    {"name": "devices.kubevirt.io/kvm", "group": "kubevirt", "label": "KubeVirt KVM", "defaultQuota": "1000"},
    {"name": "devices.kubevirt.io/tun", "group": "kubevirt", "label": "KubeVirt TUN", "defaultQuota": "1000"},
    {"name": "devices.kubevirt.io/vhost-net", "group": "kubevirt", "label": "KubeVirt vhost-net", "defaultQuota": "1000"},
]


class QuotaRow(BaseModel):
    name: str
    flavor: str
    nominalQuota: str
    borrowingLimit: str | None = None
    lendingLimit: str | None = None


class ClusterQueueRequest(BaseModel):
    name: str = Field(min_length=1, max_length=253)
    cohortName: str | None = None
    queueingStrategy: str = "BestEffortFIFO"
    namespaceSelectorMode: str = "managed"
    namespaces: list[str] = Field(default_factory=list)
    stopPolicy: str = "None"
    reclaimWithinCohort: str = "Never"
    withinClusterQueue: str = "Never"
    quotas: list[QuotaRow] = Field(min_length=1)


class LocalQueueRequest(BaseModel):
    name: str = Field(min_length=1, max_length=253)
    namespace: str
    clusterQueue: str
    defaultQueue: bool = False


class FlavorRequest(BaseModel):
    name: str = Field(min_length=1, max_length=253)
    nodeLabels: dict[str, str] = Field(default_factory=dict)


class NamespaceManageRequest(BaseModel):
    managed: bool
    createDefaultLocalQueue: bool = True


class IntegrationsRequest(BaseModel):
    frameworks: list[str]


class StopPolicyRequest(BaseModel):
    stopPolicy: str


def _is_system_namespace(name: str) -> bool:
    return name.startswith(("kube-", "openshift-", "redhat-")) or name in PROTECTED_NAMESPACES


def _condition(status: dict[str, Any], type_name: str) -> bool:
    return any(c.get("type") == type_name and c.get("status") == "True" for c in status.get("conditions") or [])


def _selector_from_request(req: ClusterQueueRequest) -> dict[str, Any]:
    mode = req.namespaceSelectorMode
    if mode == "all":
        return {}
    if mode == "namespaces":
        values = [n for n in req.namespaces if n]
        if not values:
            raise HTTPException(status_code=400, detail="Indique pelo menos um namespace")
        return {
            "matchExpressions": [
                {"key": "kubernetes.io/metadata.name", "operator": "In", "values": values}
            ]
        }
    return {"matchLabels": {"kueue.openshift.io/managed": "true"}}


def _selector_view(selector: dict[str, Any] | None) -> dict[str, Any]:
    selector = selector or {}
    if not selector:
        return {"mode": "all", "namespaces": []}
    labels = selector.get("matchLabels") or {}
    if labels.get("kueue.openshift.io/managed") == "true" and len(labels) == 1:
        return {"mode": "managed", "namespaces": []}
    if labels.get("kubernetes.io/metadata.name"):
        return {"mode": "namespaces", "namespaces": [labels["kubernetes.io/metadata.name"]]}
    for expr in selector.get("matchExpressions") or []:
        if expr.get("key") == "kubernetes.io/metadata.name" and expr.get("operator") == "In":
            return {"mode": "namespaces", "namespaces": list(expr.get("values") or [])}
    return {"mode": "managed", "namespaces": []}


def _resource_groups(quotas: list[QuotaRow]) -> list[dict[str, Any]]:
    by_flavor: dict[str, list[QuotaRow]] = {}
    for row in quotas:
        name = row.name.strip()
        flavor = row.flavor.strip()
        if not name or not flavor:
            raise HTTPException(status_code=400, detail="Cada cota precisa de recurso e ResourceFlavor")
        by_flavor.setdefault(flavor, []).append(row)
    covered_by_flavor = {flavor: tuple(sorted({r.name.strip() for r in rows})) for flavor, rows in by_flavor.items()}
    grouped: dict[tuple[str, ...], list[str]] = {}
    for flavor, covered in covered_by_flavor.items():
        grouped.setdefault(covered, []).append(flavor)
    groups: list[dict[str, Any]] = []
    for covered, flavors in grouped.items():
        groups.append(
            {
                "coveredResources": list(covered),
                "flavors": [
                    {
                        "name": flavor,
                        "resources": [
                            {
                                "name": row.name.strip(),
                                "nominalQuota": str(row.nominalQuota),
                                **({"borrowingLimit": row.borrowingLimit} if row.borrowingLimit else {}),
                                **({"lendingLimit": row.lendingLimit} if row.lendingLimit else {}),
                            }
                            for row in by_flavor[flavor]
                        ],
                    }
                    for flavor in flavors
                ],
            }
        )
    return groups


def _quota_rows(cq: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for group in cq.get("spec", {}).get("resourceGroups") or []:
        for flavor in group.get("flavors") or []:
            for res in flavor.get("resources") or []:
                rows.append(
                    {
                        "name": res.get("name"),
                        "flavor": flavor.get("name"),
                        "nominalQuota": str(res.get("nominalQuota") or "0"),
                        "borrowingLimit": str(res["borrowingLimit"]) if res.get("borrowingLimit") is not None else None,
                        "lendingLimit": str(res["lendingLimit"]) if res.get("lendingLimit") is not None else None,
                    }
                )
    return rows


def _summarize_clusterqueue(cq: dict[str, Any]) -> dict[str, Any]:
    meta = cq.get("metadata", {})
    spec = cq.get("spec", {})
    status = cq.get("status", {})
    quotas: dict[str, str] = {}
    for group in spec.get("resourceGroups") or []:
        for flavor in group.get("flavors") or []:
            for res in flavor.get("resources") or []:
                quotas[str(res.get("name"))] = str(res.get("nominalQuota") or "0")
    return {
        "name": meta.get("name"),
        "cohort": spec.get("cohortName") or spec.get("cohort"),
        "queueingStrategy": spec.get("queueingStrategy") or "BestEffortFIFO",
        "stopPolicy": spec.get("stopPolicy") or "None",
        "namespaceSelector": spec.get("namespaceSelector") or {},
        "selector": _selector_view(spec.get("namespaceSelector")),
        "preemption": spec.get("preemption") or {},
        "quotas": _quota_rows(cq),
        "quota": quotas,
        "coveredResources": sorted(
            {name for group in spec.get("resourceGroups") or [] for name in group.get("coveredResources") or []}
        ),
        "flavors": sorted(
            {
                flavor.get("name")
                for group in spec.get("resourceGroups") or []
                for flavor in group.get("flavors") or []
                if flavor.get("name")
            }
        ),
        "admittedWorkloads": status.get("admittedWorkloads", 0),
        "pendingWorkloads": status.get("pendingWorkloads", 0),
        "reservingWorkloads": status.get("reservingWorkloads", 0),
        "active": _condition(status, "Active"),
        "protected": meta.get("name") in PROTECTED_CLUSTERQUEUES,
        "managedReservation": (meta.get("labels") or {}).get(APP_LABEL) == "true",
    }


def _clusterqueue_body(req: ClusterQueueRequest) -> dict[str, Any]:
    if req.queueingStrategy not in {"BestEffortFIFO", "StrictFIFO"}:
        raise HTTPException(status_code=400, detail="queueingStrategy inválida")
    if req.stopPolicy not in {"None", "Hold", "HoldAndDrain"}:
        raise HTTPException(status_code=400, detail="stopPolicy inválida")
    return {
        "apiVersion": f"{KUEUE_GROUP}/{KUEUE_VERSION}",
        "kind": "ClusterQueue",
        "metadata": {
            "name": req.name,
            "labels": {"app.kubernetes.io/part-of": "gpu-for-vms-with-kueue", "gpu-vm-kueue.io/queue-manager": "true"},
        },
        "spec": {
            **({"cohortName": req.cohortName} if req.cohortName else {"cohortName": None}),
            "namespaceSelector": _selector_from_request(req),
            "queueingStrategy": req.queueingStrategy,
            "stopPolicy": req.stopPolicy,
            "preemption": {
                "reclaimWithinCohort": req.reclaimWithinCohort,
                "withinClusterQueue": req.withinClusterQueue,
                "borrowWithinCohort": {"policy": "Never"},
            },
            "resourceGroups": _resource_groups(req.quotas),
        },
    }


def _get_kueue_cr() -> dict[str, Any] | None:
    try:
        return custom.get_cluster_custom_object(OPENSHIFT_KUEUE_GROUP, "v1", "kueues", "cluster")
    except ApiException:
        items = _list_cluster(OPENSHIFT_KUEUE_GROUP, "v1", "kueues")
        return items[0] if items else None


def _permission_checks() -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str, action: str | None = None) -> None:
        checks.append({"name": name, "ok": ok, "detail": detail, "action": action})

    try:
        rbac.read_cluster_role_binding("kueue-kubevirt-integration")
        add("RBAC Kueue → KubeVirt", True, "clusterrolebinding kueue-kubevirt-integration")
    except ApiException:
        add("RBAC Kueue → KubeVirt", False, "O controller não pode admitir VMs/virt-launcher", "kubevirt")

    try:
        rbac.read_cluster_role_binding("kueue-use-kubevirt-controller-scc")
        add("SCC kubevirt-controller", True, "kueue-controller-manager pode usar a SCC")
    except ApiException:
        add("SCC kubevirt-controller", False, "virt-launcher pode falhar no SCC", "kubevirt")

    try:
        rbac.read_cluster_role_binding("kueue-manager-rolebinding")
        add("RBAC manager do Kueue", True, "kueue-manager-rolebinding")
    except ApiException:
        add("RBAC manager do Kueue", False, "Role principal do controller em falta")

    cr = _get_kueue_cr()
    frameworks = ((cr or {}).get("spec", {}).get("config") or {}).get("integrations", {}).get("frameworks") or []
    add("Integração Pod", "Pod" in frameworks, "Necessária para virt-launcher e Deployments geridos")
    add("Integração BatchJob", "BatchJob" in frameworks, "Jobs batch/v1" if "BatchJob" in frameworks else "Não está activa no Kueue CR")
    add("Integração Deployment", "Deployment" in frameworks, ", ".join(frameworks) or "nenhuma")
    return checks


def _ensure_cluster_role(name: str, rules: list[client.V1PolicyRule]) -> None:
    body = client.V1ClusterRole(
        metadata=client.V1ObjectMeta(
            name=name,
            labels={"app.kubernetes.io/part-of": "gpu-for-vms-with-kueue"},
        ),
        rules=rules,
    )
    try:
        rbac.read_cluster_role(name)
        rbac.patch_cluster_role(name, body)
    except ApiException as exc:
        if exc.status != 404:
            raise
        rbac.create_cluster_role(body)


def _ensure_cluster_role_binding(name: str, role_name: str) -> None:
    body = client.V1ClusterRoleBinding(
        metadata=client.V1ObjectMeta(
            name=name,
            labels={"app.kubernetes.io/part-of": "gpu-for-vms-with-kueue"},
        ),
        role_ref=client.V1RoleRef(api_group="rbac.authorization.k8s.io", kind="ClusterRole", name=role_name),
        subjects=[client.V1Subject(kind="ServiceAccount", name=KUEUE_SA, namespace=KUEUE_OPERATOR_NS)],
    )
    try:
        rbac.read_cluster_role_binding(name)
        rbac.patch_cluster_role_binding(name, body)
    except ApiException as exc:
        if exc.status != 404:
            raise
        rbac.create_cluster_role_binding(body)


def _apply_kubevirt_permissions() -> None:
    _ensure_cluster_role(
        "kueue-kubevirt-integration",
        [
            client.V1PolicyRule(
                api_groups=["kubevirt.io"],
                resources=["virtualmachines", "virtualmachineinstances", "virtualmachineinstancemigrations"],
                verbs=["get", "list", "watch", "update", "patch"],
            ),
            client.V1PolicyRule(
                api_groups=["kubevirt.io"],
                resources=["virtualmachines/status", "virtualmachineinstances/status"],
                verbs=["get", "list", "watch", "patch", "update"],
            ),
            client.V1PolicyRule(
                api_groups=["subresources.kubevirt.io"],
                resources=[
                    "virtualmachines/start",
                    "virtualmachines/stop",
                    "virtualmachines/restart",
                    "virtualmachineinstances/addvolume",
                    "virtualmachineinstances/removevolume",
                ],
                verbs=["get", "update"],
            ),
            client.V1PolicyRule(
                api_groups=["cdi.kubevirt.io"],
                resources=["datavolumes", "datasources"],
                verbs=["get", "list", "watch"],
            ),
            client.V1PolicyRule(api_groups=[""], resources=["pods"], verbs=["get", "list", "watch", "update", "patch", "delete"]),
            client.V1PolicyRule(api_groups=[""], resources=["pods/eviction"], verbs=["create"]),
            client.V1PolicyRule(api_groups=[""], resources=["pods/status"], verbs=["get", "patch", "update"]),
            client.V1PolicyRule(
                api_groups=["security.openshift.io"],
                resources=["securitycontextconstraints"],
                resource_names=["kubevirt-controller", "kubevirt-handler", "privileged"],
                verbs=["use"],
            ),
        ],
    )
    _ensure_cluster_role_binding("kueue-kubevirt-integration", "kueue-kubevirt-integration")
    _ensure_cluster_role(
        "kueue-use-kubevirt-controller-scc",
        [
            client.V1PolicyRule(
                api_groups=["security.openshift.io"],
                resources=["securitycontextconstraints"],
                resource_names=["kubevirt-controller"],
                verbs=["use"],
            )
        ],
    )
    _ensure_cluster_role_binding("kueue-use-kubevirt-controller-scc", "kueue-use-kubevirt-controller-scc")


@router.get("/api/kueue/dashboard")
def kueue_dashboard() -> dict[str, Any]:
    queues = [_summarize_clusterqueue(cq) for cq in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues")]
    localqueues = _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "localqueues")
    flavors = _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "resourceflavors")
    workloads = _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "workloads")
    namespaces = core.list_namespace().items
    managed = [
        ns.metadata.name
        for ns in namespaces
        if (ns.metadata.labels or {}).get("kueue.openshift.io/managed") == "true"
    ]
    admitted = sum(1 for wl in workloads if _condition(wl.get("status") or {}, "Admitted"))
    finished = sum(1 for wl in workloads if _condition(wl.get("status") or {}, "Finished"))
    pending = sum(1 for wl in workloads if not (wl.get("status") or {}).get("admission"))
    cr = _get_kueue_cr()
    config = ((cr or {}).get("spec") or {}).get("config") or {}
    operator = {"available": False, "detail": "Kueue CR ausente", "frameworks": [], "quotaCheckStrategy": None}
    if cr:
        conds = {c.get("type"): c for c in (cr.get("status") or {}).get("conditions") or []}
        available = (conds.get("Available") or {}).get("status") == "True"
        operator = {
            "available": available,
            "detail": (conds.get("Available") or {}).get("message") or cr.get("metadata", {}).get("name"),
            "frameworks": (config.get("integrations") or {}).get("frameworks") or [],
            "quotaCheckStrategy": ((cr.get("spec") or {}).get("unsupportedConfigOverrides") or {})
            .get("resources", {})
            .get("quotaCheckStrategy"),
            "managementState": (cr.get("spec") or {}).get("managementState"),
        }
    covered = sorted({name for q in queues for name in q["coveredResources"]})
    return {
        "operator": operator,
        "knownFrameworks": KNOWN_FRAMEWORKS,
        "namespaces": {"managed": len(managed), "managedNames": managed, "total": len(namespaces)},
        "clusterQueues": {
            "total": len(queues),
            "active": sum(1 for q in queues if q["active"]),
            "pendingWorkloads": sum(q["pendingWorkloads"] for q in queues),
            "admittedWorkloads": sum(q["admittedWorkloads"] for q in queues),
            "items": queues,
        },
        "localQueues": len(localqueues),
        "flavors": [f.get("metadata", {}).get("name") for f in flavors],
        "workloads": {"total": len(workloads), "admitted": admitted, "pending": pending, "finished": finished},
        "coveredResources": covered,
        "permissions": _permission_checks(),
    }


@router.get("/api/kueue/catalog")
def resource_catalog() -> dict[str, Any]:
    allocatable: dict[str, int] = {}
    for node in core.list_node().items:
        for key, val in (node.status.allocatable or {}).items():
            allocatable[key] = allocatable.get(key, 0) + _qty(val)
    used: set[str] = set()
    for cq in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues"):
        for group in cq.get("spec", {}).get("resourceGroups") or []:
            used.update(group.get("coveredResources") or [])
    items = []
    seen: set[str] = set()
    for entry in STATIC_CATALOG:
        name = entry["name"]
        seen.add(name)
        items.append({**entry, "allocatable": allocatable.get(name, 0), "inUse": name in used})
    extra = sorted(set(allocatable) | used | set(GPU_RESOURCES) | set(KUBEVIRT_RESOURCES))
    for name in extra:
        if name in seen:
            continue
        group = "gpu" if "gpu" in name.lower() or name.startswith("nvidia.com/") else "other"
        if name.startswith("devices.kubevirt.io/"):
            group = "kubevirt"
        items.append(
            {
                "name": name,
                "group": group,
                "label": name,
                "defaultQuota": str(allocatable.get(name, 0) or "0"),
                "allocatable": allocatable.get(name, 0),
                "inUse": name in used,
            }
        )
    flavors = [
        {
            "name": f.get("metadata", {}).get("name"),
            "nodeLabels": (f.get("spec") or {}).get("nodeLabels") or {},
        }
        for f in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "resourceflavors")
    ]
    return {"items": items, "flavors": flavors}


@router.get("/api/kueue/namespaces")
def list_kueue_namespaces() -> dict[str, Any]:
    items = []
    for ns in core.list_namespace().items:
        labels = ns.metadata.labels or {}
        name = ns.metadata.name
        items.append(
            {
                "name": name,
                "displayName": (ns.metadata.annotations or {}).get("openshift.io/display-name") or name,
                "managed": labels.get("kueue.openshift.io/managed") == "true",
                "system": _is_system_namespace(name),
                "protected": name in PROTECTED_NAMESPACES,
            }
        )
    items.sort(key=lambda i: (not i["managed"], i["system"], i["name"]))
    return {"items": items}


@router.post("/api/kueue/namespaces/{name}/manage")
def manage_namespace(name: str, req: NamespaceManageRequest) -> dict[str, Any]:
    if _is_system_namespace(name):
        raise HTTPException(status_code=400, detail=f"O namespace {name} não deve ser gerido pelo Kueue")
    try:
        api_client.call_api(
            f"/api/v1/namespaces/{name}",
            "PATCH",
            header_params={
                "Content-Type": "application/merge-patch+json",
                "Accept": "application/json",
            },
            body={
                "metadata": {
                    "labels": {
                        "kueue.openshift.io/managed": "true" if req.managed else None,
                        "kueue-managed": "true" if req.managed else None,
                    }
                }
            },
            auth_settings=["BearerToken"],
            response_type=object,
            _return_http_data_only=True,
        )
        created_queue = False
        if req.managed and req.createDefaultLocalQueue:
            try:
                custom.get_namespaced_custom_object(KUEUE_GROUP, KUEUE_VERSION, name, "localqueues", "default")
            except ApiException as exc:
                if exc.status != 404:
                    raise
                custom.create_namespaced_custom_object(
                    KUEUE_GROUP,
                    KUEUE_VERSION,
                    name,
                    "localqueues",
                    {
                        "apiVersion": f"{KUEUE_GROUP}/{KUEUE_VERSION}",
                        "kind": "LocalQueue",
                        "metadata": {
                            "name": "default",
                            "namespace": name,
                            "annotations": {"kueue.x-k8s.io/default-queue": "true"},
                        },
                        "spec": {"clusterQueue": "default"},
                    },
                )
                created_queue = True
        return {"name": name, "managed": req.managed, "createdDefaultLocalQueue": created_queue}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.get("/api/kueue/clusterqueues")
def list_clusterqueues() -> dict[str, Any]:
    return {"items": [_summarize_clusterqueue(cq) for cq in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues")]}


@router.get("/api/kueue/clusterqueues/{name}")
def get_clusterqueue(name: str) -> dict[str, Any]:
    try:
        cq = custom.get_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
        return {"item": _summarize_clusterqueue(cq)}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.post("/api/kueue/clusterqueues")
def create_clusterqueue(req: ClusterQueueRequest) -> dict[str, Any]:
    body = _clusterqueue_body(req)
    try:
        created = custom.create_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", body)
        return {"item": _summarize_clusterqueue(created)}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.put("/api/kueue/clusterqueues/{name}")
def replace_clusterqueue(name: str, req: ClusterQueueRequest) -> dict[str, Any]:
    if req.name != name:
        raise HTTPException(status_code=400, detail="O nome da ClusterQueue não pode ser alterado")
    body = _clusterqueue_body(req)
    try:
        custom.patch_cluster_custom_object(
            KUEUE_GROUP,
            KUEUE_VERSION,
            "clusterqueues",
            name,
            {"metadata": {"labels": body["metadata"]["labels"]}, "spec": body["spec"]},
            _content_type="application/merge-patch+json",
        )
        updated = custom.get_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
        return {"item": _summarize_clusterqueue(updated)}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.post("/api/kueue/clusterqueues/{name}/stop-policy")
def set_stop_policy(name: str, req: StopPolicyRequest) -> dict[str, Any]:
    if req.stopPolicy not in {"None", "Hold", "HoldAndDrain"}:
        raise HTTPException(status_code=400, detail="stopPolicy inválida")
    try:
        custom.patch_cluster_custom_object(
            KUEUE_GROUP,
            KUEUE_VERSION,
            "clusterqueues",
            name,
            {"spec": {"stopPolicy": req.stopPolicy}},
            _content_type="application/merge-patch+json",
        )
        cq = custom.get_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
        return {"item": _summarize_clusterqueue(cq)}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.delete("/api/kueue/clusterqueues/{name}")
def delete_clusterqueue(name: str) -> dict[str, str]:
    if name in PROTECTED_CLUSTERQUEUES:
        raise HTTPException(status_code=400, detail="A ClusterQueue default do cluster não pode ser excluída por esta UI")
    try:
        custom.delete_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
        return {"status": "deleted", "name": name}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.get("/api/kueue/localqueues")
def list_localqueues_admin(namespace: str | None = None) -> dict[str, Any]:
    items = (
        _list_namespaced(KUEUE_GROUP, KUEUE_VERSION, "localqueues", namespace)
        if namespace
        else _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "localqueues")
    )
    return {
        "items": [
            {
                "name": q.get("metadata", {}).get("name"),
                "namespace": q.get("metadata", {}).get("namespace"),
                "clusterQueue": q.get("spec", {}).get("clusterQueue"),
                "pendingWorkloads": q.get("status", {}).get("pendingWorkloads", 0),
                "admittedWorkloads": q.get("status", {}).get("admittedWorkloads", 0),
                "defaultQueue": (q.get("metadata", {}).get("annotations") or {}).get("kueue.x-k8s.io/default-queue")
                == "true",
            }
            for q in items
        ]
    }


@router.post("/api/kueue/localqueues")
def create_localqueue(req: LocalQueueRequest) -> dict[str, Any]:
    body = {
        "apiVersion": f"{KUEUE_GROUP}/{KUEUE_VERSION}",
        "kind": "LocalQueue",
        "metadata": {
            "name": req.name,
            "namespace": req.namespace,
            "labels": {"app.kubernetes.io/part-of": "gpu-for-vms-with-kueue"},
            "annotations": {"kueue.x-k8s.io/default-queue": "true"} if req.defaultQueue else {},
        },
        "spec": {"clusterQueue": req.clusterQueue},
    }
    try:
        created = custom.create_namespaced_custom_object(
            KUEUE_GROUP, KUEUE_VERSION, req.namespace, "localqueues", body
        )
        return {
            "item": {
                "name": created.get("metadata", {}).get("name"),
                "namespace": created.get("metadata", {}).get("namespace"),
                "clusterQueue": created.get("spec", {}).get("clusterQueue"),
                "defaultQueue": req.defaultQueue,
                "pendingWorkloads": 0,
                "admittedWorkloads": 0,
            }
        }
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.put("/api/kueue/localqueues/{namespace}/{name}")
def replace_localqueue(namespace: str, name: str, req: LocalQueueRequest) -> dict[str, Any]:
    if req.name != name or req.namespace != namespace:
        raise HTTPException(status_code=400, detail="Nome e namespace da LocalQueue não podem ser alterados")
    try:
        current = custom.get_namespaced_custom_object(KUEUE_GROUP, KUEUE_VERSION, namespace, "localqueues", name)
        annotations = dict(current.get("metadata", {}).get("annotations") or {})
        if req.defaultQueue:
            annotations["kueue.x-k8s.io/default-queue"] = "true"
        else:
            annotations.pop("kueue.x-k8s.io/default-queue", None)
        patched = custom.patch_namespaced_custom_object(
            KUEUE_GROUP,
            KUEUE_VERSION,
            namespace,
            "localqueues",
            name,
            {"metadata": {"annotations": annotations}, "spec": {"clusterQueue": req.clusterQueue}},
            _content_type="application/merge-patch+json",
        )
        return {
            "item": {
                "name": patched.get("metadata", {}).get("name"),
                "namespace": patched.get("metadata", {}).get("namespace"),
                "clusterQueue": patched.get("spec", {}).get("clusterQueue"),
                "defaultQueue": req.defaultQueue,
                "pendingWorkloads": patched.get("status", {}).get("pendingWorkloads", 0),
                "admittedWorkloads": patched.get("status", {}).get("admittedWorkloads", 0),
            }
        }
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.delete("/api/kueue/localqueues/{namespace}/{name}")
def delete_localqueue(namespace: str, name: str) -> dict[str, str]:
    try:
        custom.delete_namespaced_custom_object(KUEUE_GROUP, KUEUE_VERSION, namespace, "localqueues", name)
        return {"status": "deleted"}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.get("/api/kueue/flavors")
def list_flavors() -> dict[str, Any]:
    return {
        "items": [
            {
                "name": f.get("metadata", {}).get("name"),
                "nodeLabels": (f.get("spec") or {}).get("nodeLabels") or {},
                "topologyName": (f.get("spec") or {}).get("topologyName"),
            }
            for f in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "resourceflavors")
        ]
    }


@router.post("/api/kueue/flavors")
def create_flavor(req: FlavorRequest) -> dict[str, Any]:
    body = {
        "apiVersion": f"{KUEUE_GROUP}/{KUEUE_VERSION}",
        "kind": "ResourceFlavor",
        "metadata": {
            "name": req.name,
            "labels": {"app.kubernetes.io/part-of": "gpu-for-vms-with-kueue"},
        },
        "spec": {"nodeLabels": req.nodeLabels} if req.nodeLabels else {},
    }
    try:
        created = custom.create_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "resourceflavors", body)
        return {
            "item": {
                "name": created.get("metadata", {}).get("name"),
                "nodeLabels": (created.get("spec") or {}).get("nodeLabels") or {},
            }
        }
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.put("/api/kueue/flavors/{name}")
def replace_flavor(name: str, req: FlavorRequest) -> dict[str, Any]:
    if req.name != name:
        raise HTTPException(status_code=400, detail="O nome do ResourceFlavor não pode ser alterado")
    try:
        current = custom.get_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "resourceflavors", name)
        spec = dict(current.get("spec") or {})
        spec["nodeLabels"] = req.nodeLabels
        patched = custom.patch_cluster_custom_object(
            KUEUE_GROUP,
            KUEUE_VERSION,
            "resourceflavors",
            name,
            {"spec": spec},
            _content_type="application/merge-patch+json",
        )
        return {
            "item": {
                "name": patched.get("metadata", {}).get("name"),
                "nodeLabels": (patched.get("spec") or {}).get("nodeLabels") or {},
            }
        }
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.delete("/api/kueue/flavors/{name}")
def delete_flavor(name: str) -> dict[str, str]:
    try:
        custom.delete_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "resourceflavors", name)
        return {"status": "deleted", "name": name}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.get("/api/kueue/integrations")
def get_integrations() -> dict[str, Any]:
    cr = _get_kueue_cr()
    frameworks = (((cr or {}).get("spec") or {}).get("config") or {}).get("integrations", {}).get("frameworks") or []
    return {"frameworks": frameworks, "knownFrameworks": KNOWN_FRAMEWORKS, "available": bool(cr)}


@router.put("/api/kueue/integrations")
def set_integrations(req: IntegrationsRequest) -> dict[str, Any]:
    cr = _get_kueue_cr()
    if not cr:
        raise HTTPException(status_code=404, detail="Kueue CR cluster não encontrada")
    name = cr.get("metadata", {}).get("name") or "cluster"
    frameworks = [item for item in req.frameworks if item]
    if "Pod" not in frameworks:
        raise HTTPException(status_code=400, detail="A integração Pod é obrigatória para virt-launcher / KubeVirt")
    try:
        custom.patch_cluster_custom_object(
            OPENSHIFT_KUEUE_GROUP,
            "v1",
            "kueues",
            name,
            {"spec": {"config": {"integrations": {"frameworks": frameworks}}}},
            _content_type="application/merge-patch+json",
        )
        return {"frameworks": frameworks}
    except ApiException as exc:
        raise _api_error(exc) from exc


@router.get("/api/kueue/permissions")
def get_permissions() -> dict[str, Any]:
    return {"checks": _permission_checks()}


@router.post("/api/kueue/permissions/kubevirt")
def grant_kubevirt_permissions() -> dict[str, Any]:
    try:
        _apply_kubevirt_permissions()
        return {"status": "ok", "checks": _permission_checks()}
    except ApiException as exc:
        raise _api_error(exc) from exc
