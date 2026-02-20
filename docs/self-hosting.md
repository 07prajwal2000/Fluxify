---
title: Self-Hosting Fluxify
description: Self-Hosting Fluxify
---

# Self-Hosting Fluxify

Fluxify can be self-hosted on your own infrastructure. Below are the requirements and instructions for self-hosting Fluxify.

## How it works
- The below guide uses fluxify-kit, which has all the components inside a single image (proxy, frontend, backend api and worker)
  - The proxy is written in js which is exposed on port 8080
  - The frontend is written in next.js which is exposed on port 3000
  - The backend api is written in go which is exposed on port 5500
- Redis is used for caching and pub/sub
- PostgreSQL/pglite is used for database
  - pglite is an embedded postgres emulator (used for local development/testing), for persistent data of pglite use `PGLITE_PATH` and mount a volume to it. If PGLITE_PATH is not set, it will use in-memory database (data will be lost on restart).
- Remember to set admin user email and password in .env file to create an admin user on first run. If not set, you will not be able to login. Password can be changed later using the admin panel.

## Requirements

- Docker
- PostgreSQL (or embedded pglite will be used, see .env for more info)
- Redis (as of now it is required, but we are planning to add inmemory KV and pub/sub)

## Environment Variables

Copy `env.example` to `.env` and fill in the following:
```env
# development | production
ENVIRONMENT=production
# postgres://{username}:{password}@{host}:{port}/{database}
PG_URL=
# Disable if you want the server to run as worker
ENABLE_ADMIN=true
# Required for cryptography
MASTER_ENCRYPTION_KEY=ZlhiQmhaS3JSeG5qTDZoWlZMbTd1WDE3aFhvYVlUVjE=
REDIS_HOST=host.docker.internal
REDIS_PORT=6379
REDIS_USER=
REDIS_PASS=
# disable if dont want to use live reload the routes on save (not recommended*)
HOT_RELOAD_ROUTES=true
# postgres | pglite - https://pglite.dev/ (local in-memory postgres emulator for testing)
DB_VARIANT=postgres
PGLITE_PATH=./pglite.data # default: memory://
# example value to get started: vWJkRKH7tUg31TxgMoknTGTBv4xYFjVM
BETTER_AUTH_SECRET=
# example value to get started: 2zhJ7KpBp4s6WECoCHsG3ss6SwZuldw6 - for m2m (machine to machine) communication
SYSTEM_ACCESS_KEY=
SERVER_URL=http://localhost:8080
# currently not implemented (can be removed)
DISABLE_NPM=true
# next.js frontend port
WEB_PORT=3000
# main admin/worker server port
SERVER_PORT=5500
# local http proxy port
PROXY_PORT=8080
# should be configured for all production deployments. example value should be a FQDN ({company}.fluxify.rest)
# HOSTNAME=localhost
# required to set for admin user creation
SEED_USER_EMAIL=admin@company.com
SEED_USER_PASSWORD=admin123
SEED_USER_NAME= # optional default: Admin User
```

## Docker Compose (Recommended)

```yaml
# coming soon
```

## Manual Docker Run

```bash
docker pull ghcr.io/fluxify-rest/fluxify-kit:latest

docker run -d --rm --name fluxify \
  --env-file=.env \
  -p 8080:8080 \
  ghcr.io/fluxify-rest/fluxify-kit:latest
```

## Upgrading

```bash
docker pull ghcr.io/fluxify-rest/fluxify-kit:latest
# restart your container
```

## Troubleshooting
Coming soon. Help us document it.