---
title: "Tutorial: Build a Custom Block"
description: Build a reusable "Notify Team" block that posts a message to a webhook, then use it in a route.
---

# Tutorial: Build a Custom Block

In this tutorial you will build a **Notify Team** block. It posts a message to a chat webhook (Slack, Discord, or any service that accepts a JSON message), and you'll be able to drop it into any route.

New to custom blocks? Read the [overview](./custom-blocks.md) first. It takes two minutes.

**Before you start**, you need:

- A project.
- An [App Config](../concepts/app-config.md) entry holding your webhook URL, for example one named `TEAM_WEBHOOK`. Keeping the URL there means the secret never sits inside a canvas.

## 1. Create the block

1. Open your project and go to **Custom Blocks**.
2. Press **New block**.
3. **Basics.** Fill in:
   - **Label**: `Notify Team`
   - **Identifier**: `notify_team` (filled in for you from the label)
   - **Description**: `Post a message to the team chat`
4. **Icon.** Pick any icon you like.
5. **Inputs.** Press **Add parameter** twice:

   | Identifier | Label | Type |
   | :--- | :--- | :--- |
   | `webhook_key` | Webhook | App Config selector |
   | `prefix` | Message prefix | Text input |

   Add a hint such as *"App Config key that holds the webhook URL"* so the person using the block knows what to pick.
6. **Review**, then press **Create block**.

## 2. Build what's inside

Open the new block from the **Custom Blocks** list. You'll see a canvas with an **Entrypoint** block.

1. Add a **JS Runner** block and connect the Entrypoint to it.
2. Paste this code:

   ```javascript
   const url = getConfig(params.webhook_key);
   const text = `${params.prefix} ${input.message}`;

   await httpClient.post(url, { text });

   return { sent: true, text };
   ```

   Here `params.webhook_key` and `params.prefix` are the two settings you just defined, and `input.message` is whatever the previous block hands in.
3. Save the canvas.

Whatever the last block returns is the block's output. Here that's `{ sent: true, text }`.

## 3. Use it in a route

1. Open any route's canvas.
2. Open the block picker and find **Notify Team**.
3. Drop it in after a block that produces an object with a `message` field, for example a [JS Runner](./js-runner.md) that returns `{ message: "New signup!" }`.
4. Click the block, open the **Parameters** tab, and fill it in:
   - **Webhook**: pick `TEAM_WEBHOOK`.
   - **Message prefix**: `🚀`
5. Save the route and call it.

Your team chat now gets `🚀 New signup!`.

## 4. Choose how it runs

On the block's **General** tab, set the **Execution Mode**:

- Leave it on **Synchronous** if the next block needs `{ sent, text }`, or if the route should fail when the message can't be sent.
- Pick **Asynchronous** if the caller shouldn't wait for the chat service. That's usually right for a notification.
- Pick **Queued** if the notification must not be lost, even if the server restarts. It may be sent twice, so it's best for messages where a repeat doesn't matter.

## 5. Improve it later

Say you want the message to include an emoji picker. Open **Custom Blocks**, edit **Notify Team**, and add a **Dropdown** parameter. Then read it in the JS Runner as `params.your_identifier`. Every route that uses the block picks up the change, and you don't have to touch any of them.

## Where next

- [Custom Blocks overview](./custom-blocks.md): every parameter type and execution mode.
- [JS Runner](./js-runner.md): everything you can use inside a block's code.
- [Scripting context](../scripting/context.md): `getConfig`, `httpClient`, `logger` and more.
