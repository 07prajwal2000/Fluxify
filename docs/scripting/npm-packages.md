---
title: NPM Packages
description: Using external libraries in scripts.
---

# NPM Packages

## Current Support

Currently, Fluxify **does not** support importing arbitrary NPM packages into the scripting environment (e.g., using `require('lodash')` or `import ... from ...`).

The scripting environment is designed to be lightweight and secure, provided with a curated set of internal helpers (`context`) rather than full Node.js module resolution.

## Recommended Workarounds

1.  **Native Logic**: For most logic (filtering, mapping, math), standard JavaScript functions are sufficient without external libraries.
2.  **Built-in Blocks**: Use specialized blocks (like **Array Operations**) which are optimized for common tasks.
3.  **Future Extensions**: We are evaluating the inclusion of utility libraries (like `lodash` or `dayjs`) directly into the global context in future updates.

## Core Libraries (Development)

For developers contributing to the Fluxify platform itself (not scripting workflows), please refer to the [Development > NPM Packages](../development/npm-packages.md) section for a list of internal dependencies.
