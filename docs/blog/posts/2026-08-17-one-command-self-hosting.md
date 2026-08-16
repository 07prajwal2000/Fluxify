---
title: Fluxify now starts from a single docker run
date: 2026-08-17
author: Prajwal Aradhya
tags:
  - release
  - self-hosting
  - engineering
---

# Fluxify now starts from a single docker run

Trying Fluxify used to mean copying an environment file, filling in a database URL, a cache host, and an event bus token, then bringing up four containers with `docker compose` before you'd seen a single screen of the product. That's a reasonable price to pay for a production deployment, but it's the wrong first five minutes for someone who just wants to see what Fluxify does.

The trial image now ships everything it needs. One command:

```bash
docker run -d --name fluxify \
  -p 8080:8080 \
  -v fluxify_data:/data \
  -e SEED_USER_EMAIL=admin@example.com \
  -e SEED_USER_PASSWORD=ChangeThisPassword123! \
  fluxify-kit
```

and you have a complete stack: the dashboard, the API, the database, the cache, and the event bus, all up and healthy behind port `8080`.

## Still the same image, still your choice

Nothing was removed. Bringing your own database, cache, and event bus with `docker compose` is still fully supported, for anyone who wants their data in infrastructure they already manage. The image just decides for itself which mode to run in: if you hand it a database connection string, it uses yours, and if you don't, it starts its own inside the container. Same image, same compose file, no separate build to maintain.

## What actually changed underneath

Getting a single container to boot a full stack reliably surfaced a handful of problems that only show up once everything genuinely has to start together and stay up:

- **A dead service used to leave the container "running."** If one internal piece crashed, the container kept reporting healthy while quietly serving nothing. Now the whole container exits the moment anything inside it dies, so your restart policy actually gets a chance to fix it, instead of a demo that looks fine and answers nothing.
- **The health check was pointed at a URL that didn't exist**, so a perfectly healthy instance could never report itself as ready.
- **A missing admin email or password used to fail late and vaguely.** A fresh instance now refuses to start at all without both, rather than coming up with no way to log in.
- **The dashboard is a static bundle now**, served directly rather than run as its own Node process. One less moving part inside the container, and the whole thing comes in under 340MB.

None of this changes how you run Fluxify in production, that path is untouched and still the recommended one for anything beyond a trial. It changes how long it takes to find out whether Fluxify is worth running in production at all.

## A UI to actually test what you build

The other big piece this week: `apps/portal`, the current dashboard, had no way to create or run test suites at all. The backend for sandboxed test execution had been built out over a run of earlier issues, but every screen for it lived only in the legacy dashboard, so once that gets retired a user could build routes and blocks but never write a single test for them. [Issue #227](https://github.com/Fluxify-rest/Fluxify/issues/227) tracked closing that gap, and [PR #253](https://github.com/Fluxify-rest/Fluxify/pull/253) shipped it.

The new UI covers the full loop: create and edit a suite for a route, define assertions against the status code, body, headers, timing, or a custom JS check, override app config and integrations so a test run doesn't touch production data, then run one suite or every suite for a route and watch results fill in as they finish rather than waiting on a single spinner. A run that times out or errors says so plainly instead of showing an empty result.

![Test suite UI showing run results for a route](/test-suites/demo-blog.png)

## Try it

Full walkthrough, including how to point it at your own database instead of the bundled one, is in the [Kit deployment guide](/deployments/kit).
