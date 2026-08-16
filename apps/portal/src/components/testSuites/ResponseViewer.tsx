import { useMemo, useState } from "react";
import { Button, CodeViewer, cn } from "@fluxify/components";
import { TbDownload } from "react-icons/tb";

type Headers = Record<string, string> | undefined;

function contentTypeOf(headers: Headers) {
	if (!headers) return "";
	const entry = Object.entries(headers).find(
		([key]) => key.toLowerCase() === "content-type",
	);
	return entry?.[1]?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

/** Same mapping the API playground uses, kept local to avoid a cross-package import. */
function languageFor(mime: string) {
	if (mime.includes("json") || mime.endsWith("+json")) return "json";
	if (mime.includes("xml")) return "xml";
	if (mime.includes("html")) return "html";
	if (mime.includes("javascript")) return "javascript";
	return "plaintext";
}

/**
 * How the payload should be shown. Anything the browser can render natively
 * (image, video, audio) gets its own element; anything else that is not text
 * becomes a download, since dumping bytes into an editor helps nobody.
 */
function presentationFor(mime: string, data: unknown) {
	if (mime.startsWith("image/")) return "image" as const;
	if (mime.startsWith("video/")) return "video" as const;
	if (mime.startsWith("audio/")) return "audio" as const;
	const textual =
		!mime ||
		mime.startsWith("text/") ||
		mime.includes("json") ||
		mime.includes("xml") ||
		mime.includes("javascript") ||
		mime.includes("html") ||
		typeof data === "object";
	return textual ? ("text" as const) : ("binary" as const);
}

/**
 * A run's payload is stored as jsonb, so binary bodies arrive as a base64 or
 * data-URI string. Both become a usable src; anything else has no meaningful
 * media representation and falls back to the text view.
 */
function toDataUri(mime: string, data: unknown): string | null {
	if (typeof data !== "string") return null;
	if (data.startsWith("data:")) return data;
	if (/^[A-Za-z0-9+/=\s]+$/.test(data) && data.length > 16) {
		return `data:${mime || "application/octet-stream"};base64,${data.replace(/\s/g, "")}`;
	}
	return null;
}

function asText(data: unknown) {
	if (data === undefined || data === null) return "";
	return typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

function HeadersTable({ headers }: { headers: Headers }) {
	const entries = Object.entries(headers ?? {});
	if (entries.length === 0) {
		return <p className="p-4 text-center text-xs text-muted">No headers recorded.</p>;
	}
	return (
		<div className="overflow-hidden rounded-md border border-border">
			{entries.map(([key, value]) => (
				<div
					key={key}
					className="grid grid-cols-[minmax(100px,40%)_1fr] gap-2 border-b border-border px-2 py-1.5 font-mono text-xs last:border-0"
				>
					<span className="truncate text-muted">{key}</span>
					<span className="break-all text-foreground">{value}</span>
				</div>
			))}
		</div>
	);
}

/** Response body + headers for one suite run, as secondary tabs. */
export function ResponseViewer({
	data,
	headers,
	suiteName,
}: {
	data: unknown;
	headers: Headers;
	suiteName: string;
}) {
	const [tab, setTab] = useState<"body" | "headers">("body");
	const mime = contentTypeOf(headers);
	const presentation = presentationFor(mime, data);
	const src = useMemo(
		() => (presentation === "text" ? null : toDataUri(mime, data)),
		[presentation, mime, data],
	);
	const headerCount = Object.keys(headers ?? {}).length;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-1 border-b border-border">
				{(["body", "headers"] as const).map((name) => (
					<button
						key={name}
						type="button"
						onClick={() => setTab(name)}
						className={cn(
							"border-b-2 px-2 py-1 text-xs font-medium capitalize transition-colors",
							tab === name
								? "border-accent text-accent"
								: "border-transparent text-muted hover:text-foreground",
						)}
					>
						{name}
						{name === "headers" && headerCount > 0 && (
							<span className="ml-1 text-muted">{headerCount}</span>
						)}
					</button>
				))}
				{mime && <span className="ml-auto font-mono text-xs text-muted">{mime}</span>}
			</div>

			{tab === "headers" ? (
				<HeadersTable headers={headers} />
			) : presentation === "image" && src ? (
				<img
					src={src}
					alt={`${suiteName} response`}
					className="max-h-64 max-w-full rounded-md border border-border object-contain"
				/>
			) : presentation === "video" && src ? (
				// eslint-disable-next-line jsx-a11y/media-has-caption -- a response body has no caption track
				<video src={src} controls className="max-h-64 w-full rounded-md border border-border" />
			) : presentation === "audio" && src ? (
				// eslint-disable-next-line jsx-a11y/media-has-caption -- a response body has no caption track
				<audio src={src} controls className="w-full" />
			) : presentation === "binary" ? (
				<div className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
					<span className="flex-1 text-xs text-muted">
						Binary response ({mime || "unknown type"}) — nothing useful to render.
					</span>
					{src ? (
						<a
							href={src}
							download={`${suiteName || "response"}.bin`}
							className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-accent hover:text-accent"
						>
							<TbDownload size={14} /> Download
						</a>
					) : (
						<Button variant="ghost" size="sm" isDisabled>
							Not downloadable
						</Button>
					)}
				</div>
			) : (
				<CodeViewer language={languageFor(mime)} value={asText(data)} />
			)}
		</div>
	);
}
