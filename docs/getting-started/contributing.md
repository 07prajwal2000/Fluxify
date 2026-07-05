---
title: Contributing to Fluxify
description: How to contribute to Fluxify — code, documentation, ideas, and bug reports are all welcome.
---

# Contributing to Fluxify

Thank you for your interest in contributing! Fluxify is an open-source project in **alpha**, and community involvement is essential to making it better. Every contribution — no matter how small — genuinely matters.

> [!NOTE]
> Because Fluxify is in alpha, the architecture and APIs may change. If you're planning a large contribution, we recommend opening an issue first to discuss the approach.

---

## Ways to Contribute

You don't have to write code to contribute. Here are all the ways you can help:

| Contribution Type | How |
| :--- | :--- |
| 🐛 **Bug Reports** | Open a [GitHub Issue](https://github.com/fluxify-rest/Fluxify/issues) with reproduction steps |
| 💡 **Feature Requests** | Open a [GitHub Discussion](https://github.com/fluxify-rest/Fluxify/discussions) or an Issue tagged `enhancement` |
| 📖 **Documentation** | Improve or add pages under the `/docs` folder |
| 🧩 **New Blocks** | Add new block types in `packages/blocks` |
| 🔧 **Core Features** | Improve the execution engine, API, or frontend |
| 🧪 **Tests** | Add or improve unit and integration tests |
| 🎨 **UI/UX** | Improve the visual workflow builder or settings UI |

---

## Getting Started

### 1. Fork & Clone

Fork the repository on GitHub, then clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/Fluxify.git
cd Fluxify
```

### 2. Install Dependencies

Fluxify uses [Bun](https://bun.sh) as its runtime and package manager:

```bash
bun install
```

### 3. Set Up Your Environment

Copy the example environment file and fill in the required values:

```bash
cp env.example .env
```

See [Local Testing](./local-testing.md) for a full setup guide including starting the required databases.

---

## Development Workflow

### Create a Branch

Always work in a dedicated branch, not on `main`:

```bash
git checkout -b feature/my-new-block
# or
git checkout -b fix/some-bug
# or
git checkout -b docs/improve-getting-started
```

### Project Structure

Understanding the monorepo layout will help you find where to make changes:

```
Fluxify/
├── apps/
│   ├── web/          # Next.js frontend (visual workflow editor)
│   └── server/       # Main backend API & workflow execution server
├── packages/
│   ├── blocks/       # Block definitions (add new blocks here)
│   ├── lib/          # Shared core library (execution engine, VM, etc.)
│   └── types/        # Shared TypeScript type definitions
└── docs/             # This documentation (VitePress)
```

### Making Changes

- **Adding a new block**: See `packages/blocks` — each block is a self-contained class. Model your block on an existing one of similar type.
- **Improving the execution engine or context**: See `packages/lib`.
- **Frontend changes**: See `apps/web`.
- **Documentation changes**: Edit `.md` files under `/docs`. The docs site is a [VitePress](https://vitepress.dev) project.

### Running Tests

```bash
bun run test
```

### Linting

Ensure your code meets the project's quality standards:

```bash
bun run lint
```

---

## Submitting a Pull Request

1. **Push** your branch to your fork:
   ```bash
   git push origin feature/my-new-block
   ```
2. Open a **Pull Request** against the `main` branch of the original [Fluxify repository](https://github.com/fluxify-rest/Fluxify).
3. Fill in the PR template — describe **what** changed and **why**.
4. Link any related Issues in the PR description (e.g., `Closes #42`).
5. Wait for a maintainer review. Be responsive to feedback — PRs with no activity may be closed after a period of time.

---

## Contribution Guidelines

### Code Style

- The project uses **TypeScript** throughout.
- Follow the existing patterns and naming conventions in the file you're editing.
- Use `bun run lint` before opening a PR.

### Documentation

- If you add a new feature or block, please include or update the relevant documentation under `/docs`.
- Keep documentation accurate and concise — this project uses its docs as a primary reference for both users and AI agents.

### Tests

- Include unit tests for any new logic where feasible.
- Ensure existing tests still pass (`bun run test`) before opening a PR.

### Alpha-Stage Expectations

Since Fluxify is in alpha:
- Some APIs and internal interfaces may change between PRs.
- Not all features are fully documented — improving docs is always a great first contribution.
- Feature ideas and architectural feedback are especially valuable right now. Open a [Discussion](https://github.com/fluxify-rest/Fluxify/discussions) to share your thoughts.

---

## Reporting Bugs

When opening a bug report, please include:

1. **What you expected** to happen.
2. **What actually happened** (error messages, screenshots if relevant).
3. **Steps to reproduce** the issue.
4. **Environment details**: OS, Docker version, Bun version, browser (if a UI issue).

---

## Feature Requests & Ideas

Fluxify is in alpha and actively shaping its roadmap. If you have:

- An idea for a new block type
- A workflow capability that would unlock new use cases
- Feedback on the developer experience

...please open a [GitHub Discussion](https://github.com/fluxify-rest/Fluxify/discussions) or an Issue tagged `enhancement`. Every idea helps the project improve.

---

## Community

- 💬 [GitHub Discussions](https://github.com/fluxify-rest/Fluxify/discussions) — Q&A, ideas, and general chat
- 🐛 [GitHub Issues](https://github.com/fluxify-rest/Fluxify/issues) — Bug reports and feature tracking
- 🔀 [Pull Requests](https://github.com/fluxify-rest/Fluxify/pulls) — Active development

Thank you for helping build Fluxify! 🚀
