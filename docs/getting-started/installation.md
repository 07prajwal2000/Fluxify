---
title: Installation
description: Setting up Fluxify on your local machine.
---

# Installation

This guide covers how to set up Fluxify for local development and testing.

## Prerequisites

Before you begin, ensure you have the following installed:
- **Git**: Version control system.
- **Docker**: To run the database and other services.
- **Bun**: A fast all-in-one JavaScript runtime (version 1.0+ recommended).

## Step-by-Step Guide

### 1. Clone the Repository
Get the latest version of the code from GitHub.
```bash
git clone https://github.com/Fluxify-rest/Fluxify.git
cd Fluxify
```

### 2. Environment Configuration
Fluxify uses environment variables to configure the application. Start by copying the example file.

```bash
cp .env.example .env
# If .env.example is missing, check apps/server/.env.example or use .env.prod as a reference.
```

### 3. Start Infrastructure
Use Docker Compose to spin up the necessary databases (PostgreSQL, etc.) and services.

```bash
docker-compose up -d
```

### 4. Run the Application
Fluxify consists of a backend server and a frontend web application. You'll need to run both.

Open two terminal windows:

**Terminal 1 (Frontend)**:
```bash
bun run dev:web
```

**Terminal 2 (Backend)**:
```bash
bun run dev:server
```

Once running, navigate to `http://localhost:3000` (or the port shown in your terminal) to access the application.
