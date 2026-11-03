import { JsonTextEditor } from "@fluxify/components";
import { useState } from "react";
import { parseExtraBody } from "./extraBody";

/**
 * The OpenAI Compatible extra request body: a Monaco JSON editor. The text is the
 * editor's own while you type, and the parsed object goes to the form only when the
 * text is a valid JSON object, so a half-typed body never replaces the saved one.
 */
export function ExtraBodyField({
	value,
	onChange,
}: {
	value: Record<string, unknown> | undefined;
	onChange: (body: Record<string, unknown>) => void;
}) {
	const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 2) : ""));
	const [error, setError] = useState<string>();
	return (
		<div className="flex flex-col gap-1">
			<span className="text-xs font-medium text-foreground">Extra request body</span>
			<JsonTextEditor
				value={text}
				invalid={Boolean(error)}
				onChange={(next) => {
					setText(next);
					const parsed = parseExtraBody(next);
					setError("error" in parsed ? parsed.error : undefined);
					if ("body" in parsed) onChange(parsed.body);
				}}
			/>
			{error ? (
				<span className="text-xs text-danger">{error}</span>
			) : (
				<span className="text-xs text-muted">
					Fields added to every request, e.g. {'{ "reasoning_effort": "low" }'} to set thinking.
					Values accept cfg:KEY. The messages, tools and model of a request always win.
				</span>
			)}
		</div>
	);
}
