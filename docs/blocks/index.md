---
title: Blocks Overview
description: Building blocks of the Fluxify platform.
---

# Blocks Overview

Blocks are the fundamental building "lego pieces" of Fluxify. By combining them, you construct the logic for your APIs and background tasks.

## Categories

Blocks are generally organized into these categories:

### 1. Functional Blocks
These perform a specific action, like fetching data from a database or sending an email. They often have inputs (Connection ID, SQL Query) and produce an output.

### 2. Logic Blocks
These control *how* the workflow runs.
- **If/Else**: Choose a path.
- **Loop**: Repeat actions.
- **Wait**: Pause execution.

### 3. Trigger Blocks
These sit at the start of a workflow (like **Entrypoint**) and define when it should run (e.g., on an HTTP GET request).

## Usage

To use a block, simply drag it from the sidebar onto the canvas. Click on it to configure its properties in the side panel. Connect it to other blocks to define the execution order.
