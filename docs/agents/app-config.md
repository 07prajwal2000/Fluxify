---
title: App config reference for agents
description: Fields, encryption rules, errors and JSON examples for project settings and secrets saved with save_app_config.
---

# App config reference for agents

App config holds a project's settings and secrets as key and value pairs. Blocks and scripts read them by key. Integrations refer to them as `cfg:KEY`. Keep every secret here, never in a block or a canvas. For background, see [App Config](/concepts/app-config).

## Tools

| Tool | Role | What it does |
| --- | --- | --- |
| `list_app_config` | creator | Entries of a project: id, keyName, dataType, isEncrypted, hasDevValue, syncDev. Values are not listed. Args: `projectId`, `page`, `search`. |
| `get_app_config` | creator | One entry with its production `value` and its development `devValue` (null while it has none), and `syncDev`. An encrypted value comes back masked. |
| `save_app_config` | creator | Create (no `appConfigId`) or update (`appConfigId`). |
| `delete_app_config` | creator | Deletes the entry. |

The id of an entry is a **number**, not a string. All four tools need the Creator role. A viewer cannot read app config.

## Create an entry

Pass `projectId`, `keyName`, `value`, `description`, `isEncrypted` and `encodingType`.

```json
{
  "projectId": "<project id>",
  "keyName": "PAYMENTS_API_KEY",
  "value": "<the secret>",
  "description": "Key for the payments API",
  "isEncrypted": true,
  "encodingType": "plaintext"
}
```

The result is `{ "id": 12 }`.

A plain setting:

```json
{
  "projectId": "<project id>",
  "keyName": "MAX_PAGE_SIZE",
  "value": 50,
  "dataType": "number",
  "description": "Largest page a route returns",
  "isEncrypted": false,
  "encodingType": "plaintext"
}
```

Never invent a secret or print one back. Ask the person for the value. `get_app_config` masks encrypted values on purpose.

## Update an entry

Pass `projectId`, `appConfigId` and only the fields that change. Fields you leave out keep their value. Leave `value` out to keep the stored value.

```json
{ "projectId": "<project id>", "appConfigId": 12, "value": "<the new secret>" }
```

`keyName` and `dataType` cannot change. To rename a key, create the new key, change every reference, then delete the old one.

## Production and development values

An entry has two values: `value` for production and `devValue` for development.
The development worker reads `devValue`, or `value` when `syncDev` is `true`.

- With `syncDev: false` (the default) and no `devValue`, anything on the development worker that reads the key fails with `app config key KEY has no development value`. It never falls back to production.
- `syncDev: true` makes development read the production value. Development runs, triggers and agents then read and write production resources. Ask the person before setting it.
- `devValue: null` on an update removes the development value. Leaving `devValue` out keeps it.
- `devValue` is stored like `value`: same `isEncrypted`, `encodingType` and `dataType`. Encrypted ones come back masked too.

```json
{ "projectId": "<project id>", "appConfigId": 12, "devValue": "<the development secret>" }
```

## Fields

| Field | Type | Rule | Default |
| --- | --- | --- | --- |
| `projectId` | string | Project id from `list_projects`. | none |
| `keyName` | string | 3 to 100 characters: letters, digits and `_`. Unique in the project. Create only. | none |
| `value` | string, number or boolean | The production value. Stored as text. | none |
| `devValue` | string, number, boolean or null | The development value. `null` on update removes it. | none |
| `syncDev` | boolean | Development reads `value` instead of `devValue`. | `false` |
| `description` | string | Up to 255 characters. Required on create. | none |
| `dataType` | string | `string`, `number` or `boolean`. Create only. A `number` value must read as a number. | `string` |
| `isEncrypted` | boolean | Required on create. See [Encryption](#encryption). | none |
| `encodingType` | string | `plaintext`, `base64` or `hex`. Required on create. | none |

Use clear upper-case keys, such as `STRIPE_SECRET_KEY` or `INTERNAL_API_URL`.

## Encryption

- Set `isEncrypted: true` for every secret: keys, tokens, passwords and connection strings.
- Encryption is one way. An encrypted entry can never be turned back into a plain one. Setting `isEncrypted: false` on an encrypted entry fails.
- A masked value is a run of `*`, at most 20 characters. It is not the value. Do not save it back.
- Encrypted values still work at run time. `getConfig("KEY")` returns the real value to authorised code.

## Encoding

Pass the value as plain text. `encodingType` sets how Fluxify stores it: `base64` and `hex` store the text in that encoding, and reads decode it again. Use `plaintext` unless a person asks for another. Do not pre-encode the value yourself.

## Read a value

In a script or any `js:` field:

```js
const key = getConfig("PAYMENTS_API_KEY");
if (!key) throw new Error("PAYMENTS_API_KEY is not set");
```

`getConfig` returns `undefined` when the key does not exist in the project. Do not return or log a secret to check that it exists. Return `Boolean(getConfig("KEY"))` instead.

In an integration config, write the key with a prefix: `"cfg:PAYMENTS_API_KEY"`. See [Integration reference](/agents/integration). A custom block can take a key as a parameter with an `app_config_selector` input. See [Custom block reference](/agents/custom-block).

A [test suite](/agents/test-suite) can swap a value for its own runs with `appConfigOverrides`, without touching the real entry.

## Delete

`delete_app_config` removes the entry at once. Code that calls `getConfig` for that key gets `undefined`. An integration with a `cfg:` reference to it fails to connect. Search the canvases and integrations for the key first.

## Common errors

| Message | Cause and fix |
| --- | --- |
| `Fluxify API error 409: Key already exists` | The project already has this `keyName`. Update that entry instead. |
| `Invalid input: keyName: ...` | The key is shorter than 3 characters, longer than 100, or has a character outside letters, digits and `_`. |
| `Invalid input: description: ...` | `description` is missing on create, or longer than 255 characters. |
| `Invalid input: Value must be a number` | `dataType` is `number` and the value does not read as one. |
| `Invalid input: Cannot decrypt value once it is encrypted` | The update has `isEncrypted: false` on an encrypted entry. Keep `true`. |
| `Not found: App config not found` | Wrong `appConfigId`. Use `list_app_config`. |
| `You need the Creator role in this project.` | Ask a project admin. Do not retry. |
