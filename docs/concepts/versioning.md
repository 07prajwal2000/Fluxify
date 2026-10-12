---
title: Versioning
description: How to save a named version of a route, workflow, custom block or middleware, look back through its history, bring an earlier version back, and promote a version to production or roll it back.
---

# Versioning

A **version** is a named copy of a route or workflow, saved at a moment you choose. Versions give you a history to look back through and a safe way to return to something that worked. Custom blocks and middlewares have versions too; see [Custom blocks and middlewares](#custom-blocks-and-middlewares).

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
- Custom blocks and middlewares have versions too. Production runs the version of each that was promoted, never its latest edit. See [Custom blocks and middlewares](#custom-blocks-and-middlewares).

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
| Custom blocks and middlewares | Every custom block and middleware the version uses, directly or through another one, is live in production. The result lists each one that is not, with its name. | Yes |
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

Custom blocks and middlewares that existed before they had versions are handled the same way: each starts with an **Initial** version that is already live, so production keeps running exactly what it ran.

## Custom blocks and middlewares

Custom blocks and middlewares have versions, a history and a production version, just like routes and workflows.

**Development always runs a block's latest saved state. Production runs its promoted version.** Editing a custom block, or a middleware's chain, changes development straight away and leaves production alone until you promote a version.

### What a version holds

| Kind | Saved in a version | Stays live |
| :--- | :--- | :--- |
| Custom block | Its canvas, its inputs, and where it may run | Its name, label, icon, description and docs |
| Middleware | The blocks in its chain, in order | Its name and description |

The name stays live because it is how routes find the block.

### It works like a shared library

A custom block or middleware is shared by every route and workflow that uses it. So promoting one, or rolling one back, changes what **every production route and workflow that uses it** does, without promoting any of them.

- Production routes call the block's promoted version. A route you promote later does not pin the block to the version it was tested with.
- Rolling a route back never touches its blocks, and rolling a block back changes it for everyone who uses it.

### What a promote of a block checks

Promoting a custom block or middleware runs the same checks as any promote, and the tests check works on its users:

- It finds every route and workflow whose **promoted** version uses the block, directly or through other custom blocks or middlewares. Test suites that use the block as a setup, teardown or input hook are included.
- Each of those runs its own test suites, on its promoted version, with the new block in place. They use your development credentials and values, so nothing touches production data.
- If any suite fails, the promote fails and production keeps the old version. The result lists each route and suite that failed.
- If nothing in production uses the block yet, the promote goes through with the warning **"Not used in production yet"**.

A route or workflow you only edited, and have not promoted with the block, is not affected and its suites do not run.

### A route can't go live while its blocks aren't

Before a route or workflow is promoted, every custom block and middleware it uses, and every one those use, must have a promoted version. If one has none, the promote fails and lists each one by name. Promote those first, then promote the route.

In the portal, a route or workflow promote that fails this way lists each missing block or middleware with a **Commit & promote** button. Select it to commit that block's work, if it has any, and promote it right there, watching its own checks. There is no chain: this promotes the one you picked, and if it uses others that are not live, they are listed when you promote it. When every one on the list is live, **Try again** re-runs the route's promote.

The test suites of a route are run with the promoted version of each block, not with the version you are editing. The same goes for a test hook: its promoted version runs in production test runs, so it has to be promoted too.

### Deleting a custom block or middleware

A delete is refused while a route, workflow, custom block, middleware or test suite hook uses it. This includes uses in a promoted version, even if the working copy no longer uses it. The error lists what still uses it.

In the portal, a refused delete keeps its confirmation dialog open and shows the message with the same rows as **Used by**, so you can open what still uses it and remove the use there. The delete goes through once nothing uses it.

- Older versions that are not live do not block a delete. Checking one of them out later shows a compile error for the missing block.
- Sandboxes do not count. A sandbox that uses a deleted block fails when you run it, with the message **Custom block not loaded** and the block's name. Nothing else is affected.

### Where it is used

Each custom block and middleware can list everything that uses it: routes, workflows, other custom blocks, middlewares and test suite hooks, each marked when its promoted version uses it. Sandboxes are not listed. The list is available over the admin API and the AI agent.

In the portal, the list is the **Used by** section of the block's or middleware's settings. Each row shows its kind and name and opens it; a test suite opens the tests page of the route or workflow it belongs to. A row is tagged **In production** when that user's promoted version uses the block, and **Working copy** when its working copy does. When nothing uses it, it says **"Not used anywhere yet."**

### Committing and promoting in the portal

The custom block canvas and the middleware editor have the same **Commit** button and **Version history** as a route or workflow. The **Prod vN** chip sits in the header and opens the history on its **Production** tab. Creators commit and promote; viewers can read the history.

**Version history** for a custom block opens its version's canvas beside its inputs and where it may run, all read-only. For a middleware it shows the version's chain, in order, read-only. **Open in sandbox** and **View recordings** are not offered for a block or a middleware: a sandbox and a recorded run belong to a route or a workflow.

Because a block or middleware is shared, its promote dialog says how many production routes and workflows will change, for example **"3 production routes and workflows will change"**. Select it to open the same **Used by** list, so you can see which ones before you promote.

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

**Version history** has two tabs — **Versions** (the default) and **Production** — with the canvas of the version you pick on the right.

- Each version shows its number, title, who saved it and how long ago. Hover over the time to see the exact date and hour.
- The version the working copy came from is tagged **HEAD**.
- The version production serves is tagged **In production**.
- The **Production** tab names the version that is live and lists the promote/roll back log. See [The production tab](#the-production-tab).
- If the working copy has uncommitted changes, the top of the list says **Uncommitted changes**, carries the **HEAD** tag instead (no version does), and links back to the canvas to commit them.
- The canvas on the right is read-only. You can open a block to read its settings, but nothing can be changed or saved. The path, method, schemas, timeout and middlewares of that version are shown beside it, also read-only.
- **Back to canvas** takes you to the working copy. The settings panel beside the version can be collapsed with the toggle at the right of the header.
- A route or workflow with no versions yet says "No versions yet. Commit to save the first one."

### The version menu

Each version has a **⋯** menu. **Open in sandbox** and **View recordings** appear for a route or a workflow only; a custom block's or middleware's menu offers the rest.

| Action | What it does | Who |
| :--- | :--- | :--- |
| **Check out** | Makes this version the working copy. See below. | Creators and project admins |
| **Open in sandbox** | Copies this version's blocks into a new sandbox of yours and opens it. The route or workflow is not changed. | Creators and project admins |
| **Promote to production** | Puts this version live. Shown on a version that is not live. See below. | Creators and project admins |
| **Roll back to this version** | Puts an older version live again. Shown instead of Promote when the version is older than the live one. | Creators and project admins |
| **View recordings** | Opens the version's runs on the route's or workflow's **Executions** page. See below. | Creators and project admins |
| **Copy version id** | Copies the id of the version, for example to give it to an agent. | Everyone |

### Checking out

**Check out** asks you to confirm.

- If the working copy has uncommitted changes, the dialog also asks for a **title** for the version that saves them. It starts as "Saved before checking out v3". Change it if you like.
- When it is done you see "Checked out v3", and "Saved your work as v5" if your changes were saved first. You land on the canvas.
- If another route has taken the path and method since, the dialog shows the reason and nothing changes.

### Promoting and rolling back in the portal

Pick **Promote to production** (or **Roll back to this version**) from a version's menu to open the dialog.

1. Write a **description** of why. It is required and is kept in the log.
2. Select **Promote** (or **Roll back**).

The dialog then shows the checks live, one row each, while they run:

| Check | What it shows |
| :--- | :--- |
| Compiles | Whether the version still builds |
| Production values | Whether every integration and app config key has a production value |
| Production path is free | Routes only: whether another route's live version uses the same method and path |
| Custom blocks and middlewares | Whether everything the version uses is live in production; a failure lists what to promote first |
| Tests | The result of running every suite against this version |

Each row carries a status: passed, failed, a warning, skipped, or a spinner while it runs. When they all pass the dialog says **Live in production** and the version's badge moves. If one fails, the dialog stays open with the reason and production is unchanged.

Running the tests can take a while, so with suites the promote stays **pending** for a bit. You can close the dialog while it runs — a message tells you when it finishes.

If another promote or roll back is already running for the route or workflow, the dialog says **"A deployment is already in progress"** and nothing changes.

### The production tab

The **Production** tab of **Version history** names the version that is live, or says **Not in production yet**, and lists every promote and roll back, newest first:

- The version number, whether it was a **Promote** or a **Rollback**, and its result.
- Only the promote or roll back serving production now says **Live**; an earlier successful one says **Promoted** or **Rolled back**. A run in progress says **Pending**, and a failed one says **Failed**.
- The description, who did it, and how long ago. Hover over the time to see the exact date and hour.
- For a failure, **Show failed checks** opens the checks with their reasons. A failed **Tests** check links straight to that run's results.

### The production chip

On a route's or workflow's canvas, and on its Tests, Executions and Versions pages, a small chip in the header shows **Prod vN** for the live version, or **Not in production**. Select it to open the history on its **Production** tab.

### From the command palette

On the canvas, open the command palette (Cmd/Ctrl+K or Cmd/Ctrl+Space) for this route's or workflow's own actions:

- **Go to version history** — opens the history.
- **Commit…** — opens the commit dialog, saving unsaved edits first.
- **Open in sandbox** — copies the canvas into a new sandbox. Creators and project admins only.

### Viewing a version's recordings

**View recordings** opens the target's **Executions** page, showing only the production runs that served this version. Each run row carries its version (**vN**), and development runs say **working copy**. **Show all runs** drops the filter.

A development run is not tied to a version, because it runs the working copy; only a production run says which version served it.

## Who can do what

| Role | What they can do |
| :--- | :--- |
| Viewer | See the history, open any version and read the deployment log |
| Creator and project admin | Also commit, check out, promote and roll back versions |

## From the API and the AI agent

The AI agent can work with versions using six tools, and each one takes the kind (`route`, `workflow`, `custom_block` or `middleware`) and the id.

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

The same actions are available over the admin API. Versions are under the route's, workflow's, custom block's or middleware's `/versions` address. Promote and rollback are a `POST` to its `/deployments` address with the version id and a description, and a `GET` there returns the log. A promote that a check stopped answers normally, with the status `failed` and the reasons in `gates`. When the custom blocks check fails, or the tests of a block's users fail, the gate also carries `refs`: each custom block, middleware, route or suite with its kind, id and name.

A custom block's or middleware's `/references` address lists what uses it. A `DELETE` of one that is still used answers `409` with the same list under `references`. `get_custom_block` and `get_middleware` show the same list, the version production runs and whether there are uncommitted changes.

::: tip
Ask the agent to commit when a piece of work is finished and tested. A named version of working code is the easiest thing to come back to when the next change goes wrong.
:::

Getting a route or workflow also tells you the number of the current version, the number of the version production serves, and whether it has uncommitted changes.

Recorded runs from production say which version served them. Runs on development are not tied to a version, because they run the working copy.

## Related

- [Environments](/concepts/environments): what runs on production and on development.
- [Workflows](/concepts/workflows): background jobs, which are versioned the same way as routes.
- [Middlewares](/concepts/middlewares): chains of custom blocks that routes run before and after.
- [Custom blocks](/blocks/custom-blocks-tutorial): reusable blocks that routes and workflows share.
