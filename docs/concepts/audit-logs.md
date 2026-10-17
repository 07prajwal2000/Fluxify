---
title: Audit Logs
description: A record of who changed what in Fluxify, kept for administrators. An Enterprise feature that is switched on per project.
---

# Audit Logs

**Audit logs** keep a record of every change made in Fluxify: who made it, when, how they got in, and which settings they touched. They answer questions like "who turned this route off?" or "who changed the production database settings last Tuesday?".

::: info Enterprise feature
Audit logs are part of the Enterprise Edition, and the non-commercial licence includes them. See [Editions](../deployments/editions.md).
:::

## What you see for each change

| Field | What it tells you |
| :--- | :--- |
| When | The time of the change. |
| Who | The person's name and email. |
| How | `portal` (the web app), `pat` (a personal access token), `agent` (the built-in AI agent) or `mcp` (an AI tool connected through MCP). |
| Project | The project, by name and short name as they were at that moment. |
| What | The kind of thing (route, workflow, integration, ...), its id, and the action: create, update, delete, login, test and so on. |
| Which settings | The **names** of the settings that changed, for example `name` and `timeoutSeconds`. |
| Result | Whether it worked, plus a short reason when something failed. |

::: tip Secrets are never shown
A log entry lists *which* settings changed, never their values. If someone changes a database password, the entry says that `password` changed, not what it was or what it became. Tokens and passwords are also removed from any reason text.
:::

## What is recorded

- Logging in
- Projects: creating, renaming, deleting, members, settings, the development token and npm packages
- Routes and workflows: creating, editing, deleting, saving the canvas, committing versions, switching a version, and promoting to production
- Triggers and trigger groups
- Custom blocks and middlewares, including their versions (commit and switch)
- Test suites: creating, saving, cloning, deleting, clearing the run history, and every time a run is started. A run against production says "Ran in production canvas"; running every suite says "Ran all suites"
- App config
- Integrations, including the "Test connection" button
- Sandboxes
- Knowledge sources
- Worker claims
- Instance settings and the licence
- Users: creating, changing, resetting a password and deleting
- Personal access tokens: creating and deleting

Calling a route or running a workflow or sandbox is not a change, so it is not recorded. Use [Execution Recording](./execution-recording.md) to look at runs.

## Turn it on or off for a project

Audit logs are switched on **per project**, in the project's settings under `auditLogs.enabled`.

| Project | Starting value |
| :--- | :--- |
| A new project on an Enterprise or non-commercial licence | On |
| A new project on the Community Edition | Off |
| A project that existed before audit logs | Off. Turn it on yourself. |

Only a project admin can change the setting. Turning it off is itself recorded.

Changes that don't belong to a project (instance settings, the licence, users, logging in) are always recorded while your licence includes audit logs.

## If something goes wrong

Fluxify treats the log as part of the change. If an entry cannot be saved because the event bus is down, **the change fails too** and nothing is half done. Try again once the system is healthy.

## What happens to old entries

- Entries are kept for **30 days**, then deleted. Whoever runs your server can change this with `AUDIT_LOG_MAX_AGE_DAYS` (see [Production](../deployments/production.md#audit-log-retention)).
- Deleting a project does **not** delete its entries. They stay, with the project's name as it was.
- If your licence expires, logging continues through the grace period and then stops. Existing entries stay until they reach their age limit.

::: info Browsing the log
Entries are saved now. A page for browsing them in the portal is not available yet.
:::
