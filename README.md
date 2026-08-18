# GPU for VMs with Kueue

Consola PatternFly + API FastAPI para reservar GPUs NVIDIA com Kueue e lançar VMs do OpenShift Virtualization que pedem essas GPUs em `resources.requests` e `resources.limits`. Inclui Queue Manager, Scheduler Manager, Topology-Aware Scheduling e WorkloadPriorityClasses, e um plugin da consola OpenShift.

Namespace da aplicação: `gpu-vm-kueue` (não deve ser gerido pelo Kueue).  
Namespaces de workload típicos: `gpu-vms`, `user-user1`, `user-user2`.

---

## O que sobe no cluster

| Artefacto | Nome |
| --- | --- |
| Namespace da app | `gpu-vm-kueue` |
| Namespace de VMs | `gpu-vms` (rótulo `kueue.openshift.io/managed=true`) |
| ResourceFlavors | `gpu-pool`, `vm-flavor` (reutiliza se já existirem) |
| ClusterQueues de reserva | `gpuvm-gpu-vms`, `gpuvm-user-user1` |
| LocalQueues | `default` e `gpu-reserved` em `gpu-vms`; `gpu-reserved` em `user-user1` |
| RBAC Kueue → KubeVirt | `kueue-kubevirt-integration`, SCC `kubevirt-controller` |
| RBAC da consola | ClusterRole `gpu-vm-console` (queues, flavors, topologies, priority classes, VMs, Jobs) |
| Deployment + Route | `gpu-vm-console` |
| Plugin da consola | `gpu-vm-kueue-plugin` |
| Template de VM | `fedora-server-gpu-kueue` |
| HyperConverged | `permittedHostDevices` para `nvidia.com/gpu` e MIG |

A ClusterQueue partilhada `default` do cluster **não** é criada nem apagada por estes manifests.

---

## Pré-requisitos

No cluster (já presentes no workshop Red Hat):

1. OpenShift 4.21 (ou compatível) e `oc` autenticado como admin.
2. Red Hat Kueue Operator (`openshift-kueue-operator`) com a CR `kueues.kueue.openshift.io/cluster`.
3. OpenShift Virtualization (`openshift-cnv`) e DataSource `fedora` em `openshift-virtualization-os-images`.
4. GPUs alocáveis nos nodes (`nvidia.com/gpu` e/ou MIG). Podem ser fake (Run:ai).
5. Node.js 20+ e Python 3.11 na máquina de onde corre o build (só para `npm` / Vite / webpack).

Confirme os operators:

```bash
oc get kueue.kueue.openshift.io cluster
oc get hyperconverged -n openshift-cnv
oc get datasource fedora -n openshift-virtualization-os-images
oc get nodes -o json | jq -r '.items[] | "\(.metadata.name) gpu=\(.status.allocatable["nvidia.com/gpu"] // 0)"'
```

Integração **Pod** no Kueue CR é obrigatória para virt-launcher. Se faltar, active-a depois no Scheduler Manager da UI, ou:

```bash
oc patch kueue.kueue.openshift.io cluster --type merge -p '{"spec":{"config":{"integrations":{"frameworks":["Pod","Deployment","StatefulSet","PyTorchJob","RayCluster","RayJob","TrainJob"]}}}}'
```

---

## 1. Login

```bash
oc login -u admin -p '<password>' https://api.<cluster>:6443/ --insecure-skip-tls-verify=true
oc whoami
```

Clone o repositório e trabalhe na raiz:

```bash
git clone <url-deste-repo>
cd gpu-for-vms-with-kueue
```

---

## 2. Bootstrap do cluster (RBAC, flavors, filas, template)

Aplica namespaces, permissões do controller Kueue no KubeVirt, ResourceFlavors, ClusterQueues de reserva, LocalQueues, template de VM, RBAC da consola, rótulos Kueue nos namespaces de workload e `permittedHostDevices` no HyperConverged.

