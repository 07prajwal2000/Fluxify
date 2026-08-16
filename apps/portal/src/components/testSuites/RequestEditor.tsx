import { FieldMapEditor, JsonEditor, Label, TextArea } from "@fluxify/components";
import type { JsonContainer } from "@fluxify/components";
import { methodTakesBody, pathParamsOf } from "./assertions";
import type { SuiteDraft } from "./types";

/**
 * The mock request a suite sends: description, path params, query, headers and
 * body. Path params come from the route's own `:segments` rather than being
 * typed blind.
 */
export function RequestEditor({
	draft,
	routePath,
	method,
	onChange,
}: {
	draft: SuiteDraft;
	routePath: string | undefined;
	method: string | undefined;
	onChange: (patch: Partial<SuiteDraft>) => void;
}) {
	const pathParams = pathParamsOf(routePath);

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-col gap-1">
				<Label>Description</Label>
				<TextArea
					rows={2}
					placeholder="What this suite proves"
					value={draft.description}
					onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
						onChange({ description: e.target.value })
					}
				/>
			</div>

			{pathParams.length > 0 && (
				<div className="flex flex-col gap-2">
					<Label>Path parameters</Label>
					<span className="text-xs text-muted font-mono">{routePath}</span>
					<div className="flex flex-col gap-2">
						{pathParams.map((param) => (
							<div key={param} className="flex items-center gap-2">
								<span className="w-40 shrink-0 truncate font-mono text-xs text-muted">
									:{param}
								</span>
								<input
									className="flex-1 rounded-md border border-border bg-background-secondary px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent"
									placeholder="value"
									value={draft.routeParams[param] ?? ""}
									onChange={(e) =>
										onChange({
											routeParams: { ...draft.routeParams, [param]: e.target.value },
										})
									}
								/>
							</div>
						))}
					</div>
				</div>
			)}

			<FieldMapEditor
				label="Query parameters"
				fieldMap={draft.queryParams}
				onKeyValueChange={(queryParams) => onChange({ queryParams })}
			/>

			<FieldMapEditor
				label="Headers"
				fieldMap={draft.headers}
				onKeyValueChange={(headers) => onChange({ headers })}
			/>

			{methodTakesBody(method) && (
				<JsonEditor
					label="Body"
					description="Sent as the request body when the suite runs."
					value={(draft.body ?? {}) as JsonContainer}
					onChange={(body) => onChange({ body: body as Record<string, unknown> })}
					showPreview
				/>
			)}
		</div>
	);
}
