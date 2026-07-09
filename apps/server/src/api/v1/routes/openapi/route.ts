import { HonoServer } from "../../../../types";
import { generateOpenApiSpec } from "./service";
import { validator } from "hono-openapi";
import zodErrorCallbackParser from "../../../../middlewares/zodErrorCallbackParser";
import { requestParamSchema } from "./dto";

export default function (app: HonoServer) {
  app.get(
    "/:projectId/openapi.json",
    validator("param", requestParamSchema, zodErrorCallbackParser),
    async (ctx: any) => {
      const param = ctx.req.valid("param");

      try {
        const spec = await generateOpenApiSpec(param);
        return ctx.json(spec);
      } catch (error: any) {
        if (error.message === "Project not found") {
          return ctx.json({ error: error.message }, 404);
        }
        return ctx.json({ error: "Internal Server Error" }, 500);
      }
    }
  );
}