```bash
./hack/install-cluster.sh
```

Equivalente manual:

```bash
oc apply -f deploy/namespace.yaml
oc apply -f deploy/kueue-kubevirt-rbac.yaml
oc apply -f deploy/resourceflavor.yaml
oc apply -f deploy/clusterqueue-reservation.yaml
oc apply -f deploy/localqueue.yaml
oc apply -f deploy/vm-template.yaml
oc apply -f deploy/app-rbac.yaml

for ns in gpu-vms user-user1 user-user2; do
  oc get namespace "${ns}" >/dev/null 2>&1 && \
    oc label namespace "${ns}" kueue.openshift.io/managed=true kueue-managed=true --overwrite
done
```

Não marque `gpu-vm-kueue` nem namespaces `openshift-*` / `kube-*` com `kueue.openshift.io/managed=true`.

---

## 3. Build da UI PatternFly

A imagem da consola copia `ui/dist`. Se `npx` falhar no ambiente, use o binário local.

```bash
cd ui
npm install
./node_modules/.bin/vite build
cd ..
```

Tem de existir `ui/dist/index.html` no fim deste passo.

---

## 4. Imagem e Deployment da consola (`gpu-vm-console`)

Não envie o repositório inteiro no `start-build`: `node_modules` torna o upload enorme e o build lento. Use um contexto slim (Dockerfile + backend + `ui/dist`).

```bash
NS=gpu-vm-kueue

oc get is gpu-vm-console -n "${NS}" >/dev/null 2>&1 || oc create imagestream gpu-vm-console -n "${NS}"
oc get bc gpu-vm-console -n "${NS}" >/dev/null 2>&1 || oc new-build --name=gpu-vm-console --binary --strategy=docker -n "${NS}"

CTX="$(mktemp -d)"
cp Dockerfile "${CTX}/Dockerfile"
mkdir -p "${CTX}/backend" "${CTX}/ui"
cp backend/*.py backend/requirements.txt "${CTX}/backend/"
cp -R ui/dist "${CTX}/ui/dist"

oc start-build gpu-vm-console -n "${NS}" --from-dir="${CTX}" --follow --wait
rm -rf "${CTX}"

oc apply -f deploy/app.yaml
oc set image deployment/gpu-vm-console -n "${NS}" \
  console="image-registry.openshift-image-registry.svc:5000/${NS}/gpu-vm-console:latest"

# O ImageStream pode actualizar sem criar ReplicaSet novo — force o rollout.
oc rollout restart deployment/gpu-vm-console -n "${NS}"
oc rollout status deployment/gpu-vm-console -n "${NS}" --timeout=180s

oc get route gpu-vm-console -n "${NS}"
```

A Route fica em:

`https://gpu-vm-console-gpu-vm-kueue.apps.<cluster>/`

Abra `/api/health` — deve devolver `{"status":"ok"}`.

---

## 5. Plugin da consola OpenShift

O plugin (React 17, SDK 4.21) embebe a app em iframe (`?embed=1`) e adiciona:

- **GPU Booking → Special Bookings for VMs** (`/gpu-booking/vms`)
- **Kueue Manager → Queue Manager** (`/kueue-manager/queues`)
- **Kueue Manager → Scheduler Manager** (`/kueue-manager/scheduler`)

