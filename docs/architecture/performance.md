---
title: Performance
description: Load test results for a URL shortener built in Fluxify without code, before and after the first round of performance work, compared with the same app hand-written in Bun and in Node.js.
---

# Performance

This page shows how a real Fluxify app behaves under load, and how it compares
with the same app written by hand. The app is a URL shortener with three
endpoints, hit by hundreds of simulated users at once.

::: info About these numbers
Fluxify is in alpha. The routes were built by dragging and dropping blocks,
with no code and no tuning. The first round of performance work has landed:
the **Fluxify** column is the current release, and **Fluxify (first test)** is
the original baseline. This is one test on one developer machine, with the load generator
running next to the app, so your results will differ. A route that waits on a
slow external service will be dominated by that wait.
:::

## What was tested

| Endpoint | What it does |
| :--- | :--- |
| Get URL by id | Returns which URL a short id points to |
| Create short URL | Saves a new short URL and returns its id |
| Redirect | The public link that sends a visitor to the target URL |

The same three endpoints were built three ways, all behaving identically:

| | How it was built |
| :--- | :--- |
| **Fluxify** | Drag and drop in the portal, no code |
| **Bun** | Hand-written TypeScript on Bun, using the Hono web framework |
| **Node.js** | The same hand-written code on Node.js 24 |

Each one ran as **2 copies, each limited to 1 CPU and 1 GiB of memory**, behind
the same proxy, with the same PostgreSQL database (1 CPU) and the same
Redis-compatible cache in front for reads. The database held 680,000 short URLs in the first test and about 730,000 to
920,000 in the later runs, as each run added new ones. The cache started empty for every run.

| | |
| :--- | :--- |
| Users | **500 at once**, ramped up over 10 seconds and held for 40 |
| Pace | Each user sends the next request as soon as the last one returns |
| Duration | 1 minute per run |

Traffic was a realistic mix: 65% reads of links that exist, 20% reads of links
that don't (these return "not found" and always reach the database), and 15%
new short URLs.

## Results

| | Fluxify | Fluxify (first test) | Bun | Node.js |
| :--- | :--- | :--- | :--- | :--- |
| Throughput | **6,500 to 7,300 per second** | 4,755 per second | **9,566 per second** | 4,915 per second |
| Failed requests | 0 | 0 | 0 | 0 |
| Median response time | 56 to 61 ms | 81 ms | 41 ms | **18 ms** |
| 95th percentile | 109 to 123 ms | 171 ms | **83 ms** | 448 ms |
| CPU used per request | not measured | 0.42 ms | **0.21 ms** | 0.40 ms |
| Worker memory, idle | about 161 MiB | about 270 MiB | | |
| Worker memory, under load | about 207 MiB | | | |

The current Fluxify numbers are the range over three runs of the same test
(6,464, 6,715 and 7,273 requests per second). Runs on one machine differ by
up to about 12%, so read them as a range, not a single figure.

### Response time by request type, first test (median / 95th percentile)

Only the first test was broken down by request type.

| | Fluxify | Bun | Node.js |
| :--- | :--- | :--- | :--- |
| Redirect, link exists | 75 / 157 ms | 37 / 67 ms | 15 / 68 ms |
| Get by id, link exists | 72 / 151 ms | 37 / 67 ms | 15 / 70 ms |
| Redirect or get, link not found | 89 / 178 ms | 48 / 94 ms | 57 / 499 ms |
| Create | 107 / 206 ms | 57 / 103 ms | 59 / 501 ms |

## What to expect

- **No errors under load.** Every redirect, lookup, "not found" and create
  returned the right answer, for all three.
- **Fluxify, with no code written, now handles more traffic than a
  hand-written Node.js server.** About 6,500 to 7,300 requests per second
  against 4,900, up from about 4,800 in the first test.
- **A hand-written Bun server still handles more**: about 9,600 requests per
  second, so Fluxify is now at roughly 70 to 75% of it, up from about 50%.
- **Fluxify's response times are steady.** The slowest 5% of requests were
  under 125 ms, down from about 170 ms. The Node.js version was quicker for
  most requests, but its slowest ones took about 500 ms whenever they reached
  the database.
- **Each worker uses less memory.** An idle worker went from about 270 MiB to
  about 161 MiB, and stays near 207 MiB under full load.
- **Requests that reach the database are the slow ones** for all three. Links
  served from the cache are faster everywhere.
- **The app copies' CPU was the limit** in all three runs, so the comparison is
  CPU against CPU. If you need more, add copies or give each more CPU.

::: warning Removing a worker during traffic
Scaling down while requests are flowing can fail a small number of them. In one
test, 802 of 406,256 requests (0.19%) failed in the seconds after a worker was
removed. A fix is being tracked in
[issue #940](https://github.com/Fluxify-rest/Fluxify/issues/940).
:::

## Run it yourself

The full report, with every setting, the CPU use of each container, the
earlier test runs and the caveats, is on GitHub:
[URL shortener report](https://github.com/Fluxify-rest/Fluxify/blob/main/testing/load-testing/url-shortener/report.md).
The test scripts, the exported routes and both hand-written servers sit next to
it, so you can run the same test against your own stack. The
[Deployments](/deployments/) guide covers standing one up. Use your own routes
and data for the numbers that matter to you.
