# Custom Block

Custom Block packages a workflow made from existing blocks into a reusable block.
Callers provide declared parameters; the custom canvas can return output to the caller.

## Define

- Create metadata with a lowercase `snake_case` `name`, `label`, description, and complete `inputParams`.
- The runtime block type is `custom:<name>`. Keep the name stable after callers use it.
- Parameter names must match exactly and use lowercase `snake_case`.
- Supported parameter kinds: `text_input`, `checkbox`, `dropdown`, `array_editor`, `integration_selector`, `app_config_selector`.
- `params.<name>` is caller configuration. `input` is output from the previous block. Keep them separate.
- App Config parameters provide a key; read its value with `getConfig(params.<name>)`. Never put secrets or credentials in block data.

```json
{
  "action": "create",
  "data": {
    "name": "send_notification",
    "label": "Send Notification",
    "inputParams": [
      { "type": "text_input", "name": "message", "label": "Message" },
      { "type": "integration_selector", "name": "notification_integration", "label": "Integration", "group": "notifications", "tags": [] }
    ]
  }
}
```

## Build and call

- Build the custom canvas with the same edge and handle rules as a route. Do not call itself directly or indirectly.
- A `response` block returns an HTTP result to the caller. Without `response`, the last block output flows to the caller's next block.
- `invoke: "sync"` waits for output; `"async"` runs on the current worker without output; `"queued"` sends durable background work without output.

```json
{
  "id": "notify_1",
  "blockType": "custom:send_notification",
  "data": { "message": "js:return input.text", "notification_integration": "int_123", "invoke": "sync" },
  "connections": [{ "blockId": "next_1", "handle": "source" }]
}
```
