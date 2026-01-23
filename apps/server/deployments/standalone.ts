import { serve } from "@hono/node-server";
import { app } from "../src/server";

const port = Number(process.env.SERVER_PORT) || 5500;
const hostname = process.env.HOSTNAME || "0.0.0.0";
serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`standalone server started at http://${hostname}:${info.port}`);
});
