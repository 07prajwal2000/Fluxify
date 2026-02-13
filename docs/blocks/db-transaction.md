---
title: DB Transaction
description: Wrap multiple database operations in a transaction.
---

# DB Transaction

The **DB Transaction** block ensures that a set of database operations either all succeed or all fail together. This is critical for maintaining data integrity (e.g., deducting money from one account and adding it to another).

## Inputs

- **Connection**: The database integration.
- **Executor**: The sequence of blocks to run inside the transaction.

## Logic

1.  The block starts a database transaction.
2.  It runs the blocks defined in the **Executor**.
3.  If all blocks succeed, it "commits" the transaction (saves changes).
4.  If any block fails, it "rolls back" the transaction (undoes all changes).
