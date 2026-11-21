---
title: Backups to Git
description: Commit a whole project to a git repository you own, review what changed between backups, and restore any commit as a new project, even from a repository URL with no project yet.
---

# Backups to Git

You can commit a project's backup to a git repository: your own Gitea, GitLab, GitHub or any server that speaks git over HTTP. Each commit holds the whole project, split into one file per part, so the repository's history shows exactly what changed between two backups.

This works on every edition, including Community. Commits are made by hand; there is no schedule.

## What you need

- A git repository you can push to over `http://` or `https://`. It may be empty.
- A username and a token (or password) that may push to it. Type them in, or pick **App Config** keys that hold them (the key button next to the field), as in the integration forms. An App Config key is read each time Fluxify commits, so a rotated token only needs updating in App Config.

::: warning Plain http
Over `http://` the token travels in cleartext. Use `http://` only on a network you trust, such as a cluster or LAN where the git server has no trusted certificate.
:::

## Set it up

Open **Project Settings → Backup → Git** and fill in:

| Field | Required | Default | What it is |
| :--- | :--- | :--- | :--- |
| Repository URL | Yes | — | The URL you would clone, e.g. `https://git.example.com/team/backups.git`. No username or password in it. |
| Branch | Yes | `main` | The branch commits go to. It is created on the first commit if it doesn't exist. |
| Folder | No | Empty (the repository's root) | Where in the repository the backup goes, e.g. `backups/my-project`. Set one if the repository holds anything else. |
| Username | Yes | — | The git username, or an App Config key holding it. |
| Token | Yes | — | The token or password, or an App Config key holding it. A typed token is stored encrypted and shown as `********` afterwards; leave it as it is to keep it. |
| Encrypt secrets | — | On | Seals credentials and App Config values in the repository (see below). |

Click **Save**.

The username and token are never put in a backup, so they never reach the repository.

## Commit to git

Click **Commit to git**, write a commit message, and confirm. The commit runs in the background, and the **History** tab shows it with its message and the commit's SHA, or the reason it failed.

A commit always holds every part of the project, with version history and App Config values, as a full backup does. If someone else pushed to the branch at the same moment, Fluxify fetches their change and commits on top of it.

Anything else in the repository (other folders, other projects' backups) is left as it is. In its folder, the backup owns `manifest.json`, `README.md`, `sections/` and `files/`.

## What the repository holds

```
<folder>/manifest.json                  what the backup holds, and when it was made
<folder>/README.md                      the backup note, when there is one
<folder>/sections/<part>.json           one file per part: routes, workflows, …
<folder>/sections/appConfig.json.enc    App Config, when Encrypt secrets is on
<folder>/sections/integrations.json.enc integrations, when Encrypt secrets is on
<folder>/files/…                        plugin packages
```

Each part is formatted JSON, so a diff between two commits shows what changed in a route, a workflow or a setting.

## Encrypt secrets

| | On (default) | Off |
| :--- | :--- | :--- |
| App Config and integrations | Encrypted with this instance's `MASTER_ENCRYPTION_KEY` | Plain JSON, readable by anyone who can read the repository |
| Everything else | Plain JSON | Plain JSON |
| Restoring on another instance | Works only with the same `MASTER_ENCRYPTION_KEY`; otherwise those two parts are left out with a warning | Works anywhere |

An encrypted file is only rewritten when its contents change, so it doesn't show up in every diff.

::: danger Turning encryption on later
Secrets committed while encryption was off stay in the repository's history. Turning it on protects only the commits after it. Rotate the credentials and App Config values that were committed in the clear.
:::

## Restore a commit

On the **Git** tab, the list shows the newest 50 commits on the branch. Click **Restore** on one, review what it holds, enter a name for the new project, and click **Create project**.

- Restoring always makes a **new** project. It needs a **System Administrator**.
- The new project has no git settings, so it can't push to the original's branch. Set them up again if it should commit somewhere.
- Everything else behaves as described in [Restore and Roll Back](/concepts/restore).

## Create a project from a repository

You don't need an existing project to restore from git. On the home page, open the arrow next to **New Project** and choose **Restore from a git repository**:

1. Enter the **Repository URL**, the **Branch** and the **Folder** the backup is in (empty for the repository's root).
2. For a **public** repository, leave **Username** and **Token** empty. For a **private** one, enter a token with read access (a GitHub fine-grained token with "Contents: Read", a GitLab token with `read_repository`, or a Gitea token). The username is optional with a token.
3. Click **Find commits**. The newest 50 commits on the branch are listed, and the newest is picked. Pick another if you want an older backup.
4. Click **Continue**, review what the backup holds, enter the new project's name, and click **Create project**.

::: info The token is never stored
The username and token are sent with each request of this restore and are not saved anywhere: not in the new project, not in its history, not in the logs.
:::

- It needs a **System Administrator**, like every restore that creates a project.
- The new project has no git settings. Set them in **Project Settings → Backup → Git** if it should commit somewhere.
- Credentials and App Config values committed with **Encrypt secrets** on restore only on an instance with the same `MASTER_ENCRYPTION_KEY`. Otherwise the preview warns that they are left out.
- The largest backup that can be restored this way is 512 MB.

## Common errors

| Message | What to do |
| :--- | :--- |
| The git server refused the username or token | Check the App Config values the Username and Token point to, and that the token may push. |
| There is no repository at … | Check the URL, and that the token can see the repository. |
| The app config key … has no value | Give the key a production value, or choose another key. |
| Could not reach the git server | Check the URL, and that the Fluxify server can reach that host. |
| That commit holds no Fluxify backup in the folder … | The folder doesn't match where that commit's backup is. |
| There is no repository at …, or it is private: add a token | Check the URL. For a private repository, enter a token with read access. |
| There is no branch … in that repository | Check the branch name. A branch with no commits has nothing to restore. |

## Related

- [Project Backups](/concepts/backups)
- [Restore and Roll Back](/concepts/restore)
- [App Config](/concepts/app-config)
