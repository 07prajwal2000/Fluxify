---
title: App Config
description: Store project-wide settings and secrets, then read them safely from routes and integrations.
---

# App Config

App Config is the project-wide home for values your routes need but should not hard-code: API credentials, public service URLs, feature flags, and similar settings. Define a value once in Project Settings, then reference it from scripts and integrations wherever it is needed.

It keeps configuration separate from route logic, so rotating a credential or changing an endpoint does not require editing every workflow that uses it.

## When to use App Config

Use App Config for a value that is shared by more than one route, differs between projects or environments, or should stay out of a block's source code.

| Good fit | Use something else when |
| --- | --- |
| API keys and service credentials | The value comes from the current HTTP request |
| Base URLs and integration connection settings | The value is temporary state produced by a workflow |
| Project-wide feature flags | The value is a per-user preference or data record |
| Values reused by several routes | The value belongs only to one block and is safe to hard-code |

## Create a stable key

In **Project Settings → App Config**, create a configuration entry with a key, value, description, data type, encryption setting, and encoding.

For example:

| Field | Example |
| --- | --- |
| Key | `PAYMENTS_API_KEY` |
| Description | `Credential used by the Payments API integration` |
| Value | `…secret value…` |
| Data type | `string` |
| Encrypted | Enabled |

Keys must be 3–100 characters and can contain letters, numbers, and underscores. Use clear, uppercase names such as `STRIPE_SECRET_KEY`, `INTERNAL_API_URL`, or `ENABLE_BETA_FLOW`.

::: warning Treat the key name as permanent

After an entry is created, its key cannot be renamed. Routes, integrations, and other project references may rely on that exact name.

If a name needs to change, create a new key, update every reference to use it, confirm the application works, and only then delete the old entry.

:::

## Read a value in JavaScript

Every route script receives `getConfig(key)` in its execution context. Call it with the exact App Config key:

```javascript
const apiKey = getConfig("PAYMENTS_API_KEY");

if (!apiKey) {
  throw new Error("PAYMENTS_API_KEY is not configured");
}

return { configured: true };
```

`getConfig()` returns the value for the current project, or `undefined` when no entry exists with that key. Check for a missing value before using it, especially for credentials and required service URLs.

Never return or log a secret merely to check that it is present. Return a safe status such as `configured: Boolean(getConfig("PAYMENTS_API_KEY"))` instead.

For the complete scripting surface, see the [JavaScript API Reference](../scripting/javascript-api.md#getconfig).

## Use a value in an integration

Integration configuration fields can refer to an App Config value with the `cfg:` prefix:

```text
cfg:PAYMENTS_API_KEY
```

Fluxify resolves that reference to the App Config value when it prepares the integration. This is the preferred way to supply connection strings, tokens, and other credentials to integrations instead of putting the sensitive value directly in the integration form.

## Values, types, and secrets

App Config supports `string`, `number`, and `boolean` values. Select the type that matches how the value will be used, and add a description that tells other builders what the setting controls.

For credentials and other sensitive material, enable encryption when you create the entry. Encrypted values are stored protected and displayed masked in management responses, while authorized routes can still retrieve the value through `getConfig()` at runtime.

::: danger Encryption is one-way

Once an entry has been stored as encrypted, it cannot be changed back to an unencrypted value. Plan the setting's sensitivity before creating it.

:::

## Updating a value safely

You can update an entry's value and supporting metadata without changing its key. App Config changes are published to the running application so route workers and integrations can receive the refreshed project configuration.

When rotating a credential:

1. Update the existing value while keeping its key unchanged.
2. Verify one route or integration using that key.
3. Revoke the old credential at the provider only after the new one is working.

If you must replace a key, use a short migration: add the new key, update all scripts and `cfg:` references, verify them, then remove the old key. This avoids breaking routes that still point at the previous name.

## Practical example

A route that calls an internal service can keep the URL and credential out of the workflow:

```javascript
const baseUrl = getConfig("INTERNAL_API_URL");
const token = getConfig("INTERNAL_API_TOKEN");

if (!baseUrl || !token) {
  throw new Error("Internal API configuration is missing");
}

const response = await httpClient.get(`${baseUrl}/status`, {
  authorization: `Bearer ${token}`,
});

return response.data;
```

This leaves the route portable: each project can supply its own endpoint and token without changing the workflow itself.
