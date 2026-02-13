---
title: Transformer
description: Transform data structures.
---

# Transformer

The **Transformer** block allows you to reshape data. You can map fields from one object to another or use JavaScript to completely restructure the data.

## Inputs

- **Field Map**: A list of pairs mapping input fields to output fields.
- **Use JS**: specific JavaScript code to perform the transformation.
- **JS**: The JavaScript code (if Use JS is enabled).

## Logic

1.  If **Use JS** is enabled, the block runs your script with the input data available as `input`.
2.  If **Use JS** is disabled, it creates a new object. It looks at the **Field Map**, takes values from the input based on the keys, and assigns them to the new keys in the output object.
3.  The new, transformed object is the output.
