# Fluxify Blocks

A block is one unit of work in a workflow.
It reads its configuration and current `input`, performs one action, and passes its output to the next block.

## Execution

- A route starts at one `entrypoint` block.
- The next block receives the previous block's output as `input`.
- A `response` block ends the path and returns the current output.
- Each block's `data` follows that block's schema. Get the schema before configuring it.
- Put `blockType`, `blockName`, and `blockDescription` on the block object, never inside `data`.

## Edges and handles

An edge connects a block's output handle to another block. In the block-builder payload, add outgoing edges to the source block:

```json
"connections": [{ "blockId": "next_block", "handle": "source" }]
```

`blockId` is the target; `handle` is the source output handle. The target input handle is implicit.

| Handle | Used by | Meaning |
| --- | --- | --- |
| `source` | Most built-ins and all custom blocks | Normal continuation. |
| `success`, `failure` | `if` | True and false branches; `if` has no `source`. |
| `executor`, `source` | `forloop`, `foreachloop`, `db_transaction` | Inner work and continuation after it finishes. |
| none | `response`, `sticky_note` | Terminal; use `connections: []`. |

Rules: one outgoing edge per handle, no invented handles, no cycles, and no unreachable active blocks. Use `success`/`failure` for branching; do not fan out from `source`.

## Special blocks

- **Error Handler**: catches a block failure and follows its `source` edge to recovery logic. Use one per canvas; [read details](./error-handler.agent.md).
- **Custom Block**: reusable workflow built from existing blocks and called as `custom:<name>`. [Read details](./custom-block.agent.md).

## Block-builder contract

- New blocks go in top-level `blocks`.
- Existing-canvas edits go in `canvasChanges`: `edge_swap`, `block_change`, or `block_remove`.
- `targetType` is `route` or `custom_block`; `targetId` is the exact target ID.
- Include `connections: []` and `canvasChanges: []` when empty.
- Use `status: "impossible"` with short `reasoning` only when construction cannot be completed.

## Example

```json
{
  "status": "success",
  "targetType": "route",
  "targetId": "route_123",
  "blocks": [
    {
      "id": "entry_1",
      "blockType": "entrypoint",
      "position": { "x": 0, "y": 0 },
      "data": {},
      "connections": [{ "blockId": "check_1", "handle": "source" }]
    },
    {
      "id": "check_1",
      "blockType": "if",
      "position": { "x": 192, "y": 0 },
      "data": {
        "conditions": [
          { "lhs": "js: input.userId", "rhs": "", "operator": "is_not_empty", "chain": "and" }
        ]
      },
      "connections": [
        { "blockId": "ok_1", "handle": "success" },
        { "blockId": "bad_1", "handle": "failure" }
      ]
    },
    {
      "id": "ok_1",
      "blockType": "response",
      "position": { "x": 384, "y": -72 },
      "data": { "httpCode": "200" },
      "connections": []
    },
    {
      "id": "bad_1",
      "blockType": "response",
      "position": { "x": 384, "y": 72 },
      "data": { "httpCode": "400" },
      "connections": []
    }
  ],
  "canvasChanges": []
}
```
