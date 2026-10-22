# URL Shortener: Fluxify vs hand-coded servers

Run date: 2026-10-22. Part of #934. Scripts: [`k6/stress.js`](k6/stress.js).

## Summary

The same URL shortener, built three ways, under the same load: 500 concurrent users for 1 minute, 2 app instances at 1 CPU each, behind the same proxy, against the same Postgres (1 CPU) and cache.

| | Fluxify | Bun + Hono | Node.js + Hono |
| :--- | :--- | :--- | :--- |
| How it was built | Drag and drop in the portal, no code | Hand-written TypeScript | Hand-written TypeScript |
| Requests in 1 min | 285,315 | 573,984 | 294,934 |
| Throughput | 4,755 /s | **9,566 /s** | 4,915 /s |
| Failed requests | 0 | 0 | 0 |
| Latency median | 81.2 ms | 41.2 ms | **17.9 ms** |
| Latency p95 | 171.2 ms | **82.5 ms** | 448.3 ms |
| App CPU per request | 0.42 ms | **0.21 ms** | 0.40 ms |

- Fluxify, built without writing code, serves about **the same throughput as a hand-written Node.js server** (4,755 against 4,915 requests/s) and costs about the same CPU per request.
- A hand-written Bun server serves about **twice** as much (9,566 requests/s) on the same CPU.
- Fluxify is in alpha. This is its out-of-the-box result with no code-level tuning, so it is the baseline for the performance work planned to close the gap to the Bun stack.

## What was compared

All three expose the same three endpoints with the same behavior: same validation, status codes, cache key (`url:<id>`), 1-hour cache time, and the same up-to-3-try id insert on collision.

| | Fluxify | Bun + Hono | Node.js + Hono |
| :--- | :--- | :--- | :--- |
| Source | Routes in the project (`routes/`) | [`server/`](server/) | [`server-node/`](server-node/) |
| Runtime | Fluxify compiled worker (Bun) | Bun | Node.js 24 |
| HTTP | Fluxify worker | Hono on `Bun.serve` | Hono on `@hono/node-server` |
| Postgres | Fluxify database adapter (Bun SQL) | Bun SQL | `pg`, pool of 10 |
| Cache | Fluxify KV block | `ioredis` | `ioredis` |
| Instances | 2 workers | 2 containers | 2 containers |

The Bun and Node.js servers share one id generator ([`id.ts`](id.ts)): 7-character base62, unbiased.

| Endpoint | Behavior |
| :--- | :--- |
| `POST /api/urls` | Valid http(s) URL up to 2048 characters, else 400. Stores it, caches it, returns 201 with the id. |
| `GET /api/urls/:id` | Cache first, then Postgres (refilling the cache). 200 with the URL, or 404. |
| `GET /r/:id` | Same lookup. 302 with `Location`, or 404. A malformed id returns 404 without a lookup. |

## Test shape

| | |
| :--- | :--- |
| Tool | k6 v0.56.0, run natively on the same machine |
| Ramp | 10 s up to 500 VUs, 40 s hold, 10 s down (1 minute) |
| Pacing | None; each VU sends its next request as soon as the last one returns |
| Cache | Valkey flushed immediately before each run, so it starts cold |
| Ids | 20,000 real ids sampled at random from the table (`config/ids.txt`) |
| Data | `short_urls` held about 680,000 rows during these runs (each run adds its own creates) |
| Command | `k6 run -s 10s:500 -s 40s:500 -s 10s:0 k6/stress.js`, with `BASE_URL` set per target |

### Traffic mix

| Share | Request | Expected result |
| :--- | :--- | :--- |
| 45% | `GET /r/:id` with an existing id | 302 with `Location` |
| 20% | `GET /api/urls/:id` with an existing id | 200 |
| 15% | `GET /r/:id` with an id that does not exist | 404 |
| 5% | `GET /api/urls/:id` with an id that does not exist | 404 |
| 15% | `POST /api/urls` with a new URL | 201 |

