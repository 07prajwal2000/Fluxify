---
title: Self-Hosting Fluxify
description: Self-Hosting Fluxify
---

# Self-Hosting Fluxify

Fluxify can be self-hosted on your own infrastructure. Below are the requirements and instructions for self-hosting Fluxify.

## How it works
- The below guide uses fluxify-kit, which has all the components inside a single image (caddy proxy, frontend, backend api and worker)
  - The caddy server running & exposed on port 8080 which acts as a proxy to all the other services
  - The frontend is written in next.js which is exposed on port 3000
  - The backend api is which is exposed on port 5500
  - AI Gateway which is exposed on port 8001 (still work in progress, but shipped as part of the image but not connected to anything yet)
- Redis is used for caching, bullmq and pub/sub
- PostgreSQL is used for database
- Remember to set admin user email and password in .env file to create an admin user on first run. If not set, you will not be able to login. Password can be changed later in the admin panel.

## Requirements

- Docker
- PostgreSQL
- Redis

## Environment Variables

Copy `env.example` to `.env` and fill in the following:
```env
#====================== ENVIRONMENT======================
# development | production
ENVIRONMENT=production
NODE_ENV=production


#====================== DATABASES======================
# postgres://{username}:{password}@{host}:{port}/{database}
PG_URL=
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_USER=
REDIS_PASS=


#====================== PORT CONFIG ======================
# next.js frontend port
WEB_PORT=3000
# main admin/worker server port
SERVER_PORT=5500
# local http proxy port
PROXY_PORT=8080
# AI Gateway server port
AI_GATEWAY_PORT=8001
# should be configured for all production deployments. example value should be a FQDN ({company}.fluxify.rest)
HOSTNAME=localhost
SERVER_URL=http://localhost:8080


#====================== SECURITY ======================
# Disable if you want the server to run as worker
ENABLE_ADMIN=true
# Required for cryptography (generate 32-length random base64 string by running - `openssl rand -base64 32`)
MASTER_ENCRYPTION_KEY=ZlhiQmhaS3JSeG5qTDZoWlZMbTd1WDE3aFhvYVlUVjE=
# disable if dont want to use live reload the routes on save (not recommended* until stable release)
HOT_RELOAD_ROUTES=true
# example value to get started: vWJkRKH7tUg31TxgMoknTGTBv4xYFjVM
BETTER_AUTH_SECRET=
# same as server url, e.g.: http://localhost:8080
BETTER_AUTH_URL=
# example value to get started: 2zhJ7KpBp4s6WECoCHsG3ss6SwZuldw6 - for m2m (machine to machine) communication
SYSTEM_ACCESS_KEY=
# currently not implemented (can be removed)
DISABLE_NPM=true
# required to set for admin user creation
SEED_USER_EMAIL=admin@company.com
SEED_USER_PASSWORD=admin123
SEED_USER_NAME=Admin user


#====================== PATHS======================
DOCS_INDEX_FILE_PATH=docs-index.bin


#====================== OPEN TELEMETRY======================
# Open telemetry
OTLP_LOGS_ENDPOINT=
# Header name and value e.g. Authorization: Bearer ey...
OTLP_AUTH_HEADER_NAME=
# OTLP_AUTH_HEADER_VALUE=
# Enable logging
OTLP_LOGGER_ENABLED=true
# info, warn, error - choose info to see full telemetry
OTLP_LOGGER_LEVEL=info
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