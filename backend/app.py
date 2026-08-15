#!/usr/bin/env python3
"""API for GPU reservations (Kueue) and GPU VirtualMachines (KubeVirt)."""

from __future__ import annotations

import os
import secrets
import string
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from kubernetes import client, config
from kubernetes.client.rest import ApiException
from pydantic import BaseModel, Field

KUEUE_GROUP = "kueue.x-k8s.io"
KUEUE_VERSION = "v1beta2"
KUBEVIRT_GROUP = "kubevirt.io"
KUBEVIRT_VERSION = "v1"
HCO_GROUP = "hco.kubevirt.io"
APP_LABEL = "gpu-vm-kueue.io/reservation"
GPU_RESOURCES = (
    "nvidia.com/gpu",
    "nvidia.com/mig-1g.23gb",
    "nvidia.com/mig-2g.47gb",
    "nvidia.com/mig-3g.93gb",
    "nvidia.com/mig-7g.189gb",
)
STATIC_DIR = Path(__file__).parent / "static"


def load_kube() -> None:
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()


load_kube()
core = client.CoreV1Api()
apps = client.AppsV1Api()
rbac = client.RbacAuthorizationV1Api()
custom = client.CustomObjectsApi()
api_client = custom.api_client

app = FastAPI(title="GPU VMs with Kueue", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReservationRequest(BaseModel):
    namespace: str
    gpu_resource: str = "nvidia.com/gpu"
    gpu_count: int = Field(ge=0, le=64)
    cpu: str = "8"
    memory: str = "32Gi"


class VirtualMachineRequest(BaseModel):
    namespace: str
    name: str
    queue: str = "default"
    gpu_resource: str = "nvidia.com/gpu"
    gpu_count: int = Field(ge=1, le=8)
    cpu: str = "1"
    memory: str = "2Gi"
    run_strategy: str = "Always"


class VmActionRequest(BaseModel):
    action: str


def _api_error(exc: ApiException) -> HTTPException:
    detail = exc.reason
    try:
        body = exc.body
        if isinstance(body, bytes):
            body = body.decode()
        detail = str(body)[:800]
    except Exception:
        pass
    return HTTPException(status_code=exc.status or 500, detail=detail)


def _list_cluster(group: str, version: str, plural: str) -> list[dict[str, Any]]:
    try:
        result = custom.list_cluster_custom_object(group, version, plural)
        return result.get("items", [])
    except ApiException as exc:
        if exc.status == 404 and version == KUEUE_VERSION:
            result = custom.list_cluster_custom_object(group, "v1beta1", plural)
            return result.get("items", [])
        raise


def _list_namespaced(group: str, version: str, plural: str, namespace: str) -> list[dict[str, Any]]:
    result = custom.list_namespaced_custom_object(group, version, namespace, plural)
    return result.get("items", [])


def _get(group: str, version: str, plural: str, name: str, namespace: str | None = None) -> dict[str, Any]:
    if namespace:
        return custom.get_namespaced_custom_object(group, version, namespace, plural, name)
    return custom.get_cluster_custom_object(group, version, plural, name)


def _qty(value: Any) -> int:
    if value is None:
        return 0
    text = str(value)
    try:
        return int(text)
    except ValueError:
        return 0


def _flavor_resource_map(cq: dict[str, Any], field: str) -> dict[str, int]:
    totals: dict[str, int] = {}
    for flavor in cq.get("status", {}).get(field, []) or []:
        for res in flavor.get("resources", []) or []:
            name = res.get("name")
            if name:
                totals[name] = totals.get(name, 0) + _qty(res.get("total") or 0)
    return totals


def _quota_map(cq: dict[str, Any]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for group in cq.get("spec", {}).get("resourceGroups", []) or []:
        for flavor in group.get("flavors", []) or []:
            for res in flavor.get("resources", []) or []:
                name = res.get("name")
                if name:
                    totals[name] = totals.get(name, 0) + _qty(res.get("nominalQuota") or 0)
    return totals


def _gpu_from_vm(vm: dict[str, Any]) -> dict[str, str]:
    resources = (
        vm.get("spec", {})
        .get("template", {})
        .get("spec", {})
        .get("domain", {})
        .get("resources", {})
    )
    requests = resources.get("requests") or {}
    limits = resources.get("limits") or {}
    found: dict[str, str] = {}
    for name in list(requests) + list(limits):
        if "gpu" in name.lower() or name.startswith("nvidia.com/"):
            found[name] = str(requests.get(name) or limits.get(name) or "0")
    return found


def _password() -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(12))


def _reservation_cq_name(namespace: str) -> str:
    return f"gpuvm-{namespace}"


def _ensure_namespace(namespace: str) -> None:
    try:
        core.read_namespace(namespace)
        core.patch_namespace(
            namespace,
            {
                "metadata": {
                    "labels": {
                        "kueue.openshift.io/managed": "true",
                        "kueue-managed": "true",
                    }
                }
            },
        )
    except ApiException as exc:
        if exc.status != 404:
            raise
        core.create_namespace(
            client.V1Namespace(
                metadata=client.V1ObjectMeta(
                    name=namespace,
                    labels={
                        "kueue.openshift.io/managed": "true",
                        "kueue-managed": "true",
                        "app.kubernetes.io/part-of": "gpu-for-vms-with-kueue",
                    },
                    annotations={
                        "openshift.io/display-name": f"GPU VMs ({namespace})",
                    },
                )
            )
        )


def _clusterqueue_body(namespace: str, gpu_resource: str, gpu_count: int, cpu: str, memory: str) -> dict[str, Any]:
    gpu_quotas = {name: "0" for name in GPU_RESOURCES}
    if gpu_resource not in gpu_quotas:
        gpu_quotas[gpu_resource] = str(gpu_count)
    else:
        gpu_quotas[gpu_resource] = str(gpu_count)
    covered = ["cpu", "memory", *GPU_RESOURCES]
    if gpu_resource not in covered:
        covered.append(gpu_resource)
    flavor_resources = [
        {"name": "cpu", "nominalQuota": cpu},
        {"name": "memory", "nominalQuota": memory},
    ]
    for name, qty in gpu_quotas.items():
        flavor_resources.append({"name": name, "nominalQuota": qty})
    if gpu_resource not in gpu_quotas:
        flavor_resources.append({"name": gpu_resource, "nominalQuota": str(gpu_count)})
    return {
        "apiVersion": f"{KUEUE_GROUP}/{KUEUE_VERSION}",
        "kind": "ClusterQueue",
        "metadata": {
            "name": _reservation_cq_name(namespace),
            "labels": {
                APP_LABEL: "true",
                "gpu-vm-kueue.io/namespace": namespace,
                "app.kubernetes.io/part-of": "gpu-for-vms-with-kueue",
            },
        },
        "spec": {
            "cohortName": "unreserved",
            "namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": namespace}},
            "queueingStrategy": "BestEffortFIFO",
            "resourceGroups": [
                {
                    "coveredResources": covered,
                    "flavors": [{"name": "gpu-pool", "resources": flavor_resources}],
                }
            ],
        },
    }


