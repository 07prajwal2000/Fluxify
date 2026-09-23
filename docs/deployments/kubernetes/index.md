---
title: Production on Kubernetes
description: Run Fluxify's workers on a Kubernetes cluster. What you configure, what the orchestrator creates in your cluster for each claim, and how workers are sized and autoscaled.
---

# Production on Kubernetes

Fluxify can run its workers on a Kubernetes cluster instead of on one Docker
host. You still describe what you want the same way: a **claim** says which
project a set of workers serves, what they run, and how many of them. The
orchestrator turns each claim into ordinary Kubernetes objects and keeps them
in line with what you asked for.

> [!TIP]
> Trying it out? [Kubernetes on your machine](./local) goes from an empty k3d
> cluster to a running worker, including the access the orchestrator needs.

## Docker or Kubernetes?

| | **Docker** | **Kubernetes** |
| :--- | :--- | :--- |
| **Where workers run** | Containers on one Docker host | Pods spread over your cluster's machines |
| **Scaling** | Fixed number of workers per claim | Grows and shrinks between a minimum and a maximum, on load |
| **Credentials** | Passed to each container as settings | Kept in Kubernetes Secrets |
| **Guide** | [Production Setup →](../production) | This page |

Your claims, projects and data are the same on both. Moving from one to the
other is a change to the orchestrator's settings, not to your database.

## What you need

- **A Kubernetes cluster** you can create objects in, and one namespace for
  Fluxify's workers.
- **Traefik** as the cluster's edge, with its own route type installed. Many
  distributions ship it (k3s and k3d do). Without it, workers still run, but
  no HTTP traffic reaches them.
- **KEDA** for autoscaling. Without it, every claim simply runs at its minimum
  size — nothing else breaks, and the orchestrator says so once in its log.
- **Metrics Server**, so the cluster can measure CPU and memory use. Most
  distributions include it.
- **NATS reachable from the cluster**, at an address the pods can resolve.
  `localhost` inside a pod is the pod itself, not your machine.

## Connecting the orchestrator

Tell the orchestrator which platform it drives:

| Setting | What it is |
| :--- | :--- |
| `ORCHESTRATOR_PROVIDER` | `kubernetes` to run workers on a cluster, `docker` for one Docker host. Default: `docker`. |

It is never guessed. An orchestrator that runs inside a cluster can still be
pointed at a Docker host on purpose. If the platform you picked cannot be
reached when it starts, the orchestrator stops and says what is missing.

