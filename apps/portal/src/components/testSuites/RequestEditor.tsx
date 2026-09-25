import {
	type ApiRequestBody,
	BodyEditor,
	CustomSelect,
	FieldMapEditor,
	Label,
	TextArea,
} from "@fluxify/components";
import { useRef, useState } from "react";
import type { RouteDetail } from "@/services/routes";
import { methodTakesBody, pathParamsOf } from "./assertions";
import { fromEditorBody, toEditorBody } from "./bodyCodec";
import type { SuiteDraft } from "./types";

/**
 * The mock request a suite sends: description, path params, query, headers and
 * body. Path params come from the route's own `:segments` rather than being
 * typed blind.
 */
export function RequestEditor({
	draft,
	route,
	onChange,
}: {
	draft: SuiteDraft;
	route: RouteDetail | undefined;
	onChange: (patch: Partial<SuiteDraft>) => void;
}) {
	const routePath = route?.path;
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
									placeholder={`${param} value`}
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
				keyPlaceholder="Query parameter name"
				valuePlaceholder="Query parameter value"
				onKeyValueChange={(queryParams) => onChange({ queryParams })}
			/>

			<FieldMapEditor
				label="Headers"
				fieldMap={draft.headers}
				keyPlaceholder="Header name"
				valuePlaceholder="Header value"
				onKeyValueChange={(headers) => onChange({ headers })}
			/>

			{methodTakesBody(route?.method) && (
				<SuiteBody draft={draft} route={route} onChange={onChange} />
			)}
		</div>
	);
}

/**
 * The shared playground body editor, over a body stored as JSON. Every edit is
 * encoded back to the stored shape; one that can't be (bad JSON, a file over
 * 1MB) is shown instead of saved.
 */
function SuiteBody({
	draft,
	route,
	onChange,
}: {
	draft: SuiteDraft;
	route: RouteDetail | undefined;
	onChange: (patch: Partial<SuiteDraft>) => void;
}) {
	const accepted = route?.acceptedContentTypes?.length
		? route.acceptedContentTypes
		: ["application/json"];
	const contentType = draft.contentType ?? accepted[0];
	const hasSchemaFields = (route?.bodySchema?.properties?.length ?? 0) > 0;
	const [value, setValue] = useState(() => toEditorBody(draft.body, contentType));
	const [error, setError] = useState<string>();
	const latest = useRef(0);

	async function commit(next: ApiRequestBody, type: string) {
		setValue(next);
		const edit = ++latest.current;
		const result = await fromEditorBody(next, type, hasSchemaFields);
		// file reads are async; an older edit must not land over a newer one
		if (edit !== latest.current) return;
		if ("error" in result) return setError(result.error);
		setError(undefined);
		onChange({ contentType: type, body: result.body });
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-end justify-between gap-4">
				<div className="flex flex-col gap-1">
					<Label>Body</Label>
					<span className="text-xs text-muted">Sent as the request body when the suite runs.</span>
				</div>
				<CustomSelect
					aria-label="Content type"
					className="w-60 font-mono text-xs"
					options={accepted.map((type) => ({ value: type, label: type }))}
					value={contentType}
					onChange={(type) => commit(value, type)}
				/>
			</div>
			{error && <span className="text-xs text-danger">{error}</span>}
			<div className="h-72">
				<BodyEditor
					contentType={contentType}
					schema={route?.bodySchema}
					value={value}
					onChange={(next) => commit(next, contentType)}
					errors={{ bodyError: error }}
				/>
			</div>
		</div>
	);
}
