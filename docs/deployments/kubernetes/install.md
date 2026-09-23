---
title: Install on Kubernetes
description: Install Fluxify on a Kubernetes cluster step by step, from an empty cluster to signing in, including everything the cluster needs first.
---

# Install on Kubernetes

This page takes you from a Kubernetes cluster to a running Fluxify you can sign
in to. Follow the steps in order. Each one says how to check it worked, so a
problem shows up at the step that caused it.

It takes about 15 minutes, most of it waiting for things to start.

> [!TIP]
> Want to know what Fluxify does in your cluster once it runs? See
> [How it works on Kubernetes](./). Changing Fluxify's own code? See
> [Develop against a local cluster](./local).

## What gets installed

| Part | What it is | Where it comes from |
| :--- | :--- | :--- |
| **Fluxify** | The portal, the API, and the orchestrator that starts your workers. | Step 6 |
| **Workers** | The pods that run your APIs and workflows. You never install these: Fluxify starts them from your claims. | Fluxify |
| **NATS** | The message bus between Fluxify and its workers. | Step 6, with Fluxify |
| **Valkey** | A cache. | Step 6, with Fluxify |
| **Postgres** | The database holding everything you build. | Step 5 |
| **Traefik** | Sends web traffic into the cluster, to the portal and your APIs. | Step 2 |
| **KEDA** | Adds and removes workers as load changes. | Step 3 |
| **Metrics Server** | Measures CPU and memory, which KEDA scales on. | Step 4 |

## Before you start

You need:

