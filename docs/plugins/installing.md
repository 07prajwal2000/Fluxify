---
title: Adding a Plugin
description: The four ways to add a plugin to a project (upload, npm, trusted link, folder), what each needs, and what the common error messages mean.
---

# Adding a plugin

Open **Settings → Plugins** in your project and choose **Add plugin**. You need the Creator role. Every way ends the same: the plugin is listed as **Pending approval** until a creator approves it ([next step](./approving)).

Nothing in the package is run while you add it. Fluxify only reads its description and checks that the package is well formed.

## The four ways

| Way | What you give | Good for |
| :--- | :--- | :--- |
| **Upload** | The `.tgz` file the plugin's author built | A plugin you were sent or built yourself |
| **npm** | A package name and an **exact** version, like `@acme/fluxify-slack@2026.10.2001` | A plugin published to npm |
| **Link** | An `https://` link to a `.tgz`, on a trusted domain | A plugin hosted on your own file server |
| **Folder** | Pick a plugin from the instance's plugins folder | Self-hosted setups where the plugin is copied onto the server |

### Upload

Choose the `.tgz` and press **Upload**. To upgrade a plugin later, upload its new version the same way ([upgrading](./upgrading)).

Limits: 25 MB for the file, 100 MB unpacked, and 2,000 files.

### npm

Type the package and the exact version. Ranges (`^1.0.0`) and tags (`latest`) are refused, because an approval is for one exact version. If the project has a package release-age rule (Settings → npm Packages), a release younger than that is refused until it is old enough.

### Link

Adding a plugin from a link takes two steps, so nothing is downloaded by surprise:

1. Paste the link and press **Request**. Fluxify records it and downloads nothing.
2. In the list below, press **Allow fetch**. Fluxify downloads the file and checks it like an upload. A failed download stays in the list with its reason, and you can try again.

Only links on a **trusted domain** work, and only `https://` links without a user name or password. Redirects to another host are checked too.

### Folder

The **Folder** tab lists the plugins found in the instance's plugins folder. Pick one and press **Add**. The folder must be set up by whoever runs your Fluxify, and every worker must see it: see [Kit](/deployments/kit#plugins), [Docker production](/deployments/production#plugins) or [Kubernetes](/deployments/kubernetes/helm-values#plugins). The folder holds one subfolder per built plugin.

If a folder plugin's files change after it was approved, workers refuse the changed copy. Add it again from the Folder tab and approve it.

## Trusted domains

Links only work for hosts on the **trusted domains** list. This is an instance-wide setting, so only an instance admin can change it. The list is empty at first, which means the link way is off.

| Entry | Matches |
| :--- | :--- |
| `plugins.example.com` | That host only |
| `*.example.com` | Any subdomain, however deep (`a.example.com`, `a.b.example.com`) |
| `example.com` | Only when listed itself: `*.example.com` does **not** cover it |

Entries are lowercase host names, up to 100 of them. Today the list is changed through the instance settings API rather than a screen: send a `PUT` to `/v1/instance-settings` as an instance admin, with the body:

```json
{
  "key": "plugins",
  "category": "plugins",
  "value": { "trustedDomains": ["plugins.example.com", "*.example.org"] }
}
```

## Common messages

Fluxify shows the reason a plugin was refused exactly as written. These are the ones you are most likely to meet.

| Message | What it means and what to do |
| :--- | :--- |
| `The plugin has no fluxify.json` | The package was not built with the Fluxify CLI. Ask the author to run `blocks build` and share the new `.tgz`. |
| `<name>@<version> is not a Fluxify plugin: it has no fluxify.json` | The npm package exists but is not a Fluxify plugin. |
| `bun.lock is missing or empty: run bun install and commit it` | The plugin needs outside packages but its lockfile is empty or absent. The author fixes it and rebuilds. A plugin with no outside packages needs no lockfile. |
| `bun.lock does not pin ...` | The lockfile is out of date. The author runs `bun install` again and rebuilds. |
| `@fluxify/sdk is in "dependencies": move it to "peerDependencies"` | Fluxify provides the SDK itself. The author moves it, and `zod`, to `peerDependencies`. |
| `The plugin needs @fluxify/sdk <range>, but this Fluxify provides <version>` | The plugin was built for a different Fluxify version. Use a plugin version that supports yours, or update Fluxify. |
| `Give an exact version, like ...` | npm entries need a fixed version number, not a range or tag. |
| `<host> is not a trusted domain...` | Ask an instance admin to add the host to the trusted domains. |
| `No trusted domains are set, so no plugin can be fetched from a URL` | Same, and the list is empty. |
| `Only https:// URLs are accepted` | Use a secure link. |
| `No plugins directory is set...` | The folder way is not set up on this Fluxify. |
| `package.json says the plugin is '...' but fluxify.json says '...'` | The package is inconsistent. The author rebuilds it. |
| `This is plugin <new>, not <old>. A plugin's name never changes...` | An upgrade must be the same plugin. A different name is a different plugin, so add it separately. |
| `... was published less than N days ago` | The project's release-age rule is holding back a very new npm release. Wait, or change the rule in the npm Packages settings. |
| `The archive holds an unsafe path` or `... is truncated` | The `.tgz` is damaged or unsafe. Get a fresh copy. |
| `the plugins folder is not mounted on this worker` | A folder plugin installed, but a worker cannot see the folder. Whoever runs Fluxify must mount it on every worker (see the deployment pages above). |

::: tip
Adding the same version again, with identical contents, changes nothing. Adding the same version with different contents is treated as a new build and goes back to pending.
:::
