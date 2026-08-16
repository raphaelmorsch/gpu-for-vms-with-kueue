#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NS="${NS:-gpu-vm-kueue}"

"${ROOT}/hack/install-cluster.sh"

echo "==> Building PatternFly UI"
(cd "${ROOT}/ui" && npm install && npm run build)

echo "==> OpenShift docker build from local sources"
if ! oc get is gpu-vm-console -n "${NS}" >/dev/null 2>&1; then
  oc create imagestream gpu-vm-console -n "${NS}"
fi
if ! oc get buildconfig gpu-vm-console -n "${NS}" >/dev/null 2>&1; then
  oc new-build --name=gpu-vm-console --binary --strategy=docker -n "${NS}"
fi

oc start-build gpu-vm-console -n "${NS}" --from-dir="${ROOT}" --follow --wait

echo "==> Deploying console"
oc apply -f "${ROOT}/deploy/app.yaml"
oc set image deployment/gpu-vm-console -n "${NS}" \
  console="image-registry.openshift-image-registry.svc:5000/${NS}/gpu-vm-console:latest"
oc rollout status deployment/gpu-vm-console -n "${NS}" --timeout=180s

HOST="$(oc get route gpu-vm-console -n "${NS}" -o jsonpath='{.spec.host}')"
echo
echo "Console: https://${HOST}"

echo "==> Building OpenShift console plugin (GPU Booking submenu)"
(cd "${ROOT}/console-plugin" && npm install && npm run build)

if ! oc get is gpu-vm-kueue-plugin -n "${NS}" >/dev/null 2>&1; then
  oc create imagestream gpu-vm-kueue-plugin -n "${NS}"
fi
if ! oc get buildconfig gpu-vm-kueue-plugin -n "${NS}" >/dev/null 2>&1; then
  oc new-build --name=gpu-vm-kueue-plugin --binary --strategy=docker -n "${NS}"
fi

PLUGIN_CTX="$(mktemp -d)"
cp "${ROOT}/console-plugin/Dockerfile" "${PLUGIN_CTX}/Dockerfile"
cp -R "${ROOT}/console-plugin/dist" "${PLUGIN_CTX}/dist"
oc start-build gpu-vm-kueue-plugin -n "${NS}" --from-dir="${PLUGIN_CTX}" --follow --wait
rm -rf "${PLUGIN_CTX}"

echo "==> Deploying console plugin under GPU Booking"
oc apply -f "${ROOT}/deploy/console-plugin.yaml"
oc set image deployment/gpu-vm-kueue-plugin -n "${NS}" \
  plugin="image-registry.openshift-image-registry.svc:5000/${NS}/gpu-vm-kueue-plugin:latest"
oc rollout status deployment/gpu-vm-kueue-plugin -n "${NS}" --timeout=180s

python3 - <<'PY'
import json, subprocess
cfg = json.loads(subprocess.check_output(["oc", "get", "consoles.operator.openshift.io", "cluster", "-o", "json"], text=True))
plugins = list(cfg.get("spec", {}).get("plugins") or [])
name = "gpu-vm-kueue-plugin"
if name not in plugins:
    plugins.append(name)
    subprocess.run(
        ["oc", "patch", "consoles.operator.openshift.io", "cluster", "--type", "merge", "-p", json.dumps({"spec": {"plugins": plugins}})],
        check=True,
    )
    print("Enabled console plugin", name)
else:
    print("Console plugin already enabled:", name)
PY

echo
echo "OpenShift Console: GPU Booking → Special Bookings for VMs"
