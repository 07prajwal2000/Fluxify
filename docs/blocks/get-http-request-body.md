---
title: Get HTTP Request Body
description: Access the data sent in the request body.
---

# Get HTTP Request Body

The **Get HTTP Request Body** block returns the body of the incoming request,
already turned into something you can work with. What you get depends on the
content type the caller used.

## Inputs

None. The block always reads the body of the request that started the workflow.

## What the block returns

| Caller sends | You get |
| :--- | :--- |
| `application/json` | The parsed JSON — an object, an array, a number, whatever was sent |
| `application/x-www-form-urlencoded` | An object of field names and text values |
| `multipart/form-data` | An object where text fields are strings and uploaded files are file objects |
| `application/octet-stream` | The raw binary body as a single file-like value |
| `text/plain` | The text, exactly as sent |
| A `GET` or `DELETE` request | `null` — those methods carry no body |

::: info Which types your route allows
A route accepts **JSON only** unless you say otherwise. Pick the formats you
want under **Accepted content types** when you create the route. A request that
arrives in any other format is rejected with `415 Unsupported Media Type`
before your workflow runs.
:::

### Repeated field names

If a form sends the same field name twice (`tag=a&tag=b`, or two files under
`docs`), you get a list for that field instead of a single value. A name that
appears once stays a single value.

```json
{ "title": "Holiday photos", "tags": ["beach", "summer"] }
```

### Working with uploaded files

A file field is a file object, not text. In a **JS Runner** block you can read
its name, size, type, and contents:

```javascript
const body = getRequestBody();
const upload = body.avatar;

console.log(upload.name);  // "profile.png"
console.log(upload.size);  // 20481  (bytes)
console.log(upload.type);  // "image/png"

const text = await upload.text();          // for text files
const bytes = await upload.arrayBuffer();  // for anything else
```

::: warning Files are not JSON
A file object cannot be returned directly from a **Response** block — JSON has
no way to represent one. Read what you need from it (its text, its size, a
value you extract from it) and return that instead.
:::

## Size limit

Every request body is capped, 8 MB by default. A larger request is rejected
with `413` and your workflow never starts. See
[request body size](../deployments/production.md#request-body-size) for how to
change the cap and why large uploads belong somewhere else.

## Logic

1. The caller's content type is checked against the formats the route accepts.
2. The body is read and turned into the value shown in the table above.
3. That value becomes the block's output, ready for the blocks after it.
