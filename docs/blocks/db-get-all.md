---
title: DB Get All
description: Retrieve multiple records from a database.
---

# DB Get All

The **DB Get All** block fetches a list of records from a table. You can filter, sort, and limit these results.

## Inputs

- **Connection**: The database integration to use.
- **Table Name**: The table to query.
- **Conditions**: Rules to filter the data.
- **Limit**: The maximum number of records to return.
- **Offset**: The number of records to skip (useful for pagination).
- **Sort**: Which column to sort by and the direction (ascending/descending).

## Logic

1.  The block queries the **Table Name**.
2.  It applies **Conditions**, **Sort**, **Limit**, and **Offset**.
3.  It returns the list of matching records as the output.
