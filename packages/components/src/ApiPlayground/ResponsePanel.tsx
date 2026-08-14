import Editor from "@monaco-editor/react";
import { useMemo } from "react";
import { TbClock, TbCopy, TbDatabase } from "react-icons/tb";
import { Button, Tabs } from "@heroui/react";
import type { ApiPlaygroundResponse } from "./types";
import { inferLanguage, responseHeaders, statusTone } from "./utils";

export function ResponsePanel({ response }: { response?: ApiPlaygroundResponse }) {
	const headers = useMemo(() => responseHeaders(response?.headers), [response?.headers]);
	const mimeType = response?.mimeType ?? headers.find(([key]) => key.toLowerCase() === "content-type")?.[1];
	const bytes = response?.bytes ?? new TextEncoder().encode(response?.body ?? "").byteLength;

	return (
		<section className="flex min-h-0 flex-col overflow-hidden bg-background">
			<Tabs variant="secondary" defaultSelectedKey="body" className="api-playground-tabs api-playground-tabs--response flex min-h-0 flex-1 flex-col">
				<Tabs.ListContainer className="h-12 shrink-0 px-3">
					<div className="api-playground-response-tabs__bar">
						<ResponseMetadata bytes={bytes} response={response} />
						<Tabs.List aria-label="Response contents" style={{ width: "max-content", minWidth: 0, flex: "0 0 auto" }} className="h-full gap-5">
							<Tabs.Tab id="body">Body<Tabs.Indicator /></Tabs.Tab>
							<Tabs.Tab id="headers">Headers {response && <span className="ml-1.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px]">{headers.length}</span>}<Tabs.Indicator /></Tabs.Tab>
						</Tabs.List>
					</div>
				</Tabs.ListContainer>
				<Tabs.Panel id="body" className="relative min-h-0 flex-1 overflow-hidden">
					{response ? <><Editor height="100%" language={inferLanguage(mimeType)} theme="vs-dark" value={response.body ?? ""} options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, fontSize: 13, lineHeight: 20, padding: { top: 14, bottom: 14 } }} /><Button aria-label="Copy response" isIconOnly size="sm" variant="secondary" className="absolute right-3 top-3 z-10" onPress={() => navigator.clipboard.writeText(response.body ?? "")}><TbCopy size={14} /></Button></> : <EmptyResponse />}
				</Tabs.Panel>
				<Tabs.Panel id="headers" className="min-h-0 flex-1 overflow-hidden p-3">
					{headers.length ? <div className="overflow-hidden rounded-md border border-border"><div className="grid grid-cols-[minmax(140px,30%)_1fr] border-b border-border bg-surface px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted"><span>Name</span><span>Value</span></div>{headers.map(([key, value]) => <div className="grid grid-cols-[minmax(140px,30%)_1fr] border-b border-border px-3 py-2 font-mono text-xs last:border-0" key={key}><span className="text-muted">{key}</span><span className="break-all">{value}</span></div>)}</div> : <EmptyResponse />}
				</Tabs.Panel>
			</Tabs>
		</section>
	);
}

function ResponseMetadata({ response, bytes }: { response?: ApiPlaygroundResponse; bytes: number }) {
	if (!response) return <span className="font-mono text-[11px] text-muted">No response yet</span>;
	return <div className="flex shrink-0 items-center gap-3"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[11px] font-semibold ${statusTone(response.status)}`}><i className="h-1.5 w-1.5 rounded-full bg-current" />{response.status} {response.statusText || ""}</span><span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted"><TbClock size={13} />{response.durationMs ?? 0} ms</span><span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted"><TbDatabase size={13} />{bytes} B</span></div>;
}

function EmptyResponse() {
	return <div className="grid h-full place-items-center p-6 text-center"><div><div className="mb-2 font-mono text-xs font-semibold">NO RESULT</div><p className="max-w-60 text-xs text-muted">Send this request to inspect its response, headers, timing, and size.</p></div></div>;
}