def _localqueue_body(namespace: str) -> dict[str, Any]:
    return {
        "apiVersion": f"{KUEUE_GROUP}/{KUEUE_VERSION}",
        "kind": "LocalQueue",
        "metadata": {
            "name": "gpu-reserved",
            "namespace": namespace,
            "labels": {"app.kubernetes.io/part-of": "gpu-for-vms-with-kueue"},
        },
        "spec": {"clusterQueue": _reservation_cq_name(namespace)},
    }


def _vm_body(req: VirtualMachineRequest, password: str) -> dict[str, Any]:
    gpu = {req.gpu_resource: str(req.gpu_count)}
    return {
        "apiVersion": f"{KUBEVIRT_GROUP}/{KUBEVIRT_VERSION}",
        "kind": "VirtualMachine",
        "metadata": {
            "name": req.name,
            "namespace": req.namespace,
            "labels": {
                "app": req.name,
                "gpu-vm-kueue.io/managed": "true",
                "kueue.x-k8s.io/queue-name": req.queue,
                "vm.kubevirt.io/template": "fedora-server-gpu-kueue",
            },
        },
        "spec": {
            "runStrategy": req.run_strategy,
            "dataVolumeTemplates": [
                {
                    "apiVersion": "cdi.kubevirt.io/v1beta1",
                    "kind": "DataVolume",
                    "metadata": {"name": req.name},
                    "spec": {
                        "sourceRef": {
                            "kind": "DataSource",
                            "name": "fedora",
                            "namespace": "openshift-virtualization-os-images",
                        },
                        "storage": {"resources": {"requests": {"storage": "30Gi"}}},
                    },
                }
            ],
            "template": {
                "metadata": {
                    "labels": {
                        "kubevirt.io/domain": req.name,
                        "kubevirt.io/size": "small",
                        "kueue.x-k8s.io/queue-name": req.queue,
                        "gpu-vm-kueue.io/managed": "true",
                        "network.kubevirt.io/headlessService": "headless",
                    }
                },
                "spec": {
                    "domain": {
                        "cpu": {"cores": 1, "sockets": 1, "threads": 1},
                        "devices": {
                            "disks": [
                                {"name": "rootdisk", "disk": {"bus": "virtio"}},
                                {"name": "cloudinitdisk", "disk": {"bus": "virtio"}},
                            ],
                            "interfaces": [{"name": "default", "masquerade": {}, "model": "virtio"}],
                            "rng": {},
                        },
                        "machine": {"type": "q35"},
                        "memory": {"guest": req.memory},
                        "resources": {
                            "requests": {"cpu": req.cpu, "memory": req.memory, **gpu},
                            "limits": {"cpu": req.cpu, "memory": req.memory, **gpu},
                        },
                    },
                    "networks": [{"name": "default", "pod": {}}],
                    "subdomain": "headless",
                    "terminationGracePeriodSeconds": 180,
                    "volumes": [
                        {"name": "rootdisk", "dataVolume": {"name": req.name}},
                        {
                            "name": "cloudinitdisk",
                            "cloudInitNoCloud": {
                                "userData": (
                                    "#cloud-config\n"
                                    "user: fedora\n"
                                    f"password: {password}\n"
                                    "chpasswd: { expire: False }\n"
                                    "ssh_pwauth: True\n"
                                )
                            },
                        },
                    ],
                },
            },
        },
    }


