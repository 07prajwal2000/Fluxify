interface MongoDbSingleHost {
  scheme: "mongodb" | "mongodb+srv";
  username: string | null;
  password: string | null;
  host: string;
  port: number | null; // null for mongodb+srv (port is resolved via DNS)
  database: string | null;
  ssl: boolean; // true if ssl=true|1 or tls=true|1
  options: Record<string, string>;
}

/**
 * Parse a MongoDB connection string that contains **exactly one host**.
 * Returns `null` if the format is invalid or if more than one host is present.
 */
export function parseMongoDbSingleHost(url: string): MongoDbSingleHost | null {
  // 1. scheme://[user:pass@]host[:port][/db][?opts]
  const re =
    /^mongodb(?:\+srv)?:\/\/(?:([^:]+):([^@]+)@)?([^,/:]+)(?::(\d+))?(?:\/([^?]+))?(?:\?(.+))?$/i;
  const m = url.match(re);
  if (!m) return null;

  const [, userEnc, passEnc, host, portStr, dbEnc, query] = m;
  const scheme = m[0].includes("+srv") ? "mongodb+srv" : "mongodb";

  // Decode credentials (handles %40, %3A, etc.)
  const username = userEnc ? decodeURIComponent(userEnc) : null;
  const password = passEnc ? decodeURIComponent(passEnc) : null;

  const port = portStr ? Number(portStr) : null;
  const database = dbEnc ? decodeURIComponent(dbEnc) : null;

  // Parse query string into a map
  const options: Record<string, string> = {};
  if (query) {
    query.split("&").forEach((pair) => {
      const [k, v = ""] = pair.split("=");
      options[decodeURIComponent(k)] = decodeURIComponent(v);
    });
  }

  // Normalise ssl / tls to a boolean
  const sslRaw = options.ssl ?? options.tls ?? "false";
  const ssl = sslRaw === "true" || sslRaw === "1";

  return {
    scheme,
    username,
    password,
    host,
    port,
    database,
    ssl,
    options,
  };
}
