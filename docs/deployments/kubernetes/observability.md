---
title: Logs and monitoring
description: Send Fluxify's own logs from a Helm install to a dashboard such as OpenObserve, and where your projects' logs, traces and metrics are set up instead.
---

# Logs and monitoring

By default Fluxify writes its logs to the pod output, which you read with
`kubectl logs`. This page shows how to also send them to a dashboard, with a
complete example for [OpenObserve](https://openobserve.ai) running in the same
cluster.

## What Fluxify can send

There are two separate things, set up in two different places.

| What | Where it is set up | Sent by |
| :--- | :--- | :--- |
| **Fluxify's own logs**: startup, errors, workers starting and stopping | Once for the whole install, in `fluxify-values.yaml` (this page) | The portal and API pod, and every worker |
| **Your projects' logs, traces and metrics**: what your routes and workflows do | Per project, in the portal: **Project settings → Telemetry**. See [Telemetry configuration](../../concepts/telemetry-configuration) | The workers running that project |

Good to know:

- The orchestrator's logs are not sent anywhere. Read them with
  `kubectl logs -n fluxify deploy/fluxify-orchestrator`.
- Fluxify sends no metrics about itself (CPU, memory, requests per pod). For
  those, use your cluster's own monitoring; Metrics Server, installed in step 4
  of [Install on Kubernetes](./install), already gives you `kubectl top pods -n fluxify`.
- Metrics about your routes and workflows (how many ran, how long they took)
  exist only for the routes and workflows you trace. See
  [Telemetry configuration](../../concepts/telemetry-configuration).

Logs are sent with OpenTelemetry (OTLP) over HTTP, so any backend that accepts
OTLP logs over HTTP works: OpenObserve, Grafana Loki, an OpenTelemetry
Collector, or a hosted service.

## Settings

These go under `env:` in `fluxify-values.yaml`. The workers receive them
automatically.

| Setting | What it does |
| :--- | :--- |
| `OTLP_LOGGER_ENABLED` | `"true"` to send logs. Anything else, or leaving it out, sends nothing. |
| `OTLP_LOGS_ENDPOINT` | The full address logs are sent to, including the path, which usually ends in `/v1/logs`. |
| `OTLP_AUTH_HEADER_NAME` | The name of the one header sent with every batch of logs, usually `Authorization`. |
| `OTLP_AUTH_HEADER_VALUE` | That header's value, e.g. `Basic …` or `Bearer …`. It is a password: keep it out of git, see [below](#keep-the-password-out-of-git). |
| `OTLP_LOGGER_LEVEL` | The least important messages kept: `debug`, `info`, `warn` or `error`. It also applies to `kubectl logs`. Default `info`. |

Only one header can be set. A backend that needs two (for example a key and a
tenant id) needs an OpenTelemetry Collector in between to add the second.

## Example: OpenObserve in the same cluster

### 1. Run OpenObserve

This runs one OpenObserve pod in its own namespace, `observability`. It keeps
its data only while the pod runs, which is fine for trying it out. For
production, install OpenObserve with
[its own Helm chart](https://github.com/openobserve/openobserve-helm-chart)
and permanent storage.

Choose a password for OpenObserve's first user. OpenObserve refuses to start
unless it has 8 or more characters with a lowercase letter, an uppercase
letter, a digit and a symbol.

```bash
kubectl create namespace observability
kubectl create secret generic openobserve-root -n observability \
  --from-literal=ZO_ROOT_USER_EMAIL=admin@example.com \
  --from-literal=ZO_ROOT_USER_PASSWORD='Choose-a-Str0ng-password'
```

Save this as `openobserve.yaml` and apply it with
`kubectl apply -f openobserve.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: openobserve, namespace: observability }
spec:
  replicas: 1
  selector: { matchLabels: { app: openobserve } }
  template:
    metadata: { labels: { app: openobserve } }
    spec:
      containers:
        - name: openobserve
          image: public.ecr.aws/zinclabs/openobserve:latest
          envFrom: [{ secretRef: { name: openobserve-root } }]
          env: [{ name: ZO_DATA_DIR, value: /data }]
          ports: [{ containerPort: 5080 }]
          volumeMounts: [{ name: data, mountPath: /data }]
      volumes: [{ name: data, emptyDir: {} }]
---
apiVersion: v1
kind: Service
metadata: { name: openobserve, namespace: observability }
spec:
  selector: { app: openobserve }
  ports: [{ port: 5080 }]
```

**Check:** `kubectl get pods -n observability` shows the pod `Running` and ready.

### 2. Point Fluxify at it

Add this to `fluxify-values.yaml`. `default` in the address is OpenObserve's
organization; the one it creates for you is called `default`.

```yaml
env:
  OTLP_LOGGER_ENABLED: "true"
  OTLP_LOGS_ENDPOINT: http://openobserve.observability.svc:5080/api/default/v1/logs
  OTLP_AUTH_HEADER_NAME: Authorization
```

OpenObserve takes the email and password as the header value, in the form
`Basic` followed by `email:password` in base64. Make it with:

```bash
echo "Basic $(printf '%s' 'admin@example.com:Choose-a-Str0ng-password' | base64 | tr -d '\n')"
```

### 3. Keep the password out of git {#keep-the-password-out-of-git}

`fluxify-values.yaml` is often kept in git, so do not put the header value in
it. Put it in a second, small file that stays on your machine, for example
`fluxify-secrets.yaml`, and add that file's name to `.gitignore`:

```yaml
secret:
  values:
    OTLP_AUTH_HEADER_VALUE: "Basic YWRtaW5AZXhhbXBsZS5jb206Q2hvb3NlLWEtU3RyMG5nLXBhc3N3b3Jk"
```

The chart stores it in the `fluxify-env` Secret with Fluxify's other keys.

> [!WARNING]
> Pass this file on **every** `helm upgrade`, not just the first. An upgrade
> without it removes the value from the Secret, and the logs stop arriving.

Using a secret manager and [your own Secret](./helm-values#own-secret)
instead? Add `OTLP_AUTH_HEADER_VALUE` to that Secret as one more key, and leave
the second file out.

### 4. Apply it

```bash
helm upgrade fluxify oci://ghcr.io/fluxify-rest/charts/fluxify \
  --version %%CHART_VERSION%% -n fluxify \
  -f fluxify-values.yaml -f fluxify-secrets.yaml
```

The portal and API pod and the orchestrator restart with the new settings, and
the orchestrator then restarts each worker once so they pick them up too.

### 5. Check it works

Open OpenObserve from your computer:

```bash
kubectl port-forward -n observability svc/openobserve 5080:5080
```

Go to `http://localhost:5080`, sign in with the email and password from step 1,
and open **Logs**. Choose the stream `default`. Fluxify's startup messages
show up within a few seconds of the pods starting.

The `service_name` field tells you which part of Fluxify wrote each line:

| `service_name` | Comes from |
| :--- | :--- |
| `fluxify.server` | The portal and API |
| `fluxify.api-gateway-main`, `fluxify.api-gateway-worker` | The AI assistant, which runs in the same pod as the portal |
| `fluxify.worker.compiled` | A worker: starting, stopping, what it serves |
| `fluxify.worker.execution` | A worker: loading and running your routes and workflows |

To see only one part, type `service_name = 'fluxify.server'` in the search bar
and run the search.

**Nothing arrives?**

| What you see | What to do |
| :--- | :--- |
| No stream `default` at all | Check `OTLP_LOGGER_ENABLED` is `"true"` with quotes, and that `OTLP_LOGS_ENDPOINT` ends in `/v1/logs`. |
| It worked, then stopped after an upgrade | The upgrade ran without `fluxify-secrets.yaml`. Run it again with the file. |
| Still nothing | The header value is wrong. Make it again as in step 2; the email and password must be exactly the ones OpenObserve was started with. |

## Other backends

Any backend that accepts OTLP logs over HTTP is set up the same way. Only the
address and the header change. For an OpenTelemetry Collector in the
`observability` namespace, with its standard HTTP port:

```yaml
env:
  OTLP_LOGGER_ENABLED: "true"
  OTLP_LOGS_ENDPOINT: http://otel-collector.observability.svc:4318/v1/logs
```

A collector inside the cluster usually needs no header. For a hosted service,
the header name and value are in its documentation, usually under "OTLP" or
"OpenTelemetry".

## AI assistant traces

When the AI assistant is on (`ENABLE_AI: "true"`), it can also send a trace of
each conversation with the AI model, over OTLP HTTP. This is separate from the
logs above and has its own settings, also under `env:`:

| Setting | What it does |
| :--- | :--- |
| `LLM_TRACING_ENABLED` | `"true"` to send them. |
| `LLM_OTLP_TRACES_ENDPOINT` | The full address, usually ending in `/v1/traces`. For the OpenObserve above: `http://openobserve.observability.svc:5080/api/default/v1/traces`. |
| `LLM_OTLP_TRACES_HEADERS` | Headers to send, as `Name: value`, several separated by `;`. A password here belongs in `fluxify-secrets.yaml` too, under `secret.values`. |

## Your projects' logs, traces and metrics

These are not sent by the settings on this page. Add an observability
integration in the portal, then choose it in **Project settings → Telemetry**
for each project. See [Observability integrations](../../integrations/observability)
and [Telemetry configuration](../../concepts/telemetry-configuration). You can
point them at the same OpenObserve.
