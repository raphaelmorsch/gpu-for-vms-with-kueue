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
