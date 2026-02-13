---
title: Cloud Logs
description: Send logs to a cloud logging service.
---

# Cloud Logs

The **Cloud Logs** block sends log messages to your configured cloud logging provider (like Loki or OpenObserve).

## Inputs

- **Connection**: The specific cloud logging integration to use.
- **Message**: The text to log.

## Logic

1.  The block connects to the logging service via the **Connection**.
2.  It sends your **Message** to that service.
3.  This helps in monitoring your application's health remotely.
