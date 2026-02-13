---
title: Contributing
description: How to contribute to the Fluxify project.
---

# Contributing to Fluxify

We welcome contributions from the community! Whether you're fixing a bug, adding a new block, or improving documentation, here's how to get started.

## Getting Started

1.  **Fork** the repository on GitHub.
2.  **Clone** your fork locally.
    ```bash
    git clone https://github.com/YOUR_USERNAME/Fluxify.git
    ```
3.  **Install Dependencies** using Bun.
    ```bash
    bun install
    ```

## Development Workflow

1.  Create a new **Branch** for your feature or fix.
    ```bash
    git checkout -b feature/my-new-block
    ```
2.  Make your changes.
    - If adding a block, check `packages/blocks`.
    - If adding a library feature, check `packages/lib`.
3.  **Test** your changes.
    ```bash
    bun run test
    ```
4.  **Lint** your code to ensure it meets quality standards.
    ```bash
    bun run lint
    ```

## Submitting a Pull Request

1.  **Push** your branch to GitHub.
    ```bash
    git push origin feature/my-new-block
    ```
2.  Open a **Pull Request (PR)** against the `main` branch of the original Fluxify repository.
3.  Describe your changes clearly and link any related issues.

## Guidelines

- **Code Style**: We follow standard TypeScript best practices.
- **Documentation**: If you add a new feature, please update the relevant documentation.
- **Tests**: Please include unit tests for new logic where possible.