def _summarize_reservation(cq: dict[str, Any]) -> dict[str, Any]:
    meta = cq.get("metadata", {})
    spec = cq.get("spec", {})
    status = cq.get("status", {})
    quotas = _quota_map(cq)
    usage = _flavor_resource_map(cq, "flavorsUsage")
    reserved = _flavor_resource_map(cq, "flavorsReservation")
    gpu_quota = {k: v for k, v in quotas.items() if k in GPU_RESOURCES or "gpu" in k.lower()}
    ns = (meta.get("labels") or {}).get("gpu-vm-kueue.io/namespace")
    selector = ((spec.get("namespaceSelector") or {}).get("matchLabels") or {}).get("kubernetes.io/metadata.name")
    return {
        "name": meta.get("name"),
        "namespace": ns or selector,
        "cohort": spec.get("cohortName"),
        "managed": (meta.get("labels") or {}).get(APP_LABEL) == "true",
        "quota": quotas,
        "gpuQuota": gpu_quota,
        "usage": usage,
        "reservation": reserved,
        "admittedWorkloads": status.get("admittedWorkloads", 0),
        "pendingWorkloads": status.get("pendingWorkloads", 0),
        "active": next(
            (
                c.get("status") == "True"
                for c in status.get("conditions", []) or []
                if c.get("type") == "Active"
            ),
            False,
        ),
    }


