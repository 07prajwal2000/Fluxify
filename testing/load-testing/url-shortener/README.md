# URL Shortener Load Test

k6 benchmark of a URL shortener built in Fluxify. Part of issue #934.

## What it tests

| Endpoint | Purpose |
| :--- | :--- |
| Get URL by id | Returns which URL a short id redirects to |
| Create short URL | Creates a new short URL |
| Redirect | Public endpoint that performs the redirect |

## Layout

| Path | Contents |
| :--- | :--- |
| `routes/` | Exported route JSON files; import them into a project |
| `k6/` | k6 scripts |
| `config/` | Test configuration (VUs, stages, thresholds, base URL) |
| `report.md` | Results of a real run |

## Environment

Stack: `docker/production/docker-compose.yml` plus `../docker-compose.yml`,
built from the local checkout. Every container is capped at 1 CPU and 1 GiB.

```bash
docker compose -f docker/production/docker-compose.yml -f testing/load-testing/docker-compose.yml up -d --build
```

Traffic enters at `http://localhost:8080`.

### Data stores

Started by the overlay on `fluxify_net`. Use these hostnames inside Fluxify
integrations (workers reach them by container name). Capped at 0.5 CPU / 512 MiB each.

| Store | Connection string |
| :--- | :--- |
| Postgres | `postgres://postgres:postgres@lt-urlshortener-postgres:5432/urlshortener` |
| Valkey | `redis://lt-urlshortener-valkey:6379` |

Valkey has no password. Neither store publishes a host port.

## Hand-coded servers

Two twins of the three Fluxify routes (same contract, same cache key and TTL) for a like-for-like comparison. Both read `PG_URL`, `REDIS_URL`, `PORT` (default 3000) and `BASE_URL`, and share `id.ts`.

| Folder | Stack | Compose service / address |
| :--- | :--- | :--- |
| `server/` | Bun, Hono, Bun SQL, ioredis | `lt-urlshortener-ts`, `ts.localhost:8080` |
| `server-node/` | Node.js 24, Hono, `pg`, ioredis | `lt-urlshortener-node`, `node.localhost:8080` |

```bash
docker compose -f docker/production/docker-compose.yml -f testing/load-testing/docker-compose.yml up -d --build --no-deps --scale lt-urlshortener-ts=2 --scale lt-urlshortener-node=2 lt-urlshortener-ts lt-urlshortener-node
```


## Run

Needs [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) and the stack above running with the url-shortener project imported from `routes/`.

| Script | What it does |
| :--- | :--- |
| `k6/load.js` | 1 minute, 50 users, 80% redirect / 15% get / 5% create |
| `k6/behaviour.js` | 1 minute, 50 users, user types: 30% create, 25% get, 45% redirect (5% of those unknown ids) |
| `k6/variations.js` | 1 minute, 50 users, ten weighted behaviours incl. bad input and malformed ids |
| `k6/stress.js` | 500 users, real ids from `config/ids.txt` plus unknown ids. The one reported in `report.md` (3 minutes by default; the report overrides it to 1 minute with `-s`) |

```bash
docker exec lt-urlshortener-valkey valkey-cli flushall   # cold cache
BASE_URL=http://urls.localhost:8080 k6 run k6/stress.js
```

`config/ids.txt` holds 20,000 ids sampled from the table. Regenerate it with:

```bash
docker exec lt-urlshortener-postgres psql -U postgres -d urlshortener -Atc "select id from short_urls order by random() limit 20000" > config/ids.txt
```

Results: [report.md](report.md).
