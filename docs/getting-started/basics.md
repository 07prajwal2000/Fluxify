---
title: Basics
description: Understanding the core concepts of Fluxify.
---

# Fluxify Basics

Fluxify is a no-code/low-code platform designed to help you build complex backend logic visually. Here are the core concepts you need to know.

## 1. Workflows
A **Workflow** is a collection of logical steps that perform a specific task (e.g., "On User Signup", "Daily Report", "API Endpoint"). It starts with a trigger (like an **Entrypoint**) and flows through various actions.

## 2. Blocks
**Blocks** are the individual units of logic. Each block performs a specific action:
- **Triggers**: Start a workflow (e.g., `Entrypoint`).
- **Actions**: Do something (e.g., `DB Insert`, `HTTP Request`).
- **Logic**: Control flow (e.g., `If Condition`, `For Loop`).

You can find a full list of available blocks in the [Blocks Reference](../blocks/index.md) section.

## 3. Edges (Connections)
**Edges** are the lines connecting blocks. They represent the flow of execution.
- If Block A is connected to Block B, Block B will run after Block A finishes successfully.
- Some blocks (like `If Condition`) have multiple outputs (e.g., `True` and `False`), allowing the flow to branch.

## 4. Context & Variables
Data in Fluxify is stored in the **Context**.
- **Variables**: You can save data globally using the `Set Variable` block and retrieve it later with `Get Variable`.
- **Block Output**: The result of one block is often passed to the next, accessible as `input` or via parameters.

## 5. Integrations
**Integrations** allow Fluxify to talk to the outside world.
- Connect to **Databases** (Postgres).
- Call **AI Models** (OpenAI, Anthropic).
- Send **Logs** to monitoring services.

Configure these in the Integrations section of your dashboard.
