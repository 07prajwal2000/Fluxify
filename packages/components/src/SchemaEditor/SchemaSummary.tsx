import { CodeViewer } from "../CodeViewer";
import { SchemaPreview } from "./SchemaPreview";
import type { ValidationSchema } from "./types";

/**
 * Read-only summary of a validation schema: the shape outline for builder
 * schemas, the validator source for custom JS schemas. The Schema editor's
 * Preview tab and read-only consumers (e.g. the Versions page, #791) both
 * render this — neither should show the editable builder.
 */
export function SchemaSummary({ schema }: { schema: ValidationSchema }) {
	if (schema.dataType === "js") {
		const code = schema.js?.trim();
		// A `js` schema with no source validates nothing (schemaParser.ts).
		if (!code) return <p className="text-sm italic text-muted">No code defined yet.</p>;
		return <CodeViewer language="javascript" value={code} />;
	}

	return <SchemaPreview schema={schema} />;
}
