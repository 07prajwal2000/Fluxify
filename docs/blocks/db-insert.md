---
title: DB Insert
description: Add a new record to a database.
---

# DB Insert

The **DB Insert** block adds a new row of data to a specific table.

## Inputs

- **Connection**: The database integration.
- **Table Name**: The table to add data to.
- **Data**:
    - **Source**: Choose "raw" to build the object manually or "js" to provide a JavaScript object.
    - **Value**: The actual data fields and values to insert.
- **Use Param**: If checked, uses the output of the previous block as the data to insert.

## Logic

1.  The block constructs the data object from **Data** or the previous block.
2.  It inserts this new record into the **Table Name**.
3.  It returns the result (often the created record or its ID).
