// generates route files inside apps/server/src/api/v{VERSION}
// VERSION needs to be passed as argument or defaults to 1
import fs from "fs";
import path from "path";

const scriptPath = process.argv[1];
const moduleName = process.argv[2];
const routeName = process.argv[3];
let version = Number(process.argv[4]);
const packageName = process.argv[5] || "server";
if (moduleName == "help") {
  console.log("run 'node script.js module-name route-name'");
  process.exit(0);
}

if (isNaN(version) || version < 1) version = 1;

const newPath = path.join(scriptPath, `../../apps/${packageName}/src/api/v${version}`, moduleName, routeName);

if (!routeName || !moduleName) {
  console.error("no route name provided");
} else {
  console.log("creating path:", newPath);
  fs.mkdirSync(newPath, { recursive: true });
  const files = [
    {
      filename: "route.ts",
      content: `import { Hono } from "hono";
import {
  describeRoute,
  type DescribeRouteOptions,
  resolver,
  validator,
} from "hono-openapi";
import { responseSchema } from "./dto";
import handleRequest from "./service";

const openapiRouteOptions: DescribeRouteOptions = {
  description: "Description",
  operationId: "identifier",
  tags: ["TAG"],
  responses: {
    200: {
      description: "Successful",
      content: {
        "application/json": {
          schema: resolver(responseSchema),
        },
      },
    },
  },
};

export default function (app: Hono) {
  app.get(
    "/", 
    describeRoute(openapiRouteOptions),
    // validator("query", SCHEMA),
    async (c) => {}
  );
}
`,
    },
    {
      filename: "service.ts",
      content: `import { z } from "zod";
import { responseSchema } from "./dto";

export default function handleRequest(): Promise<z.infer<typeof responseSchema>> {
  return {} as any;
}
      `,
    },
    {
      filename: "dto.ts",
      content: `import { z } from "zod";

export const responseSchema = z.object({});`,
    },
    {
      filename: "repository.ts",
      content: `// repository code goes here`,
    },
    {
      filename: `tests/${routeName}.spec.ts`,
      content: `import { describe, it } from "bun:test";

describe("unit tests for ${routeName}", () => {
  it("test 01", () => {});
});`
    },
    {
      filename: `tests/${routeName}.test.ts`,
      content: `import { describe, it } from "bun:test";

describe("integration tests for ${routeName}", () => {
  it("test 01", () => {});
});`
    },
  ];
  files.forEach((file) => {
    if (!fs.existsSync(path.join(newPath, file.filename, "../"))) {
      fs.mkdirSync(path.join(newPath, file.filename, "../"));
    }
    fs.writeFileSync(
      path.join(newPath, file.filename),
      file.content,
      { mode: 0o777 }
    );
  });
}
