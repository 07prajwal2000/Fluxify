# Contributing to Fluxify

Thanks for your interest in contributing! Here's how to get started.

## Reporting Bugs

Open an issue with:
- A clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Bun / Docker version if relevant

## Suggesting Features

Open an issue tagged `enhancement`. If you'd like to work on it yourself, mention that and we'll assign it to you before you start.

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Follow the existing code style
3. Add tests where applicable
4. Open a PR against `main` with a clear description of what and why

## Local Development
See [self-hosting.md](docs/self-hosting.md) for local setup instructions.
Here's for devs:
- Recommended to use docker-compose for local development
- Use postgres for local database
- Use redis for local cache and pub/sub
- Use bun for local development
- Migrate the database schema using drizzle-kit
- Run the development server using `bun run dev` at root folder
- Access the application at `http://localhost:8000/_/admin/ui`
- API is available at `http://localhost:8000/_/admin/api` and OpenAPI UI is available at `http://localhost:8000/_/admin/api/openapi/ui`

## Rules
- Unit tests are mandatory for all new features and bug fixes
- All code must be tested
- Docs must be updated for all new features, enhancements or changes
- PRs must be submitted against `main` branch until we have a stable release
- Admin APIs must be documented with OpenAPI spec (see other admin APIs for reference)

## Areas Looking for Contributors

- MySQL / MongoDB database blocks
- Additional observability integrations
- New Block Ideas and implementation
- Integration with other services
- UI/UX improvements
- Performance optimizations
- Security enhancements
- Documentation improvements (High Priority)
- Testing improvements
- CI/CD improvements
- Release management
- Partnerships and collaborations