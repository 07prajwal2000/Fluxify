---
title: Observability Integrations
description: Monitor your logs and application health.
---

# Observability Integrations

Keep track of what's happening inside your workflows by sending logs to external monitoring tools.

## Supported Providers

### Loki
Push logs to a Grafana Loki instance.
- **Configuration**:
    - **Base URL**: The address of your Loki instance.
    - **Username/Password**: Authenticated access (optional).

### OpenObserve
Send logs to OpenObserve for storage and analysis.
- **Configuration**:
    - **Base URL**: The address of your OpenObserve instance.
    - **Credentials**: Authentication details.

## functionality

Once configured, use the **Cloud Logs** block to send structured logs (Info, Warning, Error) directly to these services from your workflow.
