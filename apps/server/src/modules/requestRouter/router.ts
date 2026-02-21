import { HttpRouteParser } from "@fluxify/lib";
import { Hono } from "hono";
import { handleRequest } from "./service";

export async function mapRouter(app: Hono<any>, parser: HttpRouteParser) {
  app.all("*", async (c) => {
    try {
      const response = await handleRequest(c, parser);
      c.status(response.status);
      return c.json(response.data);
    } catch (error) {
      return c.json(
        { message: error?.toString() || "Internal server error" },
        500,
      );
    }
  });
}
