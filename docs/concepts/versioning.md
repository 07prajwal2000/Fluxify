---
title: Versioning
description: How to save a named version of a route or workflow, look back through its history, bring an earlier version back, and promote a version to production or roll it back.
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

## What production serves

Production serves one version of each route and workflow: the one you **promoted**. Nothing else reaches it.

- Editing the working copy, committing and checking out never change what production serves. Development runs your edits as you save them; production keeps running the promoted version.
- A route or workflow with no promoted version serves nothing in production, even when its **Production** switch is on. Callers get `404` until you promote one.
- The switches, the name, recording and tracing are live settings. They apply to production straight away, whichever version is promoted.
- Triggers start the promoted version of their workflow on production.
- Custom blocks and middlewares are not versioned yet. Production runs their current state, so changing one changes what production runs.

### Promoting a version

**Promoting** puts a version live in production.

- You need the **Creator** role.
- You write a **description** of why. It is required and is kept in the log.
- Fluxify runs its checks first. If they all pass, production switches to that version. If one fails, nothing changes, and the log shows what failed and why.
- Promoting the version that is already live is refused.

| Check | What it looks at | Stops the promote? |
| :--- | :--- | :--- |
| Compiles | The version still builds. For example, a custom block it used may have been deleted. | Yes |
| Production values | Every integration and app config key the version's blocks use has a production value. The result lists each one that is missing. | Yes |
| Path is free | For a route: no other route's promoted version has the same method and path. | Yes |
| Custom blocks and middlewares | Lists the ones the version uses. They run their current state in production until custom blocks have versions. | No, a warning |
| Tests | Every test suite of the route or workflow is run against the version you are promoting. See [The tests check](#the-tests-check). | Yes, if any suite fails. A warning if there are no suites. |

### The tests check

The tests check runs last, after the others have passed.

- Every [test suite](/testing/) of the route or workflow runs against the **version you are promoting**, not against the working copy. Edits you have made since do not count.
- The suites run on the development worker with your **development** credentials and values, so a promote never writes to production data.
- If any suite fails, the promote fails. The result names each suite that did not pass, the cases that failed, and the first error.
- If there are no suites, the promote goes through and the result carries the warning **"No test suites: promoted without tests"**.
- If no development worker is running, the check fails with "start a worker with FLUXIFY_ENV=development".

Running suites can take a while, so a promote with suites stays **pending** until they finish, then becomes **live** or **failed**. The log shows it as pending meanwhile. Only one promote or rollback can run at a time for a route or workflow.

The suites that ran for a promote also show up in the [test run history](/testing/results) like any other run, tagged with the deployment.

### Rolling back

**Rolling back** is promoting an older version than the one that is live. It runs the same checks, tests included, and needs a description too. The log records it as a rollback, so you can tell the two apart.

Roll back to get production onto a version that worked, then fix the problem in the working copy and promote again.

### The log

Every promote and rollback is kept, newest first: the version, whether it was a promote or a rollback, the description, who did it and when, the result, and what each check said. A promote that was stopped by a check stays in the log as failed.

### Upgrading from before production versions

Routes and workflows that existed before this feature are not interrupted. Each one starts with a version called **Initial** that holds what it was serving, already live in production. If it already had versions, the new version is called "Live in production at upgrade" and follows the last one. Nothing needs to be done, and production serves exactly what it served before.

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
| Viewer | See the history, open any version and read the deployment log |
| Creator and project admin | Also commit, check out, promote and roll back versions |

## From the API and the AI agent

The AI agent can work with versions using six tools, and each one takes the kind (`route` or `workflow`) and the id.

| Tool | What it does |
| :--- | :--- |
| `commit_version` | Saves the working copy as the next version. It needs a title. |
| `list_versions` | Lists the versions, newest first, says which one is live in production, and says whether there are uncommitted changes. |
| `get_version` | Shows one version's canvas and settings, read-only. |
| `checkout_version` | Brings a version back. Uncommitted work is saved first. |
| `promote_version` | Puts a version live in production. |
| `rollback_version` | Puts an older version back live in production. It refuses a version that is not older than the live one. |

`promote_version` and `rollback_version` always ask a person first, in every mode, and the approval can't be given once for the whole chat. The person writes a comment with the approval, and that comment is the description in the log. The agent can add a short `note`, which is saved after the person's comment.

::: warning
The agent never promotes or rolls back unless you ask it to.
:::

The same actions are available over the admin API. Versions are under the route's or workflow's `/versions` address. Promote and rollback are a `POST` to its `/deployments` address with the version id and a description, and a `GET` there returns the log. A promote that a check stopped answers normally, with the status `failed` and the reasons in `gates`.

::: tip
Ask the agent to commit when a piece of work is finished and tested. A named version of working code is the easiest thing to come back to when the next change goes wrong.
:::

Getting a route or workflow also tells you the number of the current version, the number of the version production serves, and whether it has uncommitted changes.

Recorded runs from production say which version served them. Runs on development are not tied to a version, because they run the working copy.

## Related

- [Environments](/concepts/environments): what runs on production and on development.
- [Workflows](/concepts/workflows): background jobs, which are versioned the same way as routes.
