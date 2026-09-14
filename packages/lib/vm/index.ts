import { Script } from "vm";

export class JsVM {
	private context: Record<string, any>;
	private static readonly DEFAULT_TIMEOUT = 4 * 1000;
	constructor(context: Record<string, any>) {
		this.context = context;
	}

	run(
		code: string,
		extras?: any,
		insideIIFE = true,
		globals?: Record<string, any>,
	): any {
		const script = new Script(
			insideIIFE ? `(async function () {${code}}).bind(this)();` : code,
		);
		this.context["input"] = extras;
		if (globals) Object.assign(this.context, globals);
		return script.runInNewContext(this.context, {
			timeout: JsVM.DEFAULT_TIMEOUT,
		});
	}
	async runAsync(
		code: string,
		extras?: any,
		insideIIFE = true,
		globals?: Record<string, any>,
	): Promise<any> {
		try {
			const result = this.run(code, extras, insideIIFE, globals); // vm timeout handles sync infinite loops

			// If it returned a thenable (async code), race it against a timeout.
			// NB: use a structural check, not `instanceof Promise` — the sandbox
			// realm has its own Promise, so vm-created promises fail instanceof.
			if (result != null && typeof result.then === "function") {
				const timeout = new Promise((_, reject) =>
					setTimeout(
						() => reject(new Error("JavaScript execution timeout")),
						JsVM.DEFAULT_TIMEOUT,
					),
				);
				return await Promise.race([result, timeout]);
			}
			return result;
		} finally {
			// globals live only for this execution — remove after it resolves
			if (globals) for (const k of Object.keys(globals)) delete this.context[k];
		}
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