def _summarize_vm(vm: dict[str, Any]) -> dict[str, Any]:
    meta = vm.get("metadata", {})
    spec = vm.get("spec", {})
    status = vm.get("status", {})
    labels = meta.get("labels") or {}
    template_labels = spec.get("template", {}).get("metadata", {}).get("labels") or {}
    return {
        "name": meta.get("name"),
        "namespace": meta.get("namespace"),
        "status": status.get("printableStatus") or "Unknown",
        "ready": bool(status.get("ready")),
        "queue": labels.get("kueue.x-k8s.io/queue-name")
        or template_labels.get("kueue.x-k8s.io/queue-name"),
        "gpus": _gpu_from_vm(vm),
        "runStrategy": spec.get("runStrategy") or (spec.get("running") and "Always") or "Halted",
        "creationTimestamp": meta.get("creationTimestamp"),
        "managed": labels.get("gpu-vm-kueue.io/managed") == "true",
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/overview")
def overview() -> dict[str, Any]:
    nodes = core.list_node().items
    node_capacity: dict[str, int] = {}
    node_allocatable: dict[str, int] = {}
    gpu_nodes = []
    for node in nodes:
        cap = node.status.capacity or {}
        alloc = node.status.allocatable or {}
        labels = node.metadata.labels or {}
        gpus = {
            k: str(v)
            for k, v in alloc.items()
            if k in GPU_RESOURCES or "gpu" in k.lower()
        }
        for key, val in cap.items():
            if key in GPU_RESOURCES or "gpu" in key.lower():
                node_capacity[key] = node_capacity.get(key, 0) + _qty(val)
        for key, val in alloc.items():
            if key in GPU_RESOURCES or "gpu" in key.lower():
                node_allocatable[key] = node_allocatable.get(key, 0) + _qty(val)
        gpu_nodes.append(
            {
                "name": node.metadata.name,
                "product": labels.get("nvidia.com/gpu.product"),
                "fake": labels.get("run.ai/fake.gpu") == "true",
                "pool": labels.get("run.ai/simulated-gpu-node-pool"),
                "allocatable": gpus,
                "gpuCountLabel": labels.get("nvidia.com/gpu.count"),
            }
        )

    queues = [_summarize_reservation(cq) for cq in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues")]
    quota_total: dict[str, int] = {}
    usage_total: dict[str, int] = {}
    for queue in queues:
        for key, val in queue["gpuQuota"].items():
            quota_total[key] = quota_total.get(key, 0) + val
        for key, val in queue["usage"].items():
            if key in GPU_RESOURCES or "gpu" in key.lower():
                usage_total[key] = usage_total.get(key, 0) + val

    vms = [_summarize_vm(vm) for vm in _list_cluster(KUBEVIRT_GROUP, KUBEVIRT_VERSION, "virtualmachines")]
    gpu_vms = [vm for vm in vms if vm["gpus"]]
    workloads = _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "workloads")
    admitted = sum(
        1
        for wl in workloads
        if any(c.get("type") == "Admitted" and c.get("status") == "True" for c in (wl.get("status", {}).get("conditions") or []))
    )
    pending = sum(1 for wl in workloads if not wl.get("status", {}).get("admission"))
    return {
        "nodes": gpu_nodes,
        "capacity": node_capacity,
        "allocatable": node_allocatable,
        "quota": quota_total,
        "usage": usage_total,
        "virtualMachines": len(vms),
        "gpuVirtualMachines": len(gpu_vms),
        "runningGpuVirtualMachines": sum(1 for vm in gpu_vms if vm["status"] == "Running"),
        "workloads": len(workloads),
        "admittedWorkloads": admitted,
        "pendingWorkloads": pending,
        "reservations": sum(1 for q in queues if q["managed"]),
    }


@app.get("/api/setup")
def setup_status() -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "ok": ok, "detail": detail})

    try:
        deploy = apps.read_namespaced_deployment("kueue-controller-manager", "openshift-kueue-operator")
        ready = deploy.status.ready_replicas or 0
        add("Kueue operator", ready > 0, f"{ready} replica(s) ready")
    except ApiException as exc:
        add("Kueue operator", False, exc.reason)

    try:
        kv = custom.get_namespaced_custom_object(
            KUBEVIRT_GROUP, KUBEVIRT_VERSION, "openshift-cnv", "kubevirts", "kubevirt-kubevirt-hyperconverged"
        )
        add("OpenShift Virtualization", kv.get("status", {}).get("phase") == "Deployed", kv.get("status", {}).get("phase", "unknown"))
    except ApiException as exc:
        add("OpenShift Virtualization", False, exc.reason)

    try:
        hco = custom.get_namespaced_custom_object(
            HCO_GROUP, "v1beta1", "openshift-cnv", "hyperconvergeds", "kubevirt-hyperconverged"
        )
        pci = (hco.get("spec", {}).get("permittedHostDevices") or {}).get("pciHostDevices") or []
        names = {item.get("resourceName") for item in pci}
        add("HyperConverged GPU allowlist", "nvidia.com/gpu" in names, ", ".join(sorted(n for n in names if n)) or "empty")
    except ApiException as exc:
        add("HyperConverged GPU allowlist", False, exc.reason)

    try:
        rbac.read_cluster_role_binding("kueue-kubevirt-integration")
        add("Kueue ServiceAccount KubeVirt RBAC", True, "kueue-kubevirt-integration bound")
    except ApiException:
        add("Kueue ServiceAccount KubeVirt RBAC", False, "clusterrolebinding missing")

    try:
        rbac.read_cluster_role_binding("kueue-use-kubevirt-controller-scc")
        add("Kueue can use kubevirt-controller SCC", True, "SCC use granted")
    except ApiException:
        add("Kueue can use kubevirt-controller SCC", False, "binding missing")

    flavors = [f.get("metadata", {}).get("name") for f in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "resourceflavors")]
    add("ResourceFlavor gpu-pool", "gpu-pool" in flavors, ", ".join(flavors))
    add("ResourceFlavor vm-flavor", "vm-flavor" in flavors, ", ".join(flavors))

    queues = [q.get("metadata", {}).get("name") for q in _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues")]
    add("ClusterQueue default", "default" in queues, ", ".join(queues))

    gpu_nodes = [
        n.metadata.name
        for n in core.list_node().items
        if (n.status.allocatable or {}).get("nvidia.com/gpu") and str((n.status.allocatable or {}).get("nvidia.com/gpu")) != "0"
    ]
    add("Nodes with allocatable GPUs", bool(gpu_nodes), ", ".join(gpu_nodes) or "none")

    return {"checks": checks}


@app.get("/api/namespaces")
def namespaces() -> dict[str, Any]:
    items = []
    for ns in core.list_namespace().items:
        labels = ns.metadata.labels or {}
        if labels.get("kueue.openshift.io/managed") == "true" or ns.metadata.name in {"gpu-vms", "user-user1", "user-user2"}:
            items.append(
                {
                    "name": ns.metadata.name,
                    "displayName": (ns.metadata.annotations or {}).get("openshift.io/display-name") or ns.metadata.name,
                    "managed": labels.get("kueue.openshift.io/managed") == "true",
                }
            )
    return {"items": items}


@app.get("/api/gpu-resources")
def gpu_resources() -> dict[str, Any]:
    found: dict[str, int] = {}
    for node in core.list_node().items:
        alloc = node.status.allocatable or {}
        for key, val in alloc.items():
            if key in GPU_RESOURCES or "gpu" in key.lower() or key.startswith("nvidia.com/"):
                found[key] = found.get(key, 0) + _qty(val)
    items = [{"name": name, "allocatable": qty} for name, qty in sorted(found.items())]
    if not items:
        items = [{"name": name, "allocatable": 0} for name in GPU_RESOURCES]
    return {"items": items}


@app.get("/api/localqueues")
def localqueues(namespace: str | None = None) -> dict[str, Any]:
    if namespace:
        items = _list_namespaced(KUEUE_GROUP, KUEUE_VERSION, "localqueues", namespace)
    else:
        items = _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "localqueues")
    return {
        "items": [
            {
                "name": q.get("metadata", {}).get("name"),
                "namespace": q.get("metadata", {}).get("namespace"),
                "clusterQueue": q.get("spec", {}).get("clusterQueue"),
                "pendingWorkloads": q.get("status", {}).get("pendingWorkloads", 0),
                "admittedWorkloads": q.get("status", {}).get("admittedWorkloads", 0),
            }
            for q in items
        ]
    }