```bash
NS=gpu-vm-kueue

cd console-plugin
npm install
./node_modules/.bin/webpack --config webpack.config.cjs --mode=production
cd ..

oc get is gpu-vm-kueue-plugin -n "${NS}" >/dev/null 2>&1 || oc create imagestream gpu-vm-kueue-plugin -n "${NS}"
oc get bc gpu-vm-kueue-plugin -n "${NS}" >/dev/null 2>&1 || oc new-build --name=gpu-vm-kueue-plugin --binary --strategy=docker -n "${NS}"

PLUGIN_CTX="$(mktemp -d)"
cp console-plugin/Dockerfile "${PLUGIN_CTX}/Dockerfile"
cp -R console-plugin/dist "${PLUGIN_CTX}/dist"

oc start-build gpu-vm-kueue-plugin -n "${NS}" --from-dir="${PLUGIN_CTX}" --follow --wait
rm -rf "${PLUGIN_CTX}"

oc apply -f deploy/console-plugin.yaml
oc set image deployment/gpu-vm-kueue-plugin -n "${NS}" \
  plugin="image-registry.openshift-image-registry.svc:5000/${NS}/gpu-vm-kueue-plugin:latest"
oc rollout restart deployment/gpu-vm-kueue-plugin -n "${NS}"
oc rollout status deployment/gpu-vm-kueue-plugin -n "${NS}" --timeout=180s
```

---

## 6. Activar o plugin e recarregar a consola OpenShift

```bash
oc patch consoles.operator.openshift.io cluster --type json -p '[
  {"op":"add","path":"/spec/plugins/-","value":"gpu-vm-kueue-plugin"}
]' 2>/dev/null || \
python3 - <<'PY'
import json, subprocess
cfg = json.loads(subprocess.check_output(["oc", "get", "consoles.operator.openshift.io", "cluster", "-o", "json"], text=True))
plugins = list(cfg.get("spec", {}).get("plugins") or [])
if "gpu-vm-kueue-plugin" not in plugins:
    plugins.append("gpu-vm-kueue-plugin")
    subprocess.run(
        ["oc", "patch", "consoles.operator.openshift.io", "cluster", "--type", "merge",
         "-p", json.dumps({"spec": {"plugins": plugins}})],
        check=True,
    )
    print("Enabled gpu-vm-kueue-plugin")
else:
    print("Already enabled")
PY

oc rollout restart deployment/console -n openshift-console
oc rollout status deployment/console -n openshift-console --timeout=180s
```

Faça hard-refresh do browser (ou janela anónima). Sem este restart, o menu **Kueue Manager** não aparece.

---

## 7. Verificar

```bash
oc get pods -n gpu-vm-kueue
oc get route gpu-vm-console -n gpu-vm-kueue
oc get consoleplugin gpu-vm-kueue-plugin
oc get consoles.operator.openshift.io cluster -o jsonpath='{.spec.plugins}{"\n"}'

oc get resourceflavor gpu-pool vm-flavor
oc get clusterqueue gpuvm-gpu-vms gpuvm-user-user1
oc get localqueue -n gpu-vms
oc get clusterrolebinding kueue-kubevirt-integration kueue-use-kubevirt-controller-scc
```

Smoke da API:

```bash
HOST="$(oc get route gpu-vm-console -n gpu-vm-kueue -o jsonpath='{.spec.host}')"
curl -sk "https://${HOST}/api/health"
curl -sk "https://${HOST}/api/kueue/dashboard" | jq '{operator, topologies, priorityClasses}'
curl -sk "https://${HOST}/api/kueue/topologies" | jq '.items[].name'
curl -sk "https://${HOST}/api/kueue/priority-classes" | jq '.items[].name'
```

---

## Depois do deploy: o que usar na UI

**Standalone:** `https://gpu-vm-console-gpu-vm-kueue.apps.<cluster>/`

**Consola OpenShift:** perspectiva Admin.

| Sítio | Função |
| --- | --- |
| GPU Booking → Special Bookings for VMs | Reservas de GPU e VMs Fedora (iframe da app) |
| Kueue Manager → Queue Manager | Namespaces, ClusterQueues, LocalQueues, ResourceFlavors, Topology (TAS), Priority classes |
| Kueue Manager → Scheduler Manager | Operator, integrações (Pod obrigatória), RBAC Kueue↔KubeVirt, resumo TAS/prioridade |

No Queue Manager:

