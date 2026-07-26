<div align="center">

  <img src="img/logo_title.png" width="400" alt="Fluxify Logo">

  <p align="center">
    <b>The Production-Grade, Low-Code Agentic Backend Platform</b><br />
    <i>Build, orchestrate, and scale AI agents & APIs for real production workloads.</i>
  </p>

  <p align="center">
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License">
    </a>
    <a href="https://github.com/07prajwal2000/Fluxify">
      <img src="https://img.shields.io/badge/Status-In%20Development%20(Alpha)-orange.svg" alt="Status: In Development">
    </a>
    <a href="https://github.com/07prajwal2000/Fluxify">
      <img src="https://img.shields.io/badge/Docker-Scale--Out%20Ready-blue?logo=docker" alt="Docker">
    </a>
    <a href="https://docs.fluxify.rest">
      <img src="https://img.shields.io/badge/Docs-docs.fluxify.rest-emerald" alt="Documentation">
    </a>
  </p>

  <br />

  <a href="https://github.com/07prajwal2000/Fluxify">
    <img src="img/banner.png" width="100%" alt="Fluxify Platform Preview" style="border-radius: 10px;">
  </a>

  <br /><br />

  <p align="center">
    <b>Empower your team to visually build AI-agentic workflows and high-throughput backend microservices — engineered to scale seamlessly from 1 to 50+ worker nodes for real-world production traffic.</b>
  </p>

  <p align="center">
    <a href="https://docs.fluxify.rest"><b>📖 Documentation</b></a> •
    <a href="#-quick-start-docker-kit"><b>🚀 Quick Start</b></a> •
    <a href="#-core-capabilities"><b>✨ Core Capabilities</b></a> •
    <a href="CONTRIBUTING.md"><b>🤝 Contributing</b></a> •
    <a href="LICENSE"><b>📄 License</b></a>
  </p>

</div>

---

## ⚡ Why Fluxify?

- 🤖 **Low-Code Agentic Backend Engine**: Seamlessly blend AI agents, LLM tool-calling, custom logic blocks, and database operations into visual, event-driven workflows.
- 💥 **Built for Real Workloads, Not Just Internal Tools**: Designed for public-facing, low-latency APIs and high-concurrency production applications — beyond simple internal prototypes.
- 📈 **Elastic Horizontal Scaling (10 to 50+ Worker Nodes)**: Decoupled architecture separates the control plane from stateless request execution workers, allowing you to scale up to 50+ worker replicas with zero downtime.
- 🔧 **Fully Extensible & Open**: Add custom blocks, integrate external databases/services, and manage environment secrets effortlessly with **App Config**.
- 🛡️ **Enterprise Security & Governance**: SSO & SAML support (beta), granular team role-based access control, project isolation, and complete OpenAPI (Swagger) spec generation.

---

## ✨ Core Capabilities

- **Agentic AI & Logic Builder**: Design autonomous AI pipelines, tool calling, conditionals, loops, and data transformers visually.
- **High-Availability Scale-Out**: Separate Admin control plane and stateless Worker nodes engineered to process millions of requests across 10–50+ instances.
- **Instant Deployments**: Zero-downtime automatic deployments and live route hot reloading capabilities.
- **Enterprise-Grade Security**: Built-in SSO & SAML authentication (beta), Email/Password login, and Audit Logs (*coming soon*).
- **Project Isolation & User Management**: Secure multi-tenant project boundaries, team access controls, and organization management.
- **Native OpenAPI (Swagger)**: Automatic interactive OpenAPI spec generation for platform Admin APIs and all user-built endpoints.
- **Full Testing Suite**: Interactive visual test runner playground with complete request/response mocking for integration testing.

---

## 🚀 Quick Start (Docker Kit)

Run the full Fluxify stack in a single container using the quick-run Kit image (*nightly build — official release coming soon*):

```bash
# 1. Pull the nightly Kit image
docker pull ghcr.io/fluxify-rest/fluxify-kit:nightly

# 2. Copy default environment configuration
cp env.example .env

# 3. Start the container stack
docker run -d --env-file .env -p 8080:8080 ghcr.io/fluxify-rest/fluxify-kit:nightly
```

Access the platform at:
- **Admin UI**: [http://localhost:8080/_/admin/ui](http://localhost:8080/_/admin/ui)
- **Admin API**: [http://localhost:8080/_/admin/api](http://localhost:8080/_/admin/api)

> 📖 For production deployments with 10–50+ worker nodes, see the [Scale-Out Production Deployment Guide](https://docs.fluxify.rest/deployments/production.html).

---

## 💻 Local Monorepo Development

For contributors and developers customizing the core engine:

```bash
# 1. Clone the repository and install dependencies
git clone https://github.com/07prajwal2000/Fluxify.git
cd Fluxify
bun install

# 2. Start backing services (PostgreSQL, Redis, NATS)
docker compose up -d

# 3. Copy environment configuration
cp env.example .env

# 4. Push initial database schema
bun run db:migrate

# 5. Launch full development stack
bun run dev
```

The local services will be available at:
- **Web Dashboard**: `http://localhost:3000`
- **Backend Server**: `http://localhost:5500`
- **AI Gateway**: `http://localhost:8001`

---

## 🤝 Contributing

We welcome contributions from the community! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) guide for details on setting up your environment, submitting pull requests, and coding standards.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.