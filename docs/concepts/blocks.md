---
title: Blocks
description: High-level concept of Blocks in Fluxify.
---

# Blocks Concept

In the context of the Fluxify architecture, a **Block** is an abstraction of a unit of work.

## Structure

Under the hood (in the codebase), a Block is a TypeScript class extending `BaseBlock`. It implements an `executeAsync` method that receives the context and inputs.

## Extensibility

Because Blocks are modular classes, it is easy for developers to add new types of blocks by creating a new class in the `packages/blocks` directory and registering it. This makes Fluxify highly extensible.
