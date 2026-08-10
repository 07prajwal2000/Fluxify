---
title: We sandboxed test suite execution — and killed our own "obvious" fix along the way
date: 2026-08-10
author: Prajwal Aradhya
pinned: true
tags:
  - engineering
  - reliability
---

# We sandboxed test suite execution — and killed our own "obvious" fix along the way

Fluxify's test suites used to run inside the same process as the admin API. A route with an infinite loop, a leaked global, or a crash could take the whole admin server down with it — and one suite's state could bleed into the next. We just shipped a rework that moves suite execution into short-lived, isolated processes, adds a concurrency limit that respects real container memory, and replaces the old "wait for the response" flow with an async run you can poll for progress.

The interesting part of this project is what our original plan got wrong.

## Plan A: cap memory with a process limit

The initial design capped each isolated run with a standard OS process limit on virtual memory, alongside a limit on open file handles. It worked fine on a developer machine. It failed immediately in our Linux build pipeline — every run aborted with an out-of-memory error before any user code even ran.

The cause: our JavaScript runtime reserves a huge amount of virtual address space just to start up — well over a hundred gigabytes, on an otherwise idle process. A virtual-memory limit doesn't measure *actual* memory use, so any limit tight enough to catch a real problem also kills the runtime before it boots, and any limit loose enough to let it boot doesn't actually protect anything. There was no safe number to pick.

We dropped that limit entirely. Real memory protection now comes from the container's own memory cap, which is enforced by the operating system regardless of what happens inside.

## Plan B: back off when memory gets tight

The second piece was a concurrency limiter — don't spawn more test runs than the box can safely handle at once. Our first version checked how much memory the *host machine* reported as free.

Inside a container capped at 2 GB, the host still reported around 10 GB free — because "free" was being measured for the whole machine, not the container's actual allowance. A safety threshold checked against that number would never trigger. The limiter would always allow the maximum number of concurrent runs, exactly the situation it was built to prevent.

The fix was to read the container's *own* memory accounting directly, rather than asking the host. Tested against real constrained containers, the corrected version now genuinely throttles down to a single concurrent run when memory is tight, and opens back up when it isn't.

## What shipped

- Test suites run in isolated, disposable processes — a crash or an infinite loop can no longer take down the admin server.
- A concurrency pool caps how many suites run at once, based on the real memory available to the container, not the host.
- Starting a run now returns immediately with a run ID instead of blocking the request until every suite finishes.
- You can poll that run ID to watch suites complete one by one, with full run history kept for later review.

Two "obviously correct" fixes that don't survive contact with a real container — worth remembering the next time a safety limit needs picking on a hunch instead of a measurement.
