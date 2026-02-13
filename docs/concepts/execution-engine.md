---
title: Execution Engine
description: The core system that runs your workflows.
---

# Execution Engine

The **Execution Engine** is the heart of Fluxify. It takes the visual workflow you designed (which is stored as a JSON definition) and executes it step-by-step.

## Process

1.  **Trigger**: An event (like an HTTP Request) wakes up the engine.
2.  **Initialization**: The engine creates a new **Context** for this specific run.
3.  **Traversal**: It starts at the **Entrypoint** and follows the **Edges**.
4.  **Block Execution**: For each node, it instantiates the corresponding Block class and calls `executeAsync`.
5.  **State Management**: It tracks the output of each block and updates the global context.
6.  **Termination**: The run ends when it reaches a **Response** block or runs out of connected blocks.

## Performance

The engine is designed to be non-blocking and uses Node.js's event loop to handle many concurrent workflows efficiently.
