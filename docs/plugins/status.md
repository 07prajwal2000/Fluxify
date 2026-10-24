---
title: Plugin Status and Troubleshooting
description: How to read a plugin's install status on each worker, how the hourly scan and Scan now work, and what each error means and what to do about it.
---

# Status and troubleshooting

A plugin's row in **Settings → Plugins** shows two things at a glance: its **approval** (pending, approved, rejected, or upgrade pending) and its **status** (healthy, or an error with the reason). Open the plugin for the detail.

## Installation on workers

After approval, every worker that runs the plugin's environment installs it. The plugin's page lists each worker under **Installation on workers**:

| State | Meaning |
| :--- | :--- |
| **waiting** | The worker hasn't picked up this version yet |
| **installing** | It is fetching the plugin and installing its packages |
| **ready** | The plugin is loaded and its blocks work on this worker |
| **failed** | The install failed. The reason is shown, and the worker keeps serving the previous version if there was one |

The header sums it up: **Installing on workers…**, **Installed on every worker**, or **Install failed on a worker**. The page keeps checking until it settles.

If it says **No worker runs this plugin in an enabled environment**, check the Dev and Prod switches.

## The scan

Fluxify checks every plugin's health **once an hour**, and you can run it yourself with **Scan** on a plugin, or **Scan all** at the top of the list. A scan checks that:

- the stored file is still there and unchanged (uploads and links)
- the npm release still exists with the same contents (npm)
- the folder's files haven't changed (folder)
- every worker has installed the approved version

A scan only **reports**. It never un-approves a plugin or stops it running. When something is wrong, the status shows the reason; when it is fixed, the next scan clears it.

## Integrations a plugin provides

A plugin can add integration variants ([authoring](/plugins/authoring/integrations)). They appear under their built-in group with a **Plugin** badge, or under the plugin's scope, while the plugin is approved and enabled.

Turning off both **Dev** and **Prod** does not delete the project's integrations of that plugin's kinds:

- the plugin's variants disappear from the integrations page and from the create form
- the existing integrations stay in the list, marked **plugin disabled**
- a route or block that uses one fails with `plugin <name> is disabled`
- creating another one is refused with `... belongs to a disabled plugin; enable the plugin to create one`

With only **Prod** off, development keeps working and production fails with `plugin <name> is disabled in production`. Turn the switch back on to use the integration again; nothing about it was changed.

The plugin cannot be removed while any of its integrations exist. Delete those integrations first ([removing a plugin](./upgrading#removing-a-plugin)).

## Triggers a plugin provides

A plugin can add **trigger kinds**: the Source step of the trigger wizard offers them next to the built-in sources, marked **Plugin** ([authoring](/plugins/authoring/triggers)). A trigger of one of those kinds runs wherever the plugin is enabled and the workflow it starts is live.

Turning the plugin off in both environments stops its triggers. Nothing is deleted:

- the trigger rows and their settings stay
- the list marks them **plugin disabled**
- creating another trigger of that kind is refused

Turn the switch back on and the triggers start again; each one is re-checked on the way. The same is true when only **Prod** is off: development keeps running and production stops.

**Deleting an integration** that a plugin trigger uses switches that trigger off, with the reason shown on it, and keeps the row. Turning the trigger back on re-checks its settings, so an integration that no longer exists is refused with the field named.

The runtime also turns a trigger off when it keeps failing: a `start` that throws or never resolves, a `ctx.fail(error)` from the trigger's own loop, or an error traced to it. The reason is shown on the trigger row and on its edit page. Turning the trigger back on starts a fresh failure count.

## What the errors mean

| Error | What it means | What to do |
| :--- | :--- | :--- |
| `dependencies did not install: ...` | The plugin needs outside packages and installing them failed on a worker | Check the worker can reach its package source, or ask the author for a fixed version |
| `the plugin's tarball ... is not in the object store` | The stored file for an upload or link has gone missing | Upload the plugin again |
| `the stored tarball ... does not match the approved integrity` | The stored file differs from what was approved | Upload the plugin again and approve it |
| `... is no longer on the registry` | The npm release was unpublished | Switch to another version, or upload the plugin |
| `the directory '...' changed since it was approved` | A folder plugin's files were edited after approval | Add it again from the Folder tab and approve it |
| `the plugins folder is not mounted on this worker` | A worker can't see the plugins folder | Whoever runs Fluxify mounts it on every worker; see [Kit](/deployments/kit#plugins), [Docker production](/deployments/production#plugins) or [Kubernetes](/deployments/kubernetes/helm-values#plugins) |
| `Could not check the source: ...` | The scan couldn't reach the place the plugin came from (for example the npm registry) | Try again later; nothing is affected |
| `node ...` followed by a reason | A particular worker failed to install | Open the plugin's page to see which worker, then fix as above |
| `Block <name> cannot run: plugin ... is waiting for a creator to approve it` | A route uses a block of a plugin that isn't approved (or isn't enabled in this environment) | Approve the plugin, or turn on its Dev or Prod switch |

## A block won't run

Work down this list:

1. Is the plugin **Approved** (not pending or rejected)?
2. Is the right switch on, **Dev** for development and **Prod** for production?
3. Does the plugin's page say **Installed on every worker**?
4. Does the block use something the plugin wasn't **granted** (an integration kind, or App Config)? The error names it. See [permissions](./approving#permissions).
5. Does the block use an integration the plugin provides? If the plugin is disabled, or disabled in this environment, the run says so ([above](#integrations-a-plugin-provides)).
6. For production, was the route promoted after the plugin was approved there?

## A trigger won't run

Work down this list:

1. Is the plugin **Approved**, with the right **Dev** or **Prod** switch on for this environment?
2. Does the plugin's page say **Installed on every worker**?
3. Is the trigger itself switched on? A trigger Fluxify switched off shows its reason on the row and on the edit page ([above](#triggers-a-plugin-provides)).
4. Is the workflow it starts live in this environment? The workflow's own switch must be on, and production needs a [promoted version](/concepts/versioning#what-production-serves).
5. Are the trigger's integration settings still valid? Deleting an integration switches the trigger off; turning it back on refuses a value that no longer exists.
6. For a plugin trigger, is its plugin enabled in this environment? Otherwise the row is marked **plugin disabled** and nothing starts.