Running the orchestrator **inside the cluster**, it finds the cluster on its
own, using the service account it runs as. Nothing to set. That account needs
the role shown in [the local setup](./local#_3-give-the-orchestrator-an-account),
and nothing more — it never needs access outside its namespace.

Running it **outside the cluster**, tell it where the cluster is:

| Setting | What it is |
| :--- | :--- |
| `K8S_API_URL` | The cluster's API address, e.g. `https://127.0.0.1:6443`. |
| `K8S_SA_TOKEN` | A service account token the orchestrator signs in with. |
| `K8S_NAMESPACE` | The namespace workers are created in. Default: `default`. |
| `K8S_CA_CERT` | Path to the certificate that signed your cluster's, for clusters with their own (k3d, most self-hosted ones). The certificate is always checked; there is no way to turn that off. |

Two more settings shape how workers scale:

| Setting | What it is |
| :--- | :--- |
| `K8S_NATS_MONITORING_ENDPOINT` | NATS's monitoring address as reachable from the cluster, e.g. `nats.fluxify.svc:8222`. Needed for workers to scale on how many workflow runs are waiting. Unset, they scale on CPU and memory only. |
| `ORCHESTRATOR_SCALE_CPU_PERCENT` | Average CPU use, as a percent of a worker's CPU, above which more workers start. Default: `65`. |
| `ORCHESTRATOR_SCALE_MEMORY_PERCENT` | The same, for memory. Default: `65`. |

## Changing workers by hand

The orchestrator keeps every object it created matching your claims. If you
edit one of them directly (with `kubectl edit`, for example), your change is
put back within a few seconds, and deleting one makes it come back. Change the
claim instead. A manual `kubectl scale` is undone by the autoscaler.

## Sizing a worker {#sizing}

Every claim says how much CPU and memory **each** of its workers may use.
Workloads differ — an API serving small requests and a queue crunching reports
need different amounts — so this is set per claim, not once for everything.

| | Steps of | Range | Default |
| :--- | :--- | :--- | :--- |
| **CPU** | 0.5 core | 0.5 – 16 | 1 core |
| **Memory** | 256 MB | 256 – 65 536 MB | 1024 MB |

Set it on the claim: **CPU per pod** and **Memory per pod** in the claim form,
in a project's settings or on the instance's Orchestration page.

On Kubernetes a worker is guaranteed exactly this much and never uses more.
The autoscaler measures CPU and memory use against these numbers, so they also
decide when a claim grows. The same setting applies on Docker, as the
container's limit.

## What a claim becomes in your cluster {#objects}

Each claim becomes a handful of objects, all named after the claim —
`fluxify-worker-<claim id>` — and all labelled
`fluxify.managed-by=orchestrator`. Nothing without that label is ever read,
changed or deleted.

| Object | When | What it does |
| :--- | :--- | :--- |
| **Deployment** | Always | Runs the claim's workers. Every worker is identical; its pod name is its identity. |
| **Service** | Claims that serve APIs | One stable address in front of the claim's ready workers. |
| **IngressRoute** (Traefik) | Claims that serve APIs | Sends traffic in: a project's own domain for a project's claim, and every other request to the claim that serves all projects. |
| **ScaledObject** (KEDA) | Always, when KEDA is installed | Grows and shrinks the Deployment between the claim's minimum and maximum. |

Two kinds of **Secret** keep credentials out of those objects:

- `fluxify-worker-env` holds the settings every worker copies from the
  orchestrator — the NATS address, the encryption key, log shipping. Change
  one of those and the workers restart to pick it up.
- `fluxify-trigger-<trigger id>` holds one trigger's connection details, for
  triggers that read from an outside queue.

A useful way to look at everything Fluxify runs:

```bash
kubectl get deploy,svc,ingressroute,scaledobject,pods -l fluxify.managed-by=orchestrator
```

> [!IMPORTANT]
> **Change claims, not the objects.** The orchestrator rewrites these objects
> every few seconds to match your claims, so an edit made with `kubectl`
> is undone on the next pass. In particular, `kubectl scale` has no lasting
> effect — the autoscaler owns the worker count.

## How a claim scales {#scaling}

A claim has a **minimum** and a **maximum** number of workers, both set in
the claim form. A maximum equal to the minimum means the claim runs exactly
that many and never grows. On Docker the form shows only one number, since
Docker does not autoscale.

What makes it grow depends on what it runs:

| Claim | Grows when |
| :--- | :--- |
| A project's **workflow** workers | Runs are waiting on any of its triggers. Each worker takes on about as many waiting runs as the instance's *queued per node* setting, and the busiest trigger decides. |
| Workers that serve **APIs**, or **both** | CPU or memory use is above the targets above. |
| Workers that serve **every project** | CPU or memory use is above the targets above. |

Growing happens as soon as it is needed. Shrinking waits until the load has
stayed low for the instance's *scale-down window* (five minutes by default), so
a short lull does not stop workers you are about to need again. A worker that
is removed first stops taking new requests, then finishes what it is running.

The maximum is a ceiling, never a promise. A claim never grows past what your
node pool and license leave room for, however high its maximum is set:
workers beyond the license would only be refused when they start.

### The scaling policy {#scaling-policy}

How quickly claims grow and shrink is one policy for the whole instance, set
under **Instance settings → Orchestration → Scaling policy** (shown only when
the orchestrator drives a cluster):

| Setting | What it does | Default |
| :--- | :--- | :--- |
| **Queued runs per pod** | A workflow claim adds a worker each time this many runs are waiting on one of its triggers. | 10 |
| **Check every** | How often waiting runs are counted. | 30 s |
| **Scale-down wait** | How long the load must stay low before a worker is removed. | 300 s |

### What needs what

- **KEDA** is required for any growth at all. Without it, every claim runs at
  its minimum.
- **Scaling on waiting runs** also needs `K8S_NATS_MONITORING_ENDPOINT`.
  Without it, workflow claims fall back to CPU and memory.
- A claim that serves **every project** always scales on CPU and memory. To
  scale on its queues it would have to watch every trigger in the instance.
  Treat it as a starting point; give a busy project its own claim.
