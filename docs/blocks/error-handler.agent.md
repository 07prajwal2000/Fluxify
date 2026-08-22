# Error Handler

Error Handler catches a failure from any block on its canvas.
It runs one recovery path, or leaves the request failed when no recovery path exists.

## Configure

- Use exactly one `error_handler` block per canvas.
- Connect its `source` handle to the first recovery block. The handler is entered by runtime failure, not by normal route flow.
- Use a `response` block in recovery when the caller must receive a controlled error response.
- A handler runs once per failure chain. A missing recovery edge or a failure inside recovery remains failed.

```json
{
  "id": "errors_1",
  "blockType": "error_handler",
  "data": {},
  "connections": [{ "blockId": "error_response", "handle": "source" }]
}
```

The recovery block receives the error value as its input. Configure it with its normal schema.
