import { Alert, Button, Input, Label, Switch } from "@fluxify/components";
import { type ChangeEvent, useState } from "react";
import { TbAlertCircle } from "react-icons/tb";
import { DocsEditor } from "@/components/customBlocks/DocsEditor";
import { parseApiError, showErrorNotification } from "@/lib/errorNotifier";
import { knowledgeSourcesQuery } from "@/query/knowledgeSourcesQuery";
import type { CreateKnowledgeSourceBody, KnowledgeSourceType } from "@/services/knowledgeSources";
import { HeaderMappingEditor } from "./HeaderMappingEditor";
import { PagePicker } from "./PagePicker";
import { SourceTypeDropdown, type UiSourceType } from "./SourceTypeDropdown";

interface AddKnowledgeSourcePaneProps {
	projectId: string;
	onCreated: (id: string) => void;
	onCancel?: () => void;
}

export function AddKnowledgeSourcePane({
	projectId,
	onCreated,
	onCancel,
}: AddKnowledgeSourcePaneProps) {
	const [type, setType] = useState<UiSourceType>("markdown");
	const [name, setName] = useState("");
	const [content, setContent] = useState("");
	const [url, setUrl] = useState("");
	const [headers, setHeaders] = useState<Record<string, string>>({});
	const [enabled, setEnabled] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// llms_txt preview & selection state
	const [previewPages, setPreviewPages] = useState<Array<{ title: string; url: string }> | null>(
		null,
	);
	const [selectedPages, setSelectedPages] = useState<string[]>([]);
	const [isPreviewing, setIsPreviewing] = useState(false);

	const createMutation = knowledgeSourcesQuery.create.mutation(projectId);
	const previewMutation = knowledgeSourcesQuery.previewLlms.mutation(projectId);

	function handleTypeChange(nextType: UiSourceType) {
		setType(nextType);
		setError(null);
		setPreviewPages(null);
		setSelectedPages([]);
	}

	function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
		setError(null);
		const file = e.target.files?.[0];
		if (!file) return;

		if (file.size > 1_000_000 * 2) {
			setError("Markdown file exceeds maximum size limit (1 MB).");
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			const text = String(reader.result ?? "");
			if (text.length > 1_000_000) {
				setError(
					`Markdown content exceeds 1,000,000 characters (${text.length.toLocaleString()} chars).`,
				);
				return;
			}
			setContent(text);
			if (!name.trim()) {
				const autoName = file.name
					.replace(/\.[^/.]+$/, "")
					.replace(/[^a-zA-Z0-9_-]/g, "-")
					.slice(0, 100);
				setName(autoName);
			}
		};
		reader.onerror = () => {
			setError("Failed to read file.");
		};
		reader.readAsText(file);
	}

	async function handlePreviewPages() {
		setError(null);
		const trimmedUrl = url.trim();
		if (!trimmedUrl) {
			setError("Please enter a valid URL first.");
			return;
		}
		if (!/^https?:\/\//i.test(trimmedUrl)) {
			setError("URL must start with http:// or https://");
			return;
		}

		setIsPreviewing(true);
		try {
			const res = await previewMutation.mutateAsync({
				url: trimmedUrl,
				headers,
			});
			setPreviewPages(res.pages);
			// Auto-select all pages by default (up to 200)
			setSelectedPages(res.pages.slice(0, 200).map((p) => p.url));
		} catch (err) {
			const parsed = parseApiError(err);
			setError(parsed.message);
			showErrorNotification(err);
		} finally {
			setIsPreviewing(false);
		}
	}

	async function handleSubmit() {
		setError(null);
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Name is required.");
			return;
		}
		if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
			setError("Name can only contain letters, numbers, hyphens (-), and underscores (_).");
			return;
		}

		const backendType: KnowledgeSourceType =
			type === "markdown-upload" ? "markdown" : (type as KnowledgeSourceType);

		const body: CreateKnowledgeSourceBody = {
			name: trimmedName,
			type: backendType,
			enabled,
		};

		if (backendType === "markdown") {
			if (!content.trim()) {
				setError("Markdown content cannot be empty.");
				return;
			}
			if (content.length > 1_000_000) {
				setError("Markdown content exceeds 1,000,000 characters.");
				return;
			}
			body.content = content;
		} else {
			const trimmedUrl = url.trim();
			if (!trimmedUrl) {
				setError("URL is required.");
				return;
			}
			if (!/^https?:\/\//i.test(trimmedUrl)) {
				setError("URL must start with http:// or https://");
				return;
			}
			body.url = trimmedUrl;
			if (Object.keys(headers).length > 0) {
				body.headers = headers;
			}
			if (backendType === "llms_txt") {
				if (selectedPages.length === 0) {
					setError("Please preview and select at least one page from llms.txt.");
					return;
				}
				if (selectedPages.length > 200) {
					setError("Maximum 200 pages allowed.");
					return;
				}
				body.selectedPages = selectedPages;
			}
		}

		try {
			const result = await createMutation.mutateAsync(body);
			onCreated(result.id);
		} catch (err) {
			const parsed = parseApiError(err);
			setError(parsed.message);
			showErrorNotification(err);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col gap-4 p-6 overflow-y-auto">
			<div>
				<h2 className="text-lg font-semibold tracking-tight text-foreground">
					Add knowledge source
				</h2>
				<p className="text-xs text-muted">
					Add custom documentation for AI agents to search and reference.
				</p>
			</div>

			{error && (
				<Alert status="danger">
					<Alert.Indicator>
						<TbAlertCircle size={16} />
					</Alert.Indicator>
					<Alert.Content>
						<Alert.Description>{error}</Alert.Description>
					</Alert.Content>
				</Alert>
			)}

			{/* 1. Name input */}
			<div className="flex flex-col gap-1 max-w-xl">
				<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
					Name
				</Label>
				<Input
					placeholder="e.g. stripe-api-docs or fluxify-guide"
					value={name}
					onChange={(e) => setName(e.target.value)}
					className="text-xs font-mono"
				/>
				<span className="text-[11px] text-muted">
					Letters, numbers, hyphens (-), and underscores (_). Used in page paths.
				</span>
			</div>

			{/* 2. Source Type Dropdown (below Name, above Content) */}
			<SourceTypeDropdown value={type} onChange={handleTypeChange} />

			{/* 3. Type-specific inputs */}
			{type === "markdown" && (
				<div className="flex min-h-[320px] flex-1 flex-col gap-1">
					<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
						Markdown Content
					</Label>
					<DocsEditor value={content} onChange={setContent} />
					<span className="text-[11px] text-muted">
						{content.length.toLocaleString()} / 1,000,000 characters
					</span>
				</div>
			)}

			{type === "markdown-upload" && (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1 max-w-xl">
						<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
							Upload Markdown (.md)
						</Label>
						<input
							type="file"
							accept=".md,text/markdown"
							onChange={handleFileUpload}
							className="text-xs text-muted file:mr-3 file:rounded-md file:border-0 file:bg-surface-secondary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-surface-secondary/80"
						/>
						<span className="text-[11px] text-muted">Max file size: 1 MB.</span>
					</div>

					{content && (
						<div className="flex min-h-[300px] flex-col gap-1">
							<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
								Preview & Edit Uploaded Content
							</Label>
							<DocsEditor value={content} onChange={setContent} />
						</div>
					)}
				</div>
			)}

			{(type === "url" || type === "llms_full_txt") && (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1 max-w-xl">
						<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
							{type === "url" ? "HTML or Markdown URL" : "llms-full.txt URL"}
						</Label>
						<Input
							placeholder={
								type === "url"
									? "https://docs.example.com/api/v1"
									: "https://docs.example.com/llms-full.txt"
							}
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							className="text-xs"
						/>
						<span className="text-[11px] text-muted">
							GET-only fetch. Content will be converted to markdown and indexed.
						</span>
					</div>

					<HeaderMappingEditor projectId={projectId} headers={headers} onChange={setHeaders} />
				</div>
			)}

			{type === "llms_txt" && (
				<div className="flex flex-col gap-4">
					<div className="flex flex-col gap-1 max-w-xl">
						<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
							llms.txt URL
						</Label>
						<div className="flex items-center gap-2">
							<Input
								placeholder="https://docs.example.com/llms.txt"
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								className="text-xs flex-1"
							/>
							<Button
								variant="secondary"
								size="sm"
								isPending={isPreviewing}
								onPress={handlePreviewPages}
							>
								{isPreviewing ? "Fetching..." : "Fetch pages"}
							</Button>
						</div>
						<span className="text-[11px] text-muted">
							Fetches the llms.txt file to discover and select linked pages to index.
						</span>
					</div>

					<HeaderMappingEditor projectId={projectId} headers={headers} onChange={setHeaders} />

					{previewPages && (
						<PagePicker
							pages={previewPages}
							selectedPages={selectedPages}
							onChange={setSelectedPages}
						/>
					)}
				</div>
			)}

			{/* Common field: Enabled toggle */}
			<div className="flex items-center gap-3 pt-2">
				<Switch
					isSelected={enabled}
					onChange={(e: any) => setEnabled(e.target ? e.target.checked : Boolean(e))}
					label="Enabled"
				/>
				<span className="text-xs text-muted">
					When enabled, custom docs load into the AI knowledge base for agent searches.
				</span>
			</div>

			{/* Action buttons */}
			<div className="flex items-center gap-3 pt-4 border-t border-border mt-auto">
				<Button
					variant="primary"
					isPending={createMutation.isPending}
					onPress={handleSubmit}
					className="min-w-28"
				>
					{createMutation.isPending ? "Creating..." : "Create source"}
				</Button>
				{onCancel && (
					<Button variant="ghost" onPress={onCancel}>
						Cancel
					</Button>
				)}
			</div>
		</div>
	);
}
