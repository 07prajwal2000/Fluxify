---
title: JS Runner examples
description: Ready-to-copy examples for the JS Runner block.
---

# JS Runner examples

Copy-and-adapt examples for the [JS Runner](./js-runner.md) block. Each one shows the code and what the next block receives.

## Read the request

```javascript
const userId = getRouteParam("id");       // from route /users/:id
const page = getQueryParam("page") || "1";
const authHeader = getHeader("Authorization");

logger.logInfo("Fetching user", { userId, page });
return { userId, page };
```

The next block receives `{ "userId": "7", "page": "1" }`.

## Call an external API

```javascript
const apiKey = getConfig("WEATHER_API_KEY");
const city = getQueryParam("city") || "London";

const response = await httpClient.get(
  `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${city}`
);
return response.data.current;
```

## Verify a JWT

```javascript
const token = getHeader("Authorization").replace("Bearer ", "");
const { success, payload } = jwt.verify(token, getConfig("JWT_SECRET"));

if (!success) {
  return { error: "Invalid or expired token" };
}

// Store the verified user for later blocks
verifiedUserId = payload.sub;
return { userId: payload.sub, role: payload.role };
```

## Validate data and pick values

```javascript
const bodySchema = zod.object({
  users: zod.array(zod.object({
    id: zod.number(),
    name: zod.string(),
    active: zod.boolean()
  }))
});

const parsed = bodySchema.safeParse(getRequestBody());
if (!parsed.success) {
  return { error: "Invalid input", details: parsed.error.flatten() };
}

const activeNames = _.chain(parsed.data.users)
  .filter(u => u.active)
  .pluck("name")
  .value();

return { activeUsers: activeNames };
```

## Share a value with later blocks

```javascript
// A name without const, let or var becomes a request variable
processedAt = dayjs().utc().toISOString();
requestingUser = getRouteParam("userId");

return { status: "processing" };
// Later blocks can read: processedAt, requestingUser
```

## Handle an error yourself

```javascript
try {
  const result = await httpClient.get("https://api.example.com/data");
  return result.data;
} catch (err) {
  logger.logError("External API call failed", err.message);
  return { error: "Service temporarily unavailable" };
}
```

Without the `try` and `catch`, the error would fail the block and run the [Error Handler](./error-handler.md).