Unknown ids are random strings, so they miss both the cache and the database every time (there is no negative caching).

## Environment

| | |
| :--- | :--- |
| Host | Windows 11, Docker with 16 CPUs and 11.5 GiB available |
| Images | Built from the local checkout (nothing pulled from a registry for Fluxify) |
| Compose | `docker/production/docker-compose.yml` plus [`../docker-compose.yml`](../docker-compose.yml) |
| App instances | 2 per target, 1 CPU and 1 GiB each |
| Proxy | Traefik, 4 CPUs, 1 GiB, access log off |
| Postgres (app data) | `lt-urlshortener-postgres`, 1 CPU, 512 MiB |
| Valkey (app cache) | `lt-urlshortener-valkey`, 0.5 CPU, 512 MiB |

The load generator shares the machine with the stack, so absolute numbers are a lower bound for what a separate load generator would see. Each target was run once, in turn, so the other targets were idle.

## Results

### Headline

| Metric | Fluxify | Bun + Hono | Node.js + Hono |
| :--- | :--- | :--- | :--- |
| Requests | 285,315 | 573,984 | 294,934 |
| Throughput | 4,755.0 /s | 9,566.1 /s | 4,915.4 /s |
| Failed requests | 0 (0.00%) | 0 (0.00%) | 0 (0.00%) |
| Checks passed | 285,315 of 285,315 | 573,984 of 573,984 | 294,934 of 294,934 |
| Latency average | 87.5 ms | 43.4 ms | 84.7 ms |
| Latency median | 81.2 ms | 41.2 ms | 17.9 ms |
| Latency p90 | 146.8 ms | 71.3 ms | 393.1 ms |
| Latency p95 | 171.2 ms | 82.5 ms | 448.3 ms |
| Latency maximum | 586 ms | 406 ms | 752 ms |
| p95 under 500 ms (every endpoint) | Passed | Passed | Failed on create (500.5 ms) |

### Per endpoint (median / p95 / p99, ms)

| Endpoint and case | Requests (F / B / N) | Fluxify | Bun + Hono | Node.js + Hono |
| :--- | :--- | :--- | :--- | :--- |
| Redirect, existing id | 128,364 / 258,436 / 132,656 | 75 / 157 / 233 | 37 / 67 / 81 | 15 / 68 / 386 |
| Get by id, existing id | 57,412 / 114,564 / 58,975 | 72 / 151 / 230 | 37 / 67 / 82 | 15 / 70 / 384 |
| Redirect, unknown id | 42,501 / 86,403 / 44,509 | 89 / 178 / 260 | 48 / 94 / 125 | 57 / 499 / 544 |
| Get by id, unknown id | 14,191 / 28,687 / 14,581 | 89 / 179 / 259 | 48 / 93 / 129 | 54 / 499 / 544 |
| Create | 42,847 / 85,894 / 44,213 | 107 / 206 / 303 | 57 / 103 / 138 | 59 / 501 / 547 |

F = Fluxify, B = Bun + Hono, N = Node.js + Hono.

### CPU during the steady window (average, 1 CPU = 100%)

| Container | Fluxify | Bun + Hono | Node.js + Hono |
| :--- | :--- | :--- | :--- |
| App instance 1 | 99.8% | 98.7% | 100.3% |
| App instance 2 | 100.4% | 98.4% | 96.1% |
| Traefik (limit 400%) | 190.3% | 333.9% | 195.6% |
| Postgres (limit 100%) | 59.0% | 89.5% | 71.6% |
| Valkey (limit 50%) | 30.6% | 45.2% | 30.5% |
| **App CPU per request** | **0.42 ms** | **0.21 ms** | **0.40 ms** |

CPU per request is the two app instances' combined CPU divided by throughput.

## Findings

