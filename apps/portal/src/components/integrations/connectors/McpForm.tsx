import { Button, cn, DeleteIconButton, Input, Label } from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import { AppConfigSelector } from "../AppConfigSelector";
import { McpOAuthConnect, type McpOAuthStatus } from "./McpOAuthConnect";
import type { ConnectorFormProps } from "./types";

type Header = { key: string; value: string };

export function McpForm({
	projectId,
	name,
	onName,
	config,
	setField,
	hideName = false,
	readOnly = false,
	tools,
	oauth,
}: ConnectorFormProps) {
	// read from the config, so an edit page that fills it after mounting shows the saved choice
	const authMode = config.auth === "oauth" ? "oauth" : "headers";
	const rawHeaders = config.headers;
	const headers: Header[] = Array.isArray(rawHeaders) ? (rawHeaders as Header[]) : [];

	function updateHeader(index: number, key: string, value: string) {
		const next = headers.map((h, i) => (i === index ? { key, value } : h));
		setField("headers", next);
	}

	function addHeader() {
		setField("headers", [...headers, { key: "", value: "" }]);
	}

	function removeHeader(index: number) {
		setField(
			"headers",
			headers.filter((_, i) => i !== index),
		);
	}

	return (
		<div className="flex flex-col gap-3.5">
			{!hideName && (
				<div className="flex flex-col gap-1">
					<label htmlFor="mcp-integration-name" className="text-xs font-medium text-foreground">
						Integration Name <span className="text-danger">*</span>
					</label>
					<Input
						id="mcp-integration-name"
						value={name}
						onChange={(e) => onName(e.currentTarget.value)}
						placeholder="e.g. GitHub MCP Server"
						disabled={readOnly}
					/>
				</div>
			)}

			<div className="flex flex-col gap-1">
				<label htmlFor="mcp-url" className="text-xs font-medium text-foreground">
					Server URL <span className="text-danger">*</span>
				</label>
				<Input
					id="mcp-url"
					value={(config.url as string) ?? ""}
					onChange={(e) => setField("url", e.currentTarget.value)}
					placeholder="https://mcp.example.com/sse"
					disabled={readOnly}
				/>
			</div>

			<div className="flex flex-col gap-1">
				<Label>Authentication</Label>
				<div className="flex rounded-lg border border-border bg-background-secondary p-1">
					{(["headers", "oauth"] as const).map((mode) => (
						<button
							key={mode}
							type="button"
							disabled={readOnly}
							onClick={() => setField("auth", mode)}
							className={cn(
								"flex-1 rounded-md py-1 text-xs font-medium transition-all duration-150",
								authMode === mode
									? "bg-surface text-foreground shadow-sm"
									: "text-muted hover:text-foreground",
							)}
						>
							{mode === "oauth" ? "OAuth" : "Headers"}
						</button>
					))}
				</div>
			</div>

			{authMode === "oauth" && (
				<McpOAuthConnect
					projectId={projectId}
					target={oauth}
					status={config.oauth as McpOAuthStatus | undefined}
				/>
			)}

			{authMode === "headers" && (
				<div className="flex flex-col gap-2">
					<div className="flex flex-col gap-1">
						<Label>Headers</Label>
						<p className="text-xs text-muted">Use app config references for secrets</p>
					</div>
					{headers.map((h, index) => (
						<div key={index} className="flex items-center gap-2">
							<Input
								className="w-2/5"
								value={h.key}
								onChange={(e) => updateHeader(index, e.currentTarget.value, h.value)}
								placeholder="Header name"
								aria-label="Header key"
								disabled={readOnly}
							/>
							<AppConfigSelector
								projectId={projectId}
								value={h.value}
								onChange={(v) => updateHeader(index, h.key, v)}
								placeholder="Header value"
								isDisabled={readOnly}
							/>
							{!readOnly && (
								<DeleteIconButton aria-label="Remove header" onPress={() => removeHeader(index)} />
							)}
						</div>
					))}
					{!readOnly && (
						<Button size="sm" variant="secondary" className="self-start" onPress={addHeader}>
							<TbPlus size={14} /> Add header
						</Button>
					)}
				</div>
			)}

			{tools !== undefined && (
				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-secondary/40 p-3">
					<span className="text-xs font-semibold text-foreground">
						Exposed Tools ({tools.length})
					</span>
					{tools.length === 0 ? (
						<p className="text-xs text-muted">No tools exposed by this server.</p>
					) : (
						<div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
							{tools.map((t) => (
								<div
									key={t.name}
									className="flex flex-col gap-0.5 rounded border border-border bg-surface p-2 text-xs"
								>
									<span className="font-mono font-medium text-foreground">{t.name}</span>
									{t.description && <span className="text-muted">{t.description}</span>}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
