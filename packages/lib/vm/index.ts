import { Script } from "vm";

export class JsVM {
  private context: Record<string, any>;
  private static readonly DEFAULT_TIMEOUT = 4 * 1000;
  constructor(context: Record<string, any>) {
    this.context = context;
  }

  run(code: string, extras?: any, insideIIFE = true): any {
    const script = new Script(
      insideIIFE ? `(function () {${code}}).bind(this)();` : code
    );
    this.context["input"] = extras;
    return script.runInNewContext(this.context, {timeout: JsVM.DEFAULT_TIMEOUT});
  }
  async runAsync(code: string, extras?: any, insideIIFE = true): Promise<any> {
    return new Promise((resolve) => {
      resolve(
        this.run(
          insideIIFE ? `(async function () {${code}}).bind(this)();` : code,
          extras,
          false
        )
      );
    });
  }
  truthy(value: any) {
    const type = typeof value;
    if (
      type == "bigint" ||
      type == "number" ||
      type == "string" ||
      type == "boolean"
    ) {
      return !!value;
    } else if (type == "object" && value != null) {
      return true;
    } else {
      return false;
    }
  }
  falsy(value: any) {
    return !this.truthy(value);
  }
}
