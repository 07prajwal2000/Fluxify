import { SUGGEST_PLAN } from "../agentApproval";
import type { ToolPart } from "../agentMessages";
import { TODO_TOOL, todoChange } from "../todos";
import { isRec, rec, str } from "./data";
import { isDone } from "./tool";

/**
 * The accordion summary for copy_blocks:
 * e.g. "Copied 3 blocks from Create order (route) → Create order sandbox (new sandbox)"
 */
export function copyBlocksHeader(tool: ToolPart, asking = false): string {
	const done = isDone(tool) && !asking;
	const verb = done ? "Copied" : "Copy";
	const input = rec(tool.input);
	const out = rec(tool.output);

	// Key count: from output mapping or input keys
	const outKeys = isRec(out.keys) ? Object.keys(out.keys).length : undefined;
	const inKeys = Array.isArray(input.keys) ? input.keys.length : undefined;
	const count = outKeys ?? inKeys;
	const countText = count !== undefined ? `${count} block${count === 1 ? "" : "s"}` : "blocks";

	// Source
	const fromRef = rec(input.from);
	const fromKind = str(fromRef.kind) || "canvas";
	const fromKindLabel = fromKind.replace("_", " ");
	const fromName = str(input.fromName) || str(fromRef.name) || (fromRef.id ? str(fromRef.id) : "");
	const fromText = fromName ? `${fromName} (${fromKindLabel})` : fromKindLabel;

	// Target
	const toRef = input.to === "__new_sandbox__" ? "__new_sandbox__" : rec(input.to);
	const targetOut = rec(out.target);
	let toText: string;
	if (toRef === "__new_sandbox__") {
		const targetName = str(targetOut.name) || (fromName ? `${fromName} sandbox` : "new sandbox");
		toText = `${targetName} (new sandbox)`;
	} else {
		const toKind = str(targetOut.kind) || str(toRef.kind) || "sandbox";
		const toKindLabel = toKind.replace("_", " ");
		const toName = str(targetOut.name) || str(input.toName) || str(toRef.name) || str(toRef.id);
		toText = toName ? `${toName} (${toKindLabel})` : toKindLabel;
	}

	return `${verb} ${countText} from ${fromText} → ${toText}`;
}

/** Summarized one-line header text for tools that otherwise lack one. */
export function toolSummary(tool: ToolPart, asking = false): string | undefined {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const { name } = tool;

	switch (name) {
		case TODO_TOOL:
			return todoChange(tool.input);
		case SUGGEST_PLAN:
			return str(input.reason) || undefined;
		case "list_advanced_tools": {
			if (!Array.isArray(tool.output)) return undefined;
			const n = tool.output.length;
			return `${n} tool${n === 1 ? "" : "s"}`;
		}
		case "list": {
			const types = Array.isArray(input.types) ? input.types.map(str).filter(Boolean) : [];
			return types.length ? types.join(", ") : undefined;
		}
		case "get": {
			const type = str(input.type);
			if (!type) return undefined;
			const id = str(input.id);
			return id ? `${type} ${id}` : type;
		}
		case "get_block_schemas": {
			const types = Array.isArray(input.blockTypes)
				? input.blockTypes.map(str).filter(Boolean)
				: [];
			return types.length ? types.join(", ") : "All block types";
		}
		case "get_version":
		case "commit_version": {
			const number = out.versionNumber !== undefined ? `v${str(out.versionNumber)}` : "";
			const title = str(out.title);
			return [number, title].filter(Boolean).join(" · ") || str(out.versionId) || undefined;
		}
		case "load_tools": {
			if (!isRec(tool.output)) return undefined;
			const loaded = Array.isArray(out.loaded) ? out.loaded : [];
			return `Loaded ${loaded.length} tool${loaded.length === 1 ? "" : "s"}`;
		}
		case "list_recordings": {
			const items = isRec(out) && Array.isArray(out.items) ? out.items : undefined;
			if (!items) return undefined;
			return `Listed ${items.length} recording${items.length === 1 ? "" : "s"}`;
		}
		case "get_recording": {
			const parts = [str(input.kind), str(out.outcome)].filter(Boolean);
			return parts.length ? parts.join(" · ") : undefined;
		}
		case "get_integration":
			return str(out.name) || str(input.integrationId) || undefined;
		case "test_integration_connection":
			if (out.success === true) return "Success";
			return out.success === false || tool.error !== undefined ? "Failure" : undefined;
		case "create_sandbox":
			return str(input.name) || undefined;
		case "get_sandbox":
		case "run_sandbox":
			return str(input.sandboxId) || undefined;
		case "delete_sandbox":
			return str(input.sandboxId) || undefined;
		case "list_sandboxes":
			return Array.isArray(out)
				? `${out.length} sandbox${out.length === 1 ? "" : "es"}`
				: undefined;
		case "add_member":
			return str(input.user) ? `${str(input.user)} (${str(input.role) || "member"})` : undefined;
		case "update_member_role":
			return str(input.userId) ? `${str(input.userId)} → ${str(input.role)}` : undefined;
		case "remove_member":
			return str(input.userId) || undefined;
		case "install_package":
			return Array.isArray(input.packages)
				? input.packages
						.map((p: any) => str(p?.name))
						.filter(Boolean)
						.join(", ")
				: undefined;
		case "remove_package":
			return Array.isArray(input.names)
				? input.names.map(str).filter(Boolean).join(", ")
				: undefined;
		case "update_project":
			return str(input.name) || undefined;
		case "validate_test_suite":
			return str(input.testSuiteId) || undefined;
		case "clone_test_suite":
			return str(input.testSuiteId) || undefined;
		case "kv_get":
			return str(input.key) ? `key: ${str(input.key)}` : undefined;
		case "whoami":
			return isRec(out) ? str(out.email) || str(out.id) : undefined;
		default:
			return undefined;
	}
}