@app.get("/api/reservations")
def list_reservations() -> dict[str, Any]:
    queues = _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues")
    items = [_summarize_reservation(q) for q in queues]
    return {"items": items}


@app.post("/api/reservations")
def create_reservation(req: ReservationRequest) -> dict[str, Any]:
    if req.gpu_resource not in GPU_RESOURCES and "gpu" not in req.gpu_resource:
        raise HTTPException(status_code=400, detail="gpu_resource must be an NVIDIA GPU resource")
    try:
        _ensure_namespace(req.namespace)
        body = _clusterqueue_body(req.namespace, req.gpu_resource, req.gpu_count, req.cpu, req.memory)
        name = body["metadata"]["name"]
        try:
            custom.get_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
            custom.patch_cluster_custom_object(
                KUEUE_GROUP,
                KUEUE_VERSION,
                "clusterqueues",
                name,
                body,
                _content_type="application/merge-patch+json",
            )
            cq = custom.get_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
        except ApiException as exc:
            if exc.status != 404:
                raise
            cq = custom.create_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", body)
        lq = _localqueue_body(req.namespace)
        try:
            custom.get_namespaced_custom_object(KUEUE_GROUP, KUEUE_VERSION, req.namespace, "localqueues", "gpu-reserved")
            custom.patch_namespaced_custom_object(
                KUEUE_GROUP,
                KUEUE_VERSION,
                req.namespace,
                "localqueues",
                "gpu-reserved",
                lq,
                _content_type="application/merge-patch+json",
            )
        except ApiException as exc:
            if exc.status != 404:
                raise
            custom.create_namespaced_custom_object(KUEUE_GROUP, KUEUE_VERSION, req.namespace, "localqueues", lq)
        try:
            custom.get_namespaced_custom_object(KUEUE_GROUP, KUEUE_VERSION, req.namespace, "localqueues", "default")
        except ApiException as exc:
            if exc.status == 404:
                custom.create_namespaced_custom_object(
                    KUEUE_GROUP,
                    KUEUE_VERSION,
                    req.namespace,
                    "localqueues",
                    {
                        "apiVersion": f"{KUEUE_GROUP}/{KUEUE_VERSION}",
                        "kind": "LocalQueue",
                        "metadata": {
                            "name": "default",
                            "namespace": req.namespace,
                            "annotations": {"kueue.x-k8s.io/default-queue": "true"},
                        },
                        "spec": {"clusterQueue": "default"},
                    },
                )
            elif exc.status != 404:
                raise
        return {"item": _summarize_reservation(cq)}
    except ApiException as exc:
        raise _api_error(exc) from exc