- **A Kubernetes cluster** where you may create
  namespaces. A managed one ([EKS](https://aws.amazon.com/eks/),
  [GKE](https://cloud.google.com/kubernetes-engine),
  [AKS](https://azure.microsoft.com/products/kubernetes-service)) or your own
  ([k3s](https://k3s.io)). To try Fluxify on your laptop, [k3d](https://k3d.io)
  makes one in a minute:

  ```bash
  k3d cluster create fluxify -p "8080:80@loadbalancer"
  ```

- **[kubectl](https://kubernetes.io/docs/tasks/tools/)**, pointed at that
  cluster. Check it with `kubectl get nodes`.
- **[Helm](https://helm.sh/docs/intro/install/)** 3.8 or newer. Check it with
  `helm version`.

## 1. See what your cluster already has

Some clusters come with parts of steps 2 to 4 already installed. k3s and k3d,
for example, ship Traefik and Metrics Server. Run these three checks:

```bash
kubectl get crd ingressroutes.traefik.io   # Traefik
kubectl get crd scaledobjects.keda.sh      # KEDA
kubectl top nodes                          # Metrics Server
```

A check that prints a result means that part is installed: skip its step. An
error such as `NotFound` or `Metrics API not available` means do the step.

On a cluster you just created, k3s and k3d are still installing their own
Traefik and Metrics Server for about a minute. Wait a minute and check again
before installing a second copy.

## 2. Install Traefik

Traefik is the front door: every request to the portal and to your APIs goes
through it. Without it everything runs, but nothing can be reached from outside.

```bash
helm repo add traefik https://traefik.github.io/charts
helm repo update traefik
helm install traefik traefik/traefik -n traefik --create-namespace
```

More options, such as HTTPS certificates: [Traefik's Kubernetes guide](https://doc.traefik.io/traefik/getting-started/install-traefik/).

**Check:** `kubectl get crd ingressroutes.traefik.io` prints one line.

## 3. Install KEDA

KEDA adds workers when load goes up and removes them when it goes down. Without
it, every claim stays at its minimum number of workers.

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm repo update kedacore
helm install keda kedacore/keda -n keda --create-namespace
```

More options: [KEDA's install guide](https://keda.sh/docs/latest/deploy/).

**Check:** `kubectl get pods -n keda` shows every pod `Running`.

## 4. Install Metrics Server

Metrics Server measures how much CPU and memory each pod uses. KEDA needs it to
scale on load.

```bash
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
```

More options: [Metrics Server's guide](https://github.com/kubernetes-sigs/metrics-server#installation).

**Check:** after a minute, `kubectl top nodes` prints CPU and memory figures.

## 5. Get a Postgres database

Postgres holds everything you build in Fluxify, so pick based on what you are
doing:

- **Trying Fluxify out?** Skip this step. Fluxify can run a single Postgres pod
  for you (step 6, trial). It has no copies and no backups.
- **Running it for real?** Use a Postgres with copies on more than one machine
  and backups. [CloudNativePG](https://cloudnative-pg.io) runs that inside your
  cluster; the commands follow. [StackGres](https://stackgres.io) and managed
  databases (Amazon RDS, Cloud SQL, Azure Database) work too: create an empty
  database and skip to step 6, production, with its address.

Install CloudNativePG:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace --wait
```

Create a database with three copies, in the namespace Fluxify will use:

```bash
kubectl create namespace fluxify
kubectl apply -n fluxify -f - <<'EOF'
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: fluxify-db
spec:
  instances: 3
  storage:
    size: 10Gi
  bootstrap:
    initdb:
      database: fluxify
      owner: fluxify
EOF
```

Two things this does not do yet, and a production database needs both:

- **Backups.** They go to object storage (S3, GCS, Azure Blob), set up on this
  same resource. See
  [CloudNativePG's backup guide](https://cloudnative-pg.io/documentation/current/backup/).
- **Machines.** The three copies only protect you if they run on different
  machines. CloudNativePG spreads them when the cluster has three or more nodes;
  on a one-node cluster (k3d on a laptop) they all share it.

**Check:** `kubectl get cluster -n fluxify` shows `Cluster in healthy state`.
It takes a minute or two.

## 6. Install Fluxify

The commands install the newest release, `%%RELEASE_TAG%%`. For another one, pick
it from the [releases page](https://github.com/Fluxify-rest/Fluxify/releases)
and change `--version`: it is the release's name without the leading `v`.

Fluxify's settings go in a file you keep, `fluxify-values.yaml`. Keep it in
git: every later upgrade uses it again. Every setting it can hold is listed in
[Chart settings](./helm-values).

**Production**, with the CloudNativePG database from step 5:

```yaml
# fluxify-values.yaml
# The address people open Fluxify at. Sign-in only works here.
url: https://fluxify.example.com

postgres:
  # The Secret CloudNativePG made for the database in step 5.
  urlFrom:
    secret: fluxify-db-app
```

With another database, give its address instead of `urlFrom`, as shown in
[Chart settings](./helm-values#database).

**Trial**, with the built-in Postgres:

```yaml
# fluxify-values.yaml
# On a laptop with k3d. On a cloud cluster, the domain you will point at Traefik.
url: http://localhost:8080

postgres:
  bundled: true
```

Then install. Unlike steps 2 to 5 there is no `helm repo add` or `helm repo update`: Fluxify's chart
is published to a container registry, and Helm fetches it straight from the
`oci://` address. NATS and Valkey come packed inside it. To check Helm can
reach it, `helm show chart oci://ghcr.io/fluxify-rest/charts/fluxify --version %%CHART_VERSION%%`
prints the chart's name and version.

```bash
helm install fluxify oci://ghcr.io/fluxify-rest/charts/fluxify \
  --version %%CHART_VERSION%% -n fluxify --create-namespace \
  -f fluxify-values.yaml
```

**Check:** `kubectl get pods -n fluxify` after two or three minutes. Every pod
is `Running` and ready, including one named `fluxify-worker-…`: that is the
first worker, started from the claim every new install begins with.

While the database, Valkey and NATS are still starting, `fluxify-admin` and
`fluxify-orchestrator` wait for them instead of restarting. Their logs show lines
like `waiting for NATS (3/30)` for up to about a minute. That is expected.

## 7. Open the portal and sign in

Find Traefik's address:

```bash
kubectl get svc -A | grep traefik
```

The `EXTERNAL-IP` column is the address. On a cloud cluster, point your
domain's DNS at it. On k3d it is already `localhost:8080`.

Then open `<url>/_/admin/ui`, e.g. `http://localhost:8080/_/admin/ui`, and sign
in:

- Email: `admin@company.com`
- Password: printed by

  ```bash
  kubectl get secret fluxify-env -n fluxify -o jsonpath='{.data.SEED_USER_PASSWORD}' | base64 -d
  ```

Change the password once you are in.

> [!IMPORTANT]
> Sign-in only works at the address set as `url`. Opened any other way (an IP
> instead of the domain, another port), the portal loads but sign-in fails. To
> change it, edit `url` in `fluxify-values.yaml` and run the [upgrade](#upgrade)
> command.

## 8. Back up your keys

Fluxify locks the passwords and keys you store in it with a key it generated on
install. If that key is lost, they cannot be read again, even with a database
backup. Save it now, somewhere safe:

```bash
kubectl get secret fluxify-env -n fluxify -o yaml > fluxify-env.backup.yaml
```

This file holds every key Fluxify uses. Treat it like a password: keep it
out of git, unlike `fluxify-values.yaml`.

You are done. Next: [create a project](/getting-started/), then give it its own
workers from its **Orchestration** settings.

## When something does not work

| What you see | What to do |
| :--- | :--- |
| `helm install` says `no database` | `fluxify-values.yaml` has no database. See step 6. |
| `fluxify-admin` or `fluxify-orchestrator` keeps restarting | It waited about a minute and still could not reach Postgres, Valkey (logged as `Redis`) or NATS. `kubectl logs -n fluxify deploy/fluxify-admin --previous` names which one (`… is not reachable after 30 attempts`). With CloudNativePG, check step 5 is healthy. |
| `fluxify-nats` pods keep restarting, their log says `variable reference for 'NATS_TOKEN' … could not be parsed` | The NATS password starts like a number, which v0.0.2-alpha could generate. Run the [upgrade](#upgrade) command once with `--set-string secret.values.NATS_TOKEN="n$(openssl rand -hex 31)"` added (later upgrades keep it), then `kubectl rollout restart statefulset fluxify-nats -n fluxify`. |
| Pods stuck in `Pending` | The cluster is out of room or has no storage. `kubectl describe pod -n fluxify <pod>` says which. |
| The portal does not load | Traefik is missing or not reachable: redo step 1's first check, and step 7. |
| The portal loads, sign-in fails | You opened it at an address other than `url`. See step 7. |
| Workers never go above their minimum | KEDA or Metrics Server is missing: redo step 1's checks. |
| The portal's Orchestration page lists something as not installed | That part of your cluster is missing. It says what it is needed for. |

## Settings

Everything the chart can be set to (your own NATS or Valkey, extra Fluxify
settings, resources, keys from a secret manager) is on
[Chart settings](./helm-values), with example files.

## Upgrade

After a new release, or after changing `fluxify-values.yaml`:

```bash
helm upgrade fluxify oci://ghcr.io/fluxify-rest/charts/fluxify \
  --version %%CHART_VERSION%% -n fluxify -f fluxify-values.yaml
```

## Uninstall

`helm uninstall fluxify -n fluxify` removes Fluxify, but leaves behind the
workers it started, its keys, and the stored data. To remove everything,
including all data, delete the namespace:

```bash
kubectl delete namespace fluxify
```

## Without Helm {#manifest}

Each release also has a single file, `fluxify.yaml`, with everything from
step 6 (trial) in it. It is for a quick look on a cluster where you cannot use
Helm. Steps 1 to 4 still apply.

> [!WARNING]
> Its Postgres is one pod with no copies and no backups. Do not keep anything
> you care about in it. For anything real, use the steps above.

It must go in a namespace named `fluxify`. A file everyone downloads cannot
hold your keys, so you create them first:

```bash
kubectl create namespace fluxify
kubectl create secret generic fluxify-env -n fluxify \
  --from-literal=MASTER_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
  --from-literal=BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SYSTEM_ACCESS_KEY="$(openssl rand -hex 32)" \
  --from-literal=NATS_TOKEN="n$(openssl rand -hex 31)" \
  --from-literal=REDIS_PASS="$(openssl rand -hex 32)" \
  --from-literal=PG_PASSWORD="$(openssl rand -hex 32)" \
  --from-literal=SEED_USER_PASSWORD='choose-a-password'

kubectl apply -n fluxify --server-side \
  -f https://github.com/Fluxify-rest/Fluxify/releases/download/%%RELEASE_TAG%%/fluxify.yaml
```

Then continue at step 7. You sign in with the password you chose. The file
expects Fluxify at `http://localhost:8080`; to use another address, change
`SERVER_URL`, `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` with
`kubectl edit configmap fluxify-config -n fluxify`, then
`kubectl rollout restart deployment fluxify-admin -n fluxify`.
