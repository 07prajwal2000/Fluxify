---
title: Database Integrations
description: Connect your application to external databases.
---

# Database Integrations

Fluxify currently supports the following database integrations, allowing you to read and write data directly.

## PostgreSQL

Connect to a PostgreSQL database to manage your application data.

### Configuration

When setting up a PostgreSQL connection, you will need to provide:

- **Host**: The server address (e.g., `db.example.com` or `localhost`).
- **Port**: The port number (default is `5432`).
- **Database**: The name of the specific database to connect to.
- **Username**: Your database user.
- **Password**: Your database password.
- **SSL**: Enable this if your provider requires a secure connection (common for cloud databases like Neon or Supabase).

### Functionality

Once connected, you can use the following blocks to interact with your data:
- **DB Get All**: Fetch multiple rows.
- **DB Get Single**: Fetch one row.
- **DB Insert/Bulk**: Add one or many rows.
- **DB Update**: Modify existing data.
- **DB Delete**: Remove data.
- **DB Transaction**: Run multiple operations safely.
- **DB Native**: Run raw SQL queries for advanced use cases.

## MySQL

Connect to a MySQL database. It takes the same settings as PostgreSQL (without SSL) and works with the same blocks.

## MongoDB

Connect to a MongoDB database. Collections take the place of tables, and the same blocks read and write documents. Joins are not available.

## Value types

Every DB block gives back the same kind of JavaScript value for a column, whichever database it came from:

| Column type | You get | Example |
| --- | --- | --- |
| Whole numbers (`INT`, `BIGINT`, MongoDB `Long`) | a number | `42` |
| Very large whole numbers (past 9007199254740991) | text, so no digit is lost | `"9007199254740993"` |
| Decimals (`NUMERIC`, `DECIMAL`, MongoDB `Decimal128`) | text, so the value stays exact | `"12.50"` |
| Count | always a number | `3` |
| Dates and times (`TIMESTAMP`, `TIMESTAMPTZ`, `DATETIME`, `DATE`, MongoDB dates) | a `Date`, in UTC | `2024-01-02T03:04:05.000Z` |

::: tip Doing math on decimals
A decimal is text, so `row.price + 1` joins it (`"12.501"`). Turn it into a number first: `Number(row.price) + 1`. For money, where every cent must stay right, use a decimal library instead.
:::

::: info Why large numbers are text
JavaScript numbers can't hold every whole number past 9007199254740991 exactly, and a `BigInt` can't be sent in a JSON response. So those values come back as text.
:::

A date becomes plain text (ISO format, in UTC) once it is sent in a response. Inside the flow it stays a `Date`, so you can pass it straight into another DB block's condition.

The MongoDB database handle in [DB Native](/blocks/db-native) is the raw driver, so its results keep MongoDB's own types.

## Custom conditions

The DB Get All, Get Single, Update and Delete blocks can use a **Custom** condition when the [built-in operators](/blocks/db-get-all#operators) (in, contains, between, is null, …) are not enough. What you write depends on the database:

| Database | You write | Example |
| --- | --- | --- |
| PostgreSQL, MySQL | SQL, with run-time values in `{{ }}` | `tags @> {{ input.tags }}` |
| MongoDB | JavaScript returning a [query filter object](https://www.mongodb.com/docs/manual/tutorial/query-documents/) | `return { tags: { $all: input.tags } }` |

See [Custom conditions](/blocks/db-get-all#custom-conditions) for the details.
