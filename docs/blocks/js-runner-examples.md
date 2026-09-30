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

## Wait for several calls at once

Every script is async, so `await` works anywhere, and `Promise.all` runs calls side by side.

```javascript
const [user, orders] = await Promise.all([
  httpClient.get("https://api.example.com/users/7"),
  httpClient.get("https://api.example.com/users/7/orders"),
]);

return { user: user.data, orderCount: orders.data.length };
```

## Validate data with an npm package

Libraries like Zod are not built in. Install `zod` under **Project Settings > npm Packages**, then import it:

```javascript
import { z } from "zod";

const bodySchema = z.object({
  users: z.array(z.object({
    id: z.number(),
    name: z.string(),
    active: z.boolean()
  }))
});

const parsed = bodySchema.safeParse(getRequestBody());
if (!parsed.success) {
  return { error: "Invalid input", details: parsed.error.flatten() };
}

const activeNames = parsed.data.users
  .filter((u) => u.active)
  .map((u) => u.name);

return { activeUsers: activeNames };
```

## Work with dates

Install `dayjs` under **Project Settings > npm Packages** first:

```javascript
import dayjs from "dayjs";

return { expiresAt: dayjs().add(7, "day").toISOString() };
```

## Handle a workflow's events

In a workflow, `trigger.data` is the list of events the trigger collected. It is always a list, even for one event.

```javascript
const orders = trigger.data.map((event) => event.data);
logger.logInfo("Received orders", { count: trigger.meta.size, source: trigger.source });

return orders.filter((order) => order.total > 0);
```

## Share a value with later blocks

```javascript
// A name without const, let or var becomes a request variable
processedAt = new Date().toISOString();
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