- **Namespaces** — ligar/desligar `kueue.openshift.io/managed`; classe de prioridade default + **Aplicar** aos workloads existentes.
- **Topology (TAS)** — CRUD de `Topology`, árvore zona→hostname, ligar a um ResourceFlavor. `topologyName` no flavor torna o spec **imutável**.
- **Priority classes** — CRUD de `WorkloadPriorityClass` e associação a namespaces geridos. VMs criadas nesta UI herdam `kueue.x-k8s.io/priority-class`.

A Topology `default` e a classe `high-priority` podem já existir no cluster (instalação GPU/Kueue). Não é obrigatório recriá-las.

---

## Rebuild incremental (depois de mudar código)

Só backend/UI da app:

```bash
(cd ui && ./node_modules/.bin/vite build)
NS=gpu-vm-kueue
CTX="$(mktemp -d)"
cp Dockerfile "${CTX}/Dockerfile"
mkdir -p "${CTX}/backend" "${CTX}/ui"
cp backend/*.py backend/requirements.txt "${CTX}/backend/"
cp -R ui/dist "${CTX}/ui/dist"
oc start-build gpu-vm-console -n "${NS}" --from-dir="${CTX}" --follow --wait
rm -rf "${CTX}"
oc rollout restart deployment/gpu-vm-console -n "${NS}"
oc rollout status deployment/gpu-vm-console -n "${NS}" --timeout=180s
```

Só plugin (novas rotas/menus da consola OpenShift). Abas internas do Queue Manager **não** exigem rebuild do plugin.

```bash
NS=gpu-vm-kueue
(cd console-plugin && ./node_modules/.bin/webpack --config webpack.config.cjs --mode=production)
PLUGIN_CTX="$(mktemp -d)"
cp console-plugin/Dockerfile "${PLUGIN_CTX}/Dockerfile"
cp -R console-plugin/dist "${PLUGIN_CTX}/dist"
oc start-build gpu-vm-kueue-plugin -n "${NS}" --from-dir="${PLUGIN_CTX}" --follow --wait
rm -rf "${PLUGIN_CTX}"
oc rollout restart deployment/gpu-vm-kueue-plugin -n "${NS}"
oc rollout restart deployment/console -n openshift-console
```

RBAC novo (`deploy/app-rbac.yaml`):

```bash
oc apply -f deploy/app-rbac.yaml
```

---

## Atalho: `./hack/deploy.sh`

Corre `install-cluster.sh`, `npm run build` da UI, `start-build` da consola **a partir da raiz do repo**, deploy do plugin e patch do Console CR.

Limitações conhecidas:

- `--from-dir` da raiz envia `node_modules` se existir — prefira o contexto slim da secção 4.
- Depois do ImageStream `:latest`, force `oc rollout restart deployment/gpu-vm-console -n gpu-vm-kueue`.
- Reinicie `deployment/console -n openshift-console` para o menu do plugin aparecer.

---

## Desenvolvimento local (sem rebuild de imagem)

Com `oc` apontado ao cluster:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8080 --reload
```

Noutro terminal:

```bash
cd ui
npm install
npm run start:dev
```

O Vite corre em `http://127.0.0.1:9000` e faz proxy de `/api` para `localhost:8080`.

---

## Notas

- Não apague a ClusterQueue `default` pela UI (está protegida).
- Não gira o namespace `gpu-vm-kueue` com Kueue: é onde corre a consola.
- TAS: depois de definir `spec.topologyName` num ResourceFlavor, labels e topologia ficam imutáveis. Para activar TAS nas VMs GPU, ligue `gpu-pool` à Topology `default` (já usada por `default-flavor`).
- WorkloadPriorityClass não tem default nativo por namespace. A UI grava a anotação `gpu-vm-kueue.io/default-priority-class` e aplica o rótulo `kueue.x-k8s.io/priority-class` às VMs novas e, se pedir, aos workloads já existentes.
- Credenciais `oc login` do workshop expiram; volte a autenticar se a API da consola devolver 401.