1. **No errors from any target.** Every redirect, lookup, 404 and create returned the right answer.
2. **All three were limited by the app instances' CPU.** Both instances ran at about 100% for Fluxify and Node.js and about 98% for Bun, so the comparison is CPU against CPU.
3. **Fluxify matches a hand-written Node.js server.** About 4,800 against 4,900 requests/s, and 0.42 against 0.40 ms of CPU per request, with no code written.
4. **The Bun stack is about 2× faster on the same CPU** (0.21 ms per request). Its Postgres also ran close to its limit (about 90%), so it is nearly balanced across the stack.
5. **Different latency shapes.**
   - Fluxify is steady: p95 of 171 ms, p99 near 260 ms on every case.
   - Node.js is fastest at the median (15 ms for cached reads) but has a long tail: p95 near 500 ms on every request that reaches Postgres. The cause was not investigated.
   - Bun is both fast and steady (p95 82 ms).
6. **Requests that reach Postgres are the slow ones** for all three (unknown ids and creates). Cached reads are faster everywhere.
7. **Not investigated.** The cause of Node.js's long tail, and the 0.2 ms per request that Fluxify spends beyond the Bun stack. Route matching is not it: Fluxify's route lookup costs about 124 ns per request, Hono's fastest router 55 ns, against about 420,000 ns of CPU per request.

## How the limits moved the results

Earlier runs, same traffic mix, 500 VUs.

| Run | Proxy CPU | Postgres CPU | Target | Requests/s | p95 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 3 min | 1 | 0.5 | Fluxify | 3,324 | 202 ms |
| 3 min | 4 | 0.5 | Fluxify | 4,727 | 193 ms |
| 1 min | 4 | 0.5 | Fluxify | 5,501 | 174 ms |
| 1 min | 4 | 0.5 | Bun + Hono | 7,197 | 202 ms |
| 1 min, no proxy, 1 container | none | 0.5 | Bun + Hono | 7,058 | 99 ms |
| 1 min | 4 | 1 | Bun + Hono | 9,566 | 82 ms |
| 1 min | 4 | 1 | Fluxify | 4,755 | 171 ms |

- With the proxy at 1 CPU, the proxy was the first limit (about 90% busy while workers had headroom). At 4 CPUs the workers became the limit.
- With Postgres at 0.5 CPU, the Bun stack was Postgres-bound. At 1 CPU it gained 33%. Fluxify gained nothing because its workers were already the limit.
- The Fluxify result with Postgres at 1 CPU (4,755/s) is lower than at 0.5 CPU (5,501/s). Not explained. It may be run-to-run variance; each configuration was run once.
- Stopping one Fluxify worker during a run failed 802 of 406,256 requests (0.19%) because Traefik kept routing to it. Tracked in Fluxify-rest/Fluxify#940. A single Fluxify worker at 1,000 users reached about 1,900 requests/s with a p95 of 1.35 s.
- The 3-minute Fluxify runs showed throughput easing from about 5,800 to about 4,250 requests/s during the hold as the table grew, and occasional 5 to 6 second requests. Not investigated.

## Caveats

- One run per target. Differences of a few percent are not significant; the 2× gap to Bun is.
- The load generator, the stack and every target share one machine.
- Bun SQL and `pg` differ in how they prepare and pipeline queries; this was not examined.
- Fluxify is in alpha. These numbers are the baseline for later versions.

## Reproduce

See [README.md](README.md). For each target, flush the cache, then run the 1-minute shape against that target's address:

```bash
docker exec lt-urlshortener-valkey valkey-cli flushall
BASE_URL=http://urls.localhost:8080 k6 run -s 10s:500 -s 40s:500 -s 10s:0 k6/stress.js   # Fluxify
BASE_URL=http://ts.localhost:8080   k6 run -s 10s:500 -s 40s:500 -s 10s:0 k6/stress.js   # Bun + Hono
BASE_URL=http://node.localhost:8080 k6 run -s 10s:500 -s 40s:500 -s 10s:0 k6/stress.js   # Node.js + Hono
```

The Bun and Node.js servers start with `docker compose ... up -d --build --scale lt-urlshortener-ts=2 --scale lt-urlshortener-node=2`, using the overlay in `../docker-compose.yml`.
