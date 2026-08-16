# GPU for VMs with Kueue

PatternFly UI and cluster bootstrap for reserving NVIDIA GPUs with Kueue and launching OpenShift Virtualization VMs that request those GPUs in `resources.requests` and `resources.limits`.

## What gets created

- Kueue ServiceAccount rights on KubeVirt (`virtualmachines`, `virtualmachineinstances`, virt-launcher pods) and `use` of the `kubevirt-controller` SCC
- ResourceFlavors `gpu-pool` / `vm-flavor` (reused if they already exist)
- Reserved ClusterQueues + LocalQueue `gpu-reserved`
- Namespace `gpu-vms` labeled `kueue.openshift.io/managed=true`
- Fedora VM template `fedora-server-gpu-kueue`
- HyperConverged `permittedHostDevices` for `nvidia.com/gpu` and MIG resources
- PatternFly console at Route `gpu-vm-console`
- OpenShift Console plugin: **GPU Booking → Special Bookings for VMs**

## Deploy on the connected cluster

```bash
oc login ...
./hack/deploy.sh
```

Cluster resources only:

```bash
./hack/install-cluster.sh
```

Local UI (proxies `/api` to the backend):

```bash
cd ui && npm install && npm run start:dev
cd backend && pip install -r requirements.txt && uvicorn app:app --port 8080
```
