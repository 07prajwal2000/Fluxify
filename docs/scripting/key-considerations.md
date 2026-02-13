---
title: Key Considerations
description: Important limits and best practices for scripting.
---

# Key Considerations

When writing scripts in Fluxify, keep the following constraints and best practices in mind.

## 1. Execution Timeout
To prevent infinite loops or hung processes affecting the server, all scripts have a strict **4-second (4000ms) timeout**. If your script takes longer than this to execute, it will be terminated, and the block will throw an error.

*Best Practice*: Avoid complex iterations over large datasets inside a single script.

## 2. Statelessness
Scripts are ephemeral. Any local variables defined inside a script block are lost once the block finishes execution.
- To persist data between blocks, use the **Set Variable** block or modify the `vars` object directly.
- To persist data between different workflow runs (requests), use a Database.

## 3. Sandboxed Environment
Your code runs in a restricted context:
- **No File System Access**: You cannot use `fs` to read/write files on the server.
- **No Process Access**: `process.env` and process control are unavailable.
- **Limited Globals**: Standard browser/Node globals like `window`, `document`, or `fetch` may not be available unless explicitly provided in the context.

## 4. Error Handling
Always assume input data might be missing or malformed.
```javascript
// Good
if (input && input.data) {
    return input.data.value;
}
return null;

// Risky
return input.data.value; // Might throw "Cannot read property of undefined"
```
