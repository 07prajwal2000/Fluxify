# Fluxify Block Catalog

Each block performs one action in a workflow. Select the block whose two-line description matches the required behavior, then read its detailed page for settings and limits.

## Logic and flow control

### Entrypoint
- Starts a workflow for a configured HTTP method and path.
- Makes the incoming request available to the first workflow step.

### If Condition
- Evaluates a condition and selects a true or false connection.
- Use it to branch execution based on values in `input` or runtime state.

### For Loop
- Repeats a connected path for items in a list or a configured range.
- Use it for repeated work that must run once per item or iteration.

### Error Handler
- Receives execution failures from a connected workflow path.
- Use one per canvas to convert expected failures into a controlled result or response. [Details](./error-handler.agent.md).

### Response
- Sends the route's HTTP response to the caller.
- Use it to define the final status, headers, cookies, and response data.

## Data manipulation

### Set Variable
- Stores a request-local value under a named variable.
- Use it when later blocks need the value after the direct data path changes.

### Get Variable
- Reads a request-local value by name.
- Use it to pass stored state back into the active workflow path.

### Array Operations
- Performs common operations on arrays, such as adding, removing, filtering, or changing items.
- Use it when array data can be handled without a custom script.

### Transformer
- Maps selected fields or runs JavaScript to reshape the current data.
- Its returned value becomes `input` for the next block.

### JS Runner
- Runs custom JavaScript with the current workflow context.
- Its returned value becomes `input` for the next block.

## HTTP and networking

### HTTP Request
- Sends an outgoing HTTP request to an external service.
- Use it for standard calls that do not need custom multi-request logic.

### Get HTTP Param
- Reads a named parameter captured from the route path.
- Use it when a route contains a dynamic path segment.

### Get HTTP Header
- Reads a header from the incoming request.
- Use it for authorization, content negotiation, tracing, or client metadata.

### Set HTTP Header
- Adds a header to the outgoing response.
- Use it before the Response block when the caller needs response metadata.

### Get Request Cookie
- Reads a named cookie from the incoming request.
- Use it when client state is sent through cookies.

### Set HTTP Cookie
- Adds a cookie to the outgoing response.
- Use it to create, update, or clear client-side cookie state.

### Get HTTP Request Body
- Reads the body sent with the incoming request.
- Use it when the workflow needs submitted JSON or other parsed body data.

## Database

### DB Get All
- Reads multiple records from a configured database table.
- Use it for list endpoints and collection queries.

### DB Get Single
- Reads one record from a configured database table.
- Use it for detail endpoints that identify a single record.

### DB Insert
- Creates one record in a configured database table.
- Use it when a route accepts data for a new record.

### DB Insert Bulk
- Creates multiple records in one database operation.
- Use it when the route receives a list of records to insert.

### DB Update
- Changes matching records in a configured database table.
- Use it when a route modifies existing data.

### DB Delete
- Removes matching records from a configured database table.
- Use it when a route deletes existing data.

### DB Transaction
- Groups database operations into one atomic unit.
- Use it when all grouped changes must succeed or be rolled back together.

### DB Native
- Runs a raw SQL query against the configured database.
- Use it for SQL that the standard database blocks cannot express; `dbQuery` is available only here.

## Logging and observability

### Console Log
- Writes structured information to the service logs.
- Use it for local debugging and basic route diagnostics.

### Cloud Logs
- Sends structured log data to a configured external logging destination.
- Use it when route logs must be collected by services such as Loki or OpenTelemetry-compatible systems.

## Utility

### Sticky Note
- Adds a non-executable note to the workflow.
- Use it to record context for people working on the workflow; it does not affect requests.

## Reusable abstractions

### Custom Block
- Packages a reusable workflow made from existing blocks into one callable block.
- Exposes caller parameters such as text, checkbox, dropdown, array, integration, and App Config values through `params.<name>`. [Details](./custom-block.agent.md).
