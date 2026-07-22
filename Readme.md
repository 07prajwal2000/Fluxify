<div align="center">

<img src="img/logo_title.png" height="80px" alt="Fluxify">

**The No/Low-Code Backend API Builder**

<img src="img/banner.png" height="300px" alt="Fluxify Banner">

Build and deploy complex backend APIs through a drag-and-drop interface — no code required, fully extensible when you need it.

[Quick Start](docs/self-hosting.md) · [Features](#-features) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

</div>

---

## 🚀 Quick Start

```bash
docker pull ghcr.io/fluxify-rest/fluxify-kit:latest
```

1. Copy [env.example](env.example) to `.env` and fill in the values
2. Run the container:
   ```bash
   docker run -d --env-file .env -p 8080:8080 ghcr.io/fluxify-rest/fluxify-kit:latest
   ```
3. Open [http://localhost:8080](http://localhost:8080)

Full setup guide → [docs/getting-started/self-hosting.md](docs/getting-started/self-hosting.md)

---

## 💻 Local Development

1. Install dependencies:
   ```bash
   bun install
   ```
2. Set up environment variables:
   Copy `env.example` to `.env` in the root and in the respective apps (`apps/server/.env`, `apps/web/.env`, `apps/ai-gateway/.env`) and update the database and redis connection strings.
3. Push the database schema:
   ```bash
   cd apps/server
   bun x drizzle-kit push
   cd ../..
   ```
4. Start the development server:
   ```bash
   bun run dev
   ```

---

## ✨ Features

| Status | Feature |
|--------|---------|
| ✅ | Visual drag-and-drop API editor |
| ✅ | REST API generation |
| ✅ | PostgreSQL, MySQL, MongoDB integration |
| ✅ | Multi-user authentication & secrets management |
| ✅ | Observability (OpenTelemetry Logs, Loki) |
| ✅ | Testing System (Playground + Test Suites) |
| 🚧 | AI-powered API generation |
| 🚧 | JWT blocks, Cron scheduling, Audit logs |
| 🔜 | Backups, Marketplace |

---

## 🤝 Contributing

Bug reports, feature requests, and PRs are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting.

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.