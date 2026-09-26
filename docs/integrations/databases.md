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

## Custom conditions

The DB Get All, Get Single, Update and Delete blocks can use a **Custom** condition when the [built-in operators](/blocks/db-get-all#operators) (in, contains, between, is null, …) are not enough. What you write depends on the database:

| Database | You write | Example |
| --- | --- | --- |
| PostgreSQL, MySQL | SQL, with run-time values in `{{ }}` | `tags @> {{ input.tags }}` |
| MongoDB | JavaScript returning a [query filter object](https://www.mongodb.com/docs/manual/tutorial/query-documents/) | `return { tags: { $all: input.tags } }` |

See [Custom conditions](/blocks/db-get-all#custom-conditions) for the details.
