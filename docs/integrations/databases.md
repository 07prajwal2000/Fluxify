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
- **Query timeout**: How long one query may run before it is stopped with an error. **Default: 30 seconds.** Raise it for slow reports; lower it to protect a busy database.
- **Max connections**: The most connections Fluxify keeps open to this database, **per worker**. **Default: 10.** See [How connections are handled](#how-connections-are-handled) before you change it.

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

::: info Query timeout on MySQL
On MySQL the timeout stops reads that run too long. A write (insert, update, delete) is stopped when it waits too long for a row another request has locked.
:::

## MongoDB

Connect to a MongoDB database. Collections take the place of tables, and the same blocks read and write documents. Joins are not available. **Max connections** defaults to 100.

::: warning Transactions need a replica set
The [DB Transaction](/blocks/db-transaction) block only works when MongoDB runs as a replica set (or behind a sharded cluster). A single standalone server still works for every other block. **Test connection** warns you when the server is standalone.
:::

## Query timeout

Every database connection stops a query that runs longer than its **Query timeout** (30 seconds unless you change it). The block that ran the query fails with a timeout error, which you can handle like any other error. This keeps one slow query from holding a connection that other requests need.

## How connections are handled

You don't need to open or close database connections yourself. Each database integration keeps a small set of open connections (a pool), and every route and workflow that uses that integration shares it. A request borrows a connection for each query and hands it straight back, so requests don't wait for a new connection to open.

You choose how many connections the pool may open with the integration's **Max connections** setting. If you leave it empty, these defaults apply:

| Database | Default max connections, per integration, per worker |
| --- | --- |
| PostgreSQL | 10 |
| MySQL | 10 |
| MongoDB | 100 |

When every connection is busy, the next query waits for one to free up instead of failing. On MongoDB that wait counts toward the Query timeout.

What to expect:

- **The first request after a quiet period is slightly slower.** It opens the pool. Every request after that reuses it.
- **Idle pools close on their own.** When nothing has used an integration for 7.5 minutes, its connections close and the next request opens them again. Your server admin can change this; see [the idle timeout setting](/deployments/production#database-integration-idle-timeout).
- **Saving changes to an integration takes effect right away**, including a new Max connections. New requests use the new settings at once. Requests already running finish on the old connections (for up to 30 seconds), which then close.
- **A transaction keeps one connection for itself** until it commits or rolls back. Keep transactions short so other requests aren't left waiting.
- **Table details are remembered.** The first query on a table looks up its primary key once, and later requests reuse what it found. If you change a table's primary key while Fluxify is running, the change is picked up the next time the pool opens: after it idles out, after you save the integration, or after a restart.
- **Reads are prepared once.** The first time a Get All, Get Single or Count block runs with a given set of active filters, its SQL is written and kept with the pool. Later runs with the same filters reuse it and only send their new values. A filter that is skipped, a value that is `null`, or a list of another length counts as a different set, and is prepared once too.
- **Test connection uses its own short-lived connection**, so testing never takes connections from running requests.

::: tip Plan your database's connection limit
Each worker keeps its own pool, so **Max connections is per worker**. The most connections your database will see from Fluxify is about **workers × Max connections**, for each integration. For example, 4 workers on a PostgreSQL integration set to 10 can open up to 40 connections, and scaling to 8 workers doubles that to 80.

Set Max connections so this total stays under your database's connection limit. Small hosted databases often allow only a few dozen connections, so lower it there. Raise it when a busy database has room and requests are waiting on each other.
:::

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

The DB Get All, Get Single, Update and Delete blocks can use a **Custom** condition when the [built-in operators](/blocks/db-conditions#operators) (in, contains, between, is null, …) are not enough. What you write depends on the database:

::: v-pre
| Database | You write | Example |
| --- | --- | --- |
| PostgreSQL, MySQL | SQL, with run-time values in `{{ }}` | `tags @> {{ input.tags }}` |
| MongoDB | JavaScript returning a [query filter object](https://www.mongodb.com/docs/manual/tutorial/query-documents/) | `return { tags: { $all: input.tags } }` |
:::

See [Custom conditions](/blocks/db-conditions#custom-conditions) for the details.
