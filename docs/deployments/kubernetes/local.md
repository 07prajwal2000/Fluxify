---
title: Kubernetes on your machine
description: Run Fluxify's workers on a local k3d cluster, step by step, and the four mistakes that look like something else.
---

# Kubernetes on your machine

This walks you from an empty [k3d](https://k3d.io) cluster to a claim running
as a pod. Fluxify itself (admin, the orchestrator, NATS, Postgres, Valkey)
runs on your machine as usual; only the workers run in the cluster.

Several steps below are easy to skip, and each one fails in a way that looks
like a different problem. Each step says what goes wrong without it.

## What you need

- Docker, `kubectl`, [k3d](https://k3d.io) and [Helm](https://helm.sh)
- A Fluxify checkout that runs locally ([Getting started](/getting-started/))

## 1. Create the cluster

```bash
k3d cluster create fluxify -p "8090:80@loadbalancer"
```

k3d ships Traefik and Metrics Server, so nothing else is needed for routing or
CPU measurement. Port `8090` on your machine now reaches Traefik in the
cluster.

## 2. Install KEDA

A fresh cluster has no KEDA. Without it every claim runs at its minimum and
never grows. Workers still run, so it is easy to miss.

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda -n keda --create-namespace
```

## 3. Give the orchestrator an account

k3d's own kubeconfig signs in with a certificate. The orchestrator signs in with
a token, so create a service account with only the access it needs:

```yaml
# fluxify-orchestrator.yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: fluxify-orchestrator
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: fluxify-orchestrator
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "watch", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["services", "secrets"]
    verbs: ["get", "list", "create", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["traefik.io"]
    resources: ["ingressroutes"]
    verbs: ["get", "list", "create", "patch", "delete"]
  - apiGroups: ["keda.sh"]
    resources: ["scaledobjects"]
    verbs: ["get", "list", "create", "patch", "delete"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: fluxify-orchestrator
subjects:
  - kind: ServiceAccount
    name: fluxify-orchestrator
roleRef:
  kind: Role
  name: fluxify-orchestrator
  apiGroup: rbac.authorization.k8s.io
```

```bash
kubectl apply -f fluxify-orchestrator.yaml
kubectl create token fluxify-orchestrator --duration=24h
```

The same account and role work in a real cluster; only the namespace changes.

## 4. Find the cluster's address and certificate

k3d does not expose the API on `6443`. It picks a random port, so read the
real address from your kubeconfig:

```bash
kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}'
# e.g. https://127.0.0.1:52943

kubectl config view --minify --raw \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' \
  | base64 -d > k3d-ca.crt
```

## 5. Put the worker image in the cluster

The cluster cannot see images on your machine. Build the worker and import it,
or its pods sit in `ErrImagePull` forever and the orchestrator reports that they
failed to start:

```bash
docker build -f docker/worker-compiled/Dockerfile -t fluxify-worker:dev .
k3d image import fluxify-worker:dev -c fluxify
```

A published image (`ghcr.io/fluxify-rest/fluxify-worker:alpha`) needs no
import, since the cluster pulls it itself.

## 6. Point workers at a NATS they can reach

Workers get their NATS and Valkey addresses from the orchestrator. Inside a pod,
`localhost` is the pod itself, so a worker told `nats://localhost:4222` cannot
connect and exits right away. That shows up as a crash loop with no useful log.
**Check this first when pods start and die.**

From inside a k3d cluster your machine is `host.k3d.internal`. Use that name,
and make it resolve on your machine too, since the orchestrator uses the same
addresses:

```
# hosts file (/etc/hosts, or C:\Windows\System32\drivers\etc\hosts)
127.0.0.1 host.k3d.internal
```

## 7. Start Fluxify and the orchestrator

Start the usual local services and admin:

```bash
docker compose up -d postgres valkey nats
bun run dev:server
```

Then the orchestrator, with these on top of your `.env`:

```bash
ORCHESTRATOR_PROVIDER=kubernetes
ORCHESTRATOR_WORKER_IMAGE=fluxify-worker:dev
K8S_API_URL=https://127.0.0.1:52943      # from step 4
K8S_SA_TOKEN=<token from step 3>
K8S_CA_CERT=./k3d-ca.crt
K8S_NAMESPACE=default
K8S_NATS_MONITORING_ENDPOINT=host.k3d.internal:8222
NATS_URL=nats://host.k3d.internal:4222
REDIS_HOST=host.k3d.internal
```

```bash
bun run --env-file=.env apps/server/deployments/orchestrator.ts
```

If the cluster cannot be reached, the orchestrator stops and says what is
missing. Usually it is the port from step 4 or an expired token from step 3.

## 8. See a claim become a pod

Make a claim from a project's settings (or use the one every fresh instance
starts with), then:

```bash
kubectl get deploy,pods,scaledobject -l fluxify.managed-by=orchestrator
```

Within a few seconds there is a Deployment named `fluxify-worker-<claim id>`
and its pods reach `Running`. The Orchestration page in instance settings now
lists them as pods. A claim that serves APIs answers through Traefik:

```bash
curl -H "Host: <your project's domain>" http://localhost:8090/
```

## When it does not work

| What you see | Usually |
| :--- | :--- |
| Pods in `ErrImagePull` / `ImagePullBackOff` | Step 5: the image was not imported. |
| Pods start and immediately restart | Step 6: workers cannot reach NATS or Valkey. |
| Orchestrator stops at startup | Step 4 port, or step 3 token expired. |
| Claim never grows past its minimum | Step 2: KEDA is not installed. |
| Workflow claim grows on CPU, not on waiting runs | `K8S_NATS_MONITORING_ENDPOINT` is not set. |

To start over: `k3d cluster delete fluxify`.
