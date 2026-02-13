---
title: Get HTTP Header
description: Retrieve a specific header from the incoming request.
---

# Get HTTP Header

The **Get HTTP Header** block lets you read headers sent with the request, such as authentication tokens or content types.

## Inputs

- **Name**: The name of the header.

## Logic

1.  The block searches the request headers for the given **Name**.
2.  It returns the value of that header.
