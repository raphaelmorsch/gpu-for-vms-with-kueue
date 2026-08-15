#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KUEUE_NS="${KUEUE_NS:-openshift-kueue-operator}"
CNV_NS="${CNV_NS:-openshift-cnv}"

echo "==> Applying namespaces, RBAC, flavors, queues and VM template"
oc apply -f "${ROOT}/deploy/namespace.yaml"
oc apply -f "${ROOT}/deploy/kueue-kubevirt-rbac.yaml"
oc apply -f "${ROOT}/deploy/resourceflavor.yaml"
oc apply -f "${ROOT}/deploy/clusterqueue-reservation.yaml"
oc apply -f "${ROOT}/deploy/localqueue.yaml"
oc apply -f "${ROOT}/deploy/vm-template.yaml"
oc apply -f "${ROOT}/deploy/app-rbac.yaml"

echo "==> Labeling workload namespaces for Kueue"
for ns in gpu-vms user-user1 user-user2; do
  if oc get namespace "${ns}" >/dev/null 2>&1; then
    oc label namespace "${ns}" kueue.openshift.io/managed=true kueue-managed=true --overwrite
  fi
done

echo "==> Marking default LocalQueues for LocalQueue defaulting"
for ns in gpu-vms user-user1 user-user2 maas; do
  if oc get localqueue default -n "${ns}" >/dev/null 2>&1; then
    oc annotate localqueue default -n "${ns}" kueue.x-k8s.io/default-queue=true --overwrite
  fi
done

echo "==> Ensuring HyperConverged permits nvidia.com/gpu and MIG resources"
python3 - <<'PY'
import json, subprocess, sys

def oc_json(*args):
    return json.loads(subprocess.check_output(["oc", *args], text=True))

hco = oc_json("get", "hyperconverged", "kubevirt-hyperconverged", "-n", "openshift-cnv", "-o", "json")
spec = hco.setdefault("spec", {})
phd = spec.setdefault("permittedHostDevices", {})
pci = phd.setdefault("pciHostDevices", [])
mdev = phd.setdefault("mediatedDevices", [])

wanted_pci = {
    "nvidia.com/gpu": {"externalResourceProvider": True, "pciDeviceSelector": "10DE:26B9", "resourceName": "nvidia.com/gpu"}
}
wanted_mdev = {
    "nvidia.com/mig-1g.23gb": {"externalResourceProvider": True, "mdevNameSelector": "nvidia-mig-1g.23gb", "resourceName": "nvidia.com/mig-1g.23gb"},
    "nvidia.com/mig-2g.47gb": {"externalResourceProvider": True, "mdevNameSelector": "nvidia-mig-2g.47gb", "resourceName": "nvidia.com/mig-2g.47gb"},
    "nvidia.com/mig-3g.93gb": {"externalResourceProvider": True, "mdevNameSelector": "nvidia-mig-3g.93gb", "resourceName": "nvidia.com/mig-3g.93gb"},
    "nvidia.com/mig-7g.189gb": {"externalResourceProvider": True, "mdevNameSelector": "nvidia-mig-7g.189gb", "resourceName": "nvidia.com/mig-7g.189gb"},
}

changed = False
have_pci = {i.get("resourceName") for i in pci}
for name, item in wanted_pci.items():
    if name not in have_pci:
        pci.append(item)
        changed = True
have_mdev = {i.get("resourceName") for i in mdev}
for name, item in wanted_mdev.items():
    if name not in have_mdev:
        mdev.append(item)
        changed = True

fg = spec.setdefault("featureGates", {})
if not fg.get("withHostPassthroughCPU", False):
    fg["withHostPassthroughCPU"] = True
    changed = True

if changed:
    subprocess.run(
        ["oc", "patch", "hyperconverged", "kubevirt-hyperconverged", "-n", "openshift-cnv", "--type", "merge", "-p", json.dumps({"spec": spec})],
        check=True,
    )
    print("HyperConverged patched with GPU permittedHostDevices")
else:
    print("HyperConverged already permits GPU and MIG devices")
PY

echo "==> Cluster GPU/Kueue/KubeVirt bootstrap complete"
oc get clusterrolebinding kueue-kubevirt-integration kueue-use-kubevirt-controller-scc
oc get resourceflavor gpu-pool vm-flavor
oc get clusterqueue gpuvm-gpu-vms gpuvm-user-user1
oc get localqueue -n gpu-vms
oc get localqueue -n user-user1
