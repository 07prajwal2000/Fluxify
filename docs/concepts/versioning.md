---
title: Versioning
description: How to save a named version of a route or workflow, look back through its history, and bring an earlier version back without losing any work.
---

# Versioning

A **version** is a named copy of a route or workflow, saved at a moment you choose. Versions give you a history to look back through and a safe way to return to something that worked.

Versions are numbered in order for each route or workflow: v1, v2, v3 and so on. Each one has a title, an optional description, the person who saved it and the time.

## What a version holds

| Saved in a version | Stays live, not part of a version |
| :--- | :--- |
| The blocks and the connections between them | The name and description |
| The block settings and where each block sits on the canvas | The **Active** and **Development active** switches |
| The route's path and method | Recording and tracing settings |
| The body, query and params schemas | Triggers and test suites |
| The timeout | |
| The middlewares a route uses, before and after, in order | |

Things in the right-hand column are settings about *how you run* the route, not what the route *is*. Turning a route off, renaming it or switching recording on never creates a change that needs saving, and going back to an old version never flips them back.

## The working copy

The route or workflow you edit is its **working copy**. Every save you make to it still goes live on development straight away, exactly as before. A version is a copy you take of it, so the working copy keeps going.

The working copy has **uncommitted changes** when it differs from the version it came from. Editing the canvas, or changing the path, method, schemas, timeout or middlewares, makes it so. Changing the name or a switch does not.

## Committing a version

**Committing** saves the working copy as the next version.

- Give it a title that says what the work is, for example "Add rate limiting". A good title is what makes the history useful later.
- Add a description if the title is not enough.
- Committing does not deploy anything and does not change how the route runs. It only keeps a copy.
- If nothing has changed since the last version, there is nothing to commit and Fluxify says so.

A version is final once it is saved. You can't edit or overwrite it. If you want to change something, change the working copy and commit again.

## History

Every route and workflow has a list of its versions, newest first. For each one you can see:

- The number, title and description.
- Who saved it and when.
- Which version it came from.
- Which version is the **current** one, the one the working copy was last committed or checked out at.

You can open any version to read its blocks and settings. Opening a version only reads it; nothing changes.

## Going back to an earlier version

**Checking out** a version puts it back as the working copy: its blocks, connections and settings replace what is there now.

- If the working copy has uncommitted changes, they are **saved first as a new version**, so nothing is lost. You can give it a title. If you don't, it is called "Saved before checking out v3" (using the number you are going back to).
- Blocks keep the same ids and keys they had, so a block you read earlier is still the same block.
- Development picks up the restored route straight away.
- The next version you commit follows the one you checked out.

For example, with v1, v2 and v3 and some uncommitted work:

1. Check out v3. The uncommitted work becomes v4, and the working copy is now v3.
2. Make a change and commit it. That is v5, and it follows v3.

v4 is still there in the history, so you can return to it any time.

::: info
A route can only be brought back if its path and method are still free. If another route has taken that path and method since, the checkout is refused and nothing changes. Change the other route, or the path of this one, and try again.
:::

If a middleware that a version used has since been deleted, the checkout still works. The deleted middleware is left out and you are told.

## In the portal

### Commit

The canvas header of a route or workflow has a **Commit** button. A small dot sits on it while the working copy has changes no version holds.

1. Select **Commit**.
2. Give the version a **title**. It is required. A **description** is optional.
3. Select **Commit**. You see "Committed v3" and the dot goes away.

- If the canvas has edits you have not saved yet, the dialog says so and the button reads **Save and commit**. Your edits are saved first, then committed.
- If there is nothing to commit, the button is greyed out and tells you so when you hover over it.
- Next to **Commit** is a small arrow. It opens a menu with **Version history**.
- Viewers do not see **Commit**. They see a **Version history** button instead.

### Version history

**Version history** shows the versions of the route or workflow, newest first, with the canvas of the one you pick next to them.

- Each version shows its number, title, who saved it and how long ago. Hover over the time to see the exact date and hour.
- The version the working copy came from is tagged **Current**.
- If the working copy has uncommitted changes, the top of the list says **Uncommitted changes**. Select it to go back to the canvas and commit them.
- The canvas on the right is read-only. You can open a block to read its settings, but nothing can be changed or saved. The path, method, schemas, timeout and middlewares of that version are shown beside it, also read-only.
- **Back to canvas** takes you to the working copy.
- A route or workflow with no versions yet says "No versions yet. Commit to save the first one."

### The version menu

Each version has a **⋯** menu.

| Action | What it does | Who |
| :--- | :--- | :--- |
| **Check out** | Makes this version the working copy. See below. | Creators and project admins |
| **Open in sandbox** | Copies this version's blocks into a new sandbox of yours and opens it. The route or workflow is not changed. | Creators and project admins |
| **Copy version id** | Copies the id of the version, for example to give it to an agent. | Everyone |

### Checking out

**Check out** asks you to confirm.

- If the working copy has uncommitted changes, the dialog also asks for a **title** for the version that saves them. It starts as "Saved before checking out v3". Change it if you like.
- When it is done you see "Checked out v3", and "Saved your work as v5" if your changes were saved first. You land on the canvas.
- If another route has taken the path and method since, the dialog shows the reason and nothing changes.

## Who can do what

| Role | What they can do |
| :--- | :--- |
| Viewer | See the history and open any version |
| Creator and project admin | Also commit and check out versions |

## From the API and the AI agent

The AI agent can work with versions using four tools, and each one takes the kind (`route` or `workflow`) and the id.

| Tool | What it does |
| :--- | :--- |
| `commit_version` | Saves the working copy as the next version. It needs a title. |
| `list_versions` | Lists the versions, newest first, and says whether there are uncommitted changes. |
| `get_version` | Shows one version's canvas and settings, read-only. |
| `checkout_version` | Brings a version back. Uncommitted work is saved first. |

The same actions are available over the admin API, under the route's or workflow's `/versions` address.

::: tip
Ask the agent to commit when a piece of work is finished and tested. A named version of working code is the easiest thing to come back to when the next change goes wrong.
:::

Getting a route or workflow also tells you the number of the current version and whether it has uncommitted changes.

## Related

- [Environments](/concepts/environments): what runs on production and on development.
- [Workflows](/concepts/workflows): background jobs, which are versioned the same way as routes.
