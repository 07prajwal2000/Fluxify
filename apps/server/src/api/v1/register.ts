import { openAPIRouteHandler } from "hono-openapi";
import routes from "./routes/register";
import projects from "./projects/register";
import appConfig from "./app-config/register";
import integrations from "./integrations/register";
import testSuites from "./test-suites/register";
import { HonoServer } from "../../types";

export default {
  name: "v1",
  registerHandler(app: HonoServer) {
    const router = app.basePath("/v1");
    router.get(
      "/openapi.json",
      openAPIRouteHandler(router, {
        documentation: {
          info: {
            title: "Fluxify - Low Code Rest API Platform",
            version: "v1",
            description:
              "Fluxify | Low Code Rest API Platform | Admin API Documentation | Require Authentication",
          },
        },
      }),
    );
    routes.registerHandler(router);
    projects.registerHandler(router);
    appConfig.registerHandler(router);
    integrations.registerHandler(router);
    testSuites.registerHandler(router);
  },
};
