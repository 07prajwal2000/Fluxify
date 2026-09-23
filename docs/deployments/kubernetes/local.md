---
title: Develop against a local cluster
description: For people changing Fluxify's code. Run Fluxify from a checkout and its workers on a local k3d cluster, step by step, and the four mistakes that look like something else.
---

# Develop against a local cluster

> [!IMPORTANT]
> **This page is for people changing Fluxify's own code.** To install Fluxify
> on a cluster, follow [Install on Kubernetes](./install) instead.

This walks you from an empty [k3d](https://k3d.io) cluster to a claim running
as a pod, with Fluxify itself (admin, the orchestrator, NATS, Postgres, Valkey)
running from your checkout. Only the workers run in the cluster, so a code
change to admin or the orchestrator needs no image build.

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

### Optional: change claims with kubectl

To change claims with `kubectl` or a GitOps tool as well as the portal, install
the `NodeClaim` definition once. Skip it and the portal is the only way in.

```bash
kubectl apply -f https://raw.githubusercontent.com/Fluxify-rest/Fluxify/main/deploy/helm/fluxify/crds/nodeclaim.crd.yaml
```

See [Changing claims from Kubernetes](./#nodeclaim) for how it behaves.

## 3. Give the orchestrator an account

k3d's own kubeconfig signs in with a certificate. The orchestrator signs in with
a token, so create a service account with only the access it needs. It comes
from Fluxify's Helm chart, so it always matches what the chart installs:

```bash
helm repo add nats https://nats-io.github.io/k8s/helm/charts/
helm repo add valkey https://valkey.io/valkey-helm/
helm dependency build deploy/helm/fluxify
helm template fluxify deploy/helm/fluxify -n default   --set postgres.bundled=true --show-only templates/rbac.yaml | kubectl apply -f -
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

## 9. Scale on a Kafka topic (optional)

To see a workflow claim grow on an outside queue, start the single Kafka broker
from the compose file. It is advertised as `host.k3d.internal:9092`, so admin,
the workers and KEDA all reach it at the same address:

```bash
docker compose --profile kafka up -d kafka
```

1. Add a **Kafka** integration with brokers `host.k3d.internal:9092`.
2. Add a Kafka trigger on a topic (tick *Create missing topics*) in a group
   that a workflow claim runs, and attach a workflow.
3. Check that KEDA got a scaler and its authentication:

```bash
kubectl get scaledobject,triggerauthentication -l fluxify.managed-by=orchestrator
```

4. Send more messages than the workflow keeps up with. The claim grows with
   the consumer group's lag, up to the topic's 3 partitions unless the trigger
   has *Scale past the partition count* on.

## When it does not work

| What you see | Usually |
| :--- | :--- |
| Pods in `ErrImagePull` / `ImagePullBackOff` | Step 5: the image was not imported. |
| Pods start and immediately restart | Step 6: workers cannot reach NATS or Valkey. |
| Orchestrator stops at startup | Step 4 port, or step 3 token expired. |
| Claim never grows past its minimum | Step 2: KEDA is not installed. |
| Workflow claim grows on CPU, not on waiting runs | `K8S_NATS_MONITORING_ENDPOINT` is not set. |
| Kafka claim stops growing at 3 pods | The topic has 3 partitions; see *Scale past the partition count*. |

To start over: `k3d cluster delete fluxify`.