@app.delete("/api/reservations/{name}")
def delete_reservation(name: str) -> dict[str, str]:
    try:
        cq = custom.get_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
        namespace = (cq.get("metadata", {}).get("labels") or {}).get("gpu-vm-kueue.io/namespace")
        custom.delete_cluster_custom_object(KUEUE_GROUP, KUEUE_VERSION, "clusterqueues", name)
        if namespace:
            try:
                custom.delete_namespaced_custom_object(
                    KUEUE_GROUP, KUEUE_VERSION, namespace, "localqueues", "gpu-reserved"
                )
            except ApiException as exc:
                if exc.status != 404:
                    raise
        return {"status": "deleted", "name": name}
    except ApiException as exc:
        raise _api_error(exc) from exc


@app.get("/api/vms")
def list_vms(namespace: str | None = None) -> dict[str, Any]:
    if namespace:
        items = _list_namespaced(KUBEVIRT_GROUP, KUBEVIRT_VERSION, "virtualmachines", namespace)
    else:
        items = _list_cluster(KUBEVIRT_GROUP, KUBEVIRT_VERSION, "virtualmachines")
    return {"items": [_summarize_vm(vm) for vm in items]}


@app.post("/api/vms")
def create_vm(req: VirtualMachineRequest) -> dict[str, Any]:
    if not req.name or any(c in req.name for c in "/_ "):
        raise HTTPException(status_code=400, detail="Invalid VM name")
    password = _password()
    try:
        _ensure_namespace(req.namespace)
        body = _vm_body(req, password)
        created = custom.create_namespaced_custom_object(
            KUBEVIRT_GROUP, KUBEVIRT_VERSION, req.namespace, "virtualmachines", body
        )
        item = _summarize_vm(created)
        item["username"] = "fedora"
        item["password"] = password
        return {"item": item}
    except ApiException as exc:
        raise _api_error(exc) from exc


