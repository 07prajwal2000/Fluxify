---
title: Contributing to Fluxify
description: How to contribute to Fluxify — where to find the full contributor guide, what kinds of contributions are welcome, and how to get help.
---

# Contributing to Fluxify

Fluxify is open source, and contributions of every size are welcome — a typo
fix, a new workflow block, a security improvement, or a whole feature.

> [!IMPORTANT]
> **The full contributor guide lives in the repository**, next to the code it
> describes, so the two can never drift apart:
>
> ### 👉 [**CONTRIBUTING.md**](https://github.com/fluxify-rest/Fluxify/blob/main/CONTRIBUTING.md)
>
> It covers prerequisites, step-by-step local setup, the fast inner-loop
> commands, where to put your change, testing, and pull request guidelines.

---

## What you'll need

| Tool | Minimum version |
| :--- | :--- |
| [Bun](https://bun.sh) | `v1.4.2+` |
| Docker | `v20.10+` |
| Git | `v2.30+` |
| GitHub CLI (`gh`) | `v2.0+` *(recommended)* |

---

## Getting set up, in brief

```bash
git clone https://github.com/YOUR_USERNAME/Fluxify.git && cd Fluxify
bun install
docker compose up -d
cp env.example .env
bun run db:migrate
bun run dev:server
```

Then create a project in the dashboard, put its id in `.env` as
`WORKER_PROJECT_ID`, and run `bun run dev` to start everything.

::: tip Why the two-step start?
Each request worker serves exactly one project, so it can't start before a
project exists. This is a one-time step — see
[Request Lifecycle](/architecture/request-lifecycle) for why the system is built
this way, and [CONTRIBUTING.md](https://github.com/fluxify-rest/Fluxify/blob/main/CONTRIBUTING.md)
for the detailed walkthrough.
:::

---

## Ways to contribute

| Kind | Good first place to look |
| :--- | :--- |
| **Bug fixes** | [Open issues](https://github.com/fluxify-rest/Fluxify/issues) labelled `bug` |
| **New workflow blocks** | The [Blocks](/blocks/) reference, to see what already exists |
| **Documentation** | Anything on this site that confused you |
| **Integrations** | The [Integrations](/integrations/) section |
| **Testing & bug reports** | Try the [Kit deployment](/deployments/kit) and tell us what breaks |

> [!WARNING]
> **Alpha software.** Platform architecture and internal APIs still change
> between releases. For anything large, open an
> [issue](https://github.com/fluxify-rest/Fluxify/issues) or
> [discussion](https://github.com/fluxify-rest/Fluxify/discussions) first, so
> your work doesn't collide with something already in flight.

::: warning Enterprise code is licensed differently
Code in an `ee` folder, or in a file with `.ee.` in its name, is under the
Enterprise Edition License, not Apache 2.0. Contributing to it gives Fluxify
full rights to use and sell your change. See
[Licenses and Contributions](/deployments/licensing).
:::

---

## Writing documentation

Docs on this site are written for **everyone** — junior developers, people
evaluating Fluxify, and non-technical readers. When you edit them:

- Explain **what happens** and what to expect, not how it's built internally.
- Use concrete examples with realistic inputs and outputs.
- Reach for tables and callouts (`::: tip`, `::: info`) to keep pages scannable.
- Diagrams are supported — use a ` ```mermaid ` code fence.

Every page should make sense to someone reading it cold.

---

## Cutting a release

For maintainers. A release is **a tag and nothing else** — pushing an annotated
`v*` tag to `main` runs the whole test suite, then builds and pushes the three
images and publishes the GitHub release.

```bash
git tag -a v0.1.0-alpha.1 -m "v0.1.0-alpha.1"
git push origin v0.1.0-alpha.1
```

| | |
| :--- | :--- |
| Images published | `fluxify-admin`, `fluxify-orchestrator`, `fluxify-worker`, all three on every release |
| Tags they get | The version tag, plus `alpha`/`beta`/`rc` for a pre-release or `latest` for a stable one |
| Release notes | Generated from the commits since the previous tag, with the pull commands prepended |
| A pre-release | Any tag with a hyphen (`v0.1.0-alpha.1`). Marked as a pre-release, and never becomes the repo's "Latest release" |

Nothing is published if any test fails, and nothing is announced unless all
three images pushed. To redo a release, delete the tag **and** the GitHub
release, then tag again — the workflow leaves an existing release alone.

::: warning Do not tag a pre-release as stable
`latest` is what an unpinned `docker pull` gets. The first tag without a
hyphen creates it, so don't tag `v1.0.0` until it really is.
:::

---

## Getting help

- 💬 [GitHub Discussions](https://github.com/fluxify-rest/Fluxify/discussions) — questions and ideas
- 🐛 [GitHub Issues](https://github.com/fluxify-rest/Fluxify/issues) — bugs and feature requests
- 📖 [Architecture](/architecture/) — how the platform actually works

Thank you for helping build Fluxify! 🚀
