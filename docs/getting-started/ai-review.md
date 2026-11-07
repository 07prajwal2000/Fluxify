---
title: AI Review and Canvas Chat
description: Have AI review a route or workflow for security, correctness, test coverage, schema and performance problems, and ask the agent about a canvas from the chat on the canvas.
---

# AI Review and Canvas Chat

Two AI tools sit on every route and workflow canvas:

- **AI review**, in the Diagnostics panel, reads the whole route or workflow and
  lists problems with a suggested fix for each.
- **The canvas chat**, behind the AI button in the bottom right corner, is the
  same agent as the AI page, in a side panel next to the canvas.

Both run on the AI connection picked in the project's settings, under
**Settings → AI configuration**. Without one, the review and the chat show a link
to that page instead.

## AI review

Open **Diagnostics** on a route or workflow canvas and click **Review with AI**.
The review runs in the background: keep editing, or leave the page and come
back. The panel shows **Reviewing** until the report is ready, usually within a
minute.

### What it checks

| Category | Examples |
| :--- | :--- |
| Security | A route that reads or changes data with no auth check, request input reaching SQL, JavaScript, an HTTP call or a file path without validation, a password or key typed into a block |
| Correctness | A failure path left unconnected, a branch that never sends a response, blocks nothing reaches, a value read from a field that is never set |
| Test coverage | Branches and error paths no test suite runs, or no test suites at all |
| Schema | A request schema that does not match what the blocks read, responses whose shape differs between branches |
| Performance | A database or HTTP call inside a loop, a query with no limit |

To do this it reads the canvas and its block settings, the request schemas, the
middlewares and custom blocks the route uses, and its test suites.

### The report

The report starts with a short summary, then one entry per problem:

- **Severity**: error (it will break, or can be abused), warning (probably
  wrong), or info (worth knowing).
- **Category** and the **block** it is about. Click an entry to select that
  block on the canvas and open its settings.
- **Fix**: what to change.
- **Ask the agent to fix this** opens the canvas chat with the problem already
  written into a new message. Read it, edit it if you like, and send it.

Findings are suggestions. They stay in the AI review section and never mark
blocks on the canvas, because AI can be wrong. Check each one before acting on
it.

::: info One report per route or workflow
Only the latest report is kept. **Run again** replaces it. While a review runs,
**Cancel** stops it.
:::

### When the report is out of date

The report remembers the version of the canvas it read. Once the canvas is
saved again, the report says **Reviewed an older version**. Click **Run again**
for a fresh one.

### Who can use it

| Role | Can |
| :--- | :--- |
| Viewer | Read the report |
| Creator and above | Start, re-run and cancel a review, and ask the agent to fix a finding |

### Safety and cost

- **It only reads.** The review cannot change, save, run or deploy anything.
- **Secrets stay out.** It sees the names of app config keys and integrations,
  never their values.
- **Text in blocks is treated as data.** If a block contains something that
  looks like an instruction to the AI, the review does not follow it.
- **It uses the project's AI budget.** A review counts as one AI request toward
  the hourly limit per person, and must fit within the project's token budget and
  context window (**Settings → AI configuration**). A route too large for them fails with a
  message saying so, before anything is sent to the model.

## The canvas chat

Click the AI button in the bottom right corner of a canvas to open the chat in
a side panel, in the same place as Diagnostics and the block settings. Only one
of the three is open at a time. Drag the panel's left edge to make it wider,
and double-click the edge to reset it.

The chat works like the AI page: the agent asks before it changes anything (in
Manual mode), and every change shows up in the canvas once you reload it.

- **Conversations** (the button at the top left) lists the project's chats.
  Click one to carry on with it here.
- **New chat** (the plus icon) starts over.
- **Open in AI page** (the expand icon) carries on in the full-size AI page.
- A chat started here is also listed on the AI page.

The AI button is hidden on a read-only canvas.