@app.post("/api/vms/{namespace}/{name}/action")
def vm_action(namespace: str, name: str, req: VmActionRequest) -> dict[str, str]:
    if req.action not in {"start", "stop", "restart"}:
        raise HTTPException(status_code=400, detail="action must be start, stop or restart")
    path = f"/apis/subresources.kubevirt.io/v1/namespaces/{namespace}/virtualmachines/{name}/{req.action}"
    try:
        api_client.call_api(
            path,
            "PUT",
            header_params={"Content-Type": "application/json", "Accept": "application/json"},
            body={},
            auth_settings=["BearerToken"],
            response_type=object,
            _return_http_data_only=True,
        )
        return {"status": "ok", "action": req.action}
    except ApiException as exc:
        raise _api_error(exc) from exc


@app.delete("/api/vms/{namespace}/{name}")
def delete_vm(namespace: str, name: str) -> dict[str, str]:
    try:
        custom.delete_namespaced_custom_object(
            KUBEVIRT_GROUP, KUBEVIRT_VERSION, namespace, "virtualmachines", name
        )
        return {"status": "deleted"}
    except ApiException as exc:
        raise _api_error(exc) from exc


@app.get("/api/workloads")
def list_workloads(namespace: str | None = None) -> dict[str, Any]:
    if namespace:
        items = _list_namespaced(KUEUE_GROUP, KUEUE_VERSION, "workloads", namespace)
    else:
        items = _list_cluster(KUEUE_GROUP, KUEUE_VERSION, "workloads")
    summarized = []
    for wl in items:
        status = wl.get("status", {})
        conditions = {c.get("type"): c for c in status.get("conditions") or []}
        podsets = status.get("admission", {}).get("podSetAssignments") or []
        resources: dict[str, str] = {}
        for assignment in podsets:
            flavors = assignment.get("flavors") or {}
            usage = assignment.get("resourceUsage") or {}
            for key, val in {**flavors, **usage}.items():
                if isinstance(val, dict):
                    continue
                resources[str(key)] = str(val)
            for flavor_usage in assignment.get("flavors") and [] or []:
                pass
            ru = assignment.get("resourceUsage") or {}
            for key, val in ru.items():
                resources[key] = str(val)
        summarized.append(
            {
                "name": wl.get("metadata", {}).get("name"),
                "namespace": wl.get("metadata", {}).get("namespace"),
                "queue": wl.get("spec", {}).get("queueName"),
                "admitted": conditions.get("Admitted", {}).get("status") == "True",
                "finished": conditions.get("Finished", {}).get("status") == "True",
                "quotaReserved": conditions.get("QuotaReserved", {}).get("status") == "True",
                "clusterQueue": (status.get("admission") or {}).get("clusterQueue"),
                "resources": resources,
                "creationTimestamp": wl.get("metadata", {}).get("creationTimestamp"),
            }
        )
    return {"items": summarized}


if STATIC_DIR.is_dir():
    assets = STATIC_DIR / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        index = STATIC_DIR / "index.html"
        if index.is_file():
            return FileResponse(index)
        raise HTTPException(status_code=404, detail="UI not built")
