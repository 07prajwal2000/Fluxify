---
title: Edges
description: Connecting blocks to form logic.
---

# Edges

**Edges** are the connectors between blocks. While they visually appear as lines on the canvas, they represent the flow of control in the execution engine.

## Types of Connections

1.  **Standard Flow**: The default connection (Output -> Input). The next block runs immediately after the previous one succeeds.
2.  **Conditional Flow**: Used in blocks like **If Condition**.
    - **True Path**: Executed if the condition is met.
    - **False Path**: Executed if the condition fails.
3.  **Error Flow**: Used by the **Error Handler**. If a block fails, control is passed along this edge to manage the error.

## Concept

Edges define the *Directed Acyclic Graph (DAG)* that represents your workflow. The execution engine traverses this graph to run your logic.
