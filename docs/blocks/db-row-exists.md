---
title: DB Row Exists
description: Check whether a matching record exists and branch on the answer.
---

# DB Row Exists

The **DB Row Exists** block looks up one record and sends the flow down one of two paths: **success** when a record matches, **failure** when none does. Use it instead of a [DB Get Single](/blocks/db-get-single) followed by an [If](/blocks/if-condition).

## Inputs

The inputs are the same as [DB Get Single](/blocks/db-get-single#inputs): **Connection**, **Table Name**, **Conditions**, **Joins** and **Columns**.

## Outputs

| Path | When | Output |
| --- | --- | --- |
| **success** | A record matches the conditions | The record itself, same shape DB Get Single returns |
| **failure** | No record matches | Whatever came into the block, unchanged |

## Save output to variable

When **Save output** is on, the matching record is saved on the **success** path. On the **failure** path the variable is set to `null`, so it never holds a record from an earlier run of the block (for example, in a loop).

## Notes

- With no conditions, the block matches any record in the table. The editor shows a warning when that happens.
- A database error (bad connection, missing table) is not the **failure** path. It goes to the route's [Error Handler](/blocks/error-handler).
