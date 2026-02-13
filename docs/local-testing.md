---
title: Local Testing Guide
description: How to run Fluxify locally for testing and development.
---

# Local Testing Guide

Follow these steps to set up Fluxify on your local machine.

## Prerequisites
- **Git**: To clone the repository.
- **Docker**: To run dependencies.
- **Bun**: The JavaScript runtime used by Fluxify.

## Steps

### 1. Clone the Repository
```bash
git clone https://github.com/Fluxify-rest/Fluxify.git
cd Fluxify
```

### 2. Setting up the Environment
Rename the example environment file to `.env`:
```bash
cp .env.example .env
# If .env.example does not exist, use .env.prod or check apps/server
```

### 3. Run Dependencies
Start the necessary databases and services using Docker Compose:
```bash
docker-compose up -d
```

### 4. Start the Application
Open two terminal windows to run the web interface and the server backend:

**Terminal 1 (Web)**:
```bash
bun run dev:web
```

**Terminal 2 (Server)**:
```bash
bun run dev:server
```

You should now be able to access the application in your browser.
