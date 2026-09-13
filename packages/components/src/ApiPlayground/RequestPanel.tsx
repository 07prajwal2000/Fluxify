import clsx from "clsx";
import Editor from "@monaco-editor/react";
import { useMemo } from "react";
import { TbAlertCircle, TbBraces, TbCode, TbPlus, TbTable } from "react-icons/tb";
import { Button, Card as HeroCard, Input, ListBox, Select, Tabs } from "@heroui/react";
import type { ReactNode } from "react";
import { Checkbox } from "../Checkbox";
import { KeyValueTable } from "./KeyValueTable";
import { SchemaForm } from "./SchemaForm";
import type { ApiFormValue, ApiKeyValue, ApiPlaygroundRoute } from "./types";
import { createRow, pathParameterNames, schemaProperties } from "./utils";
import type { PlaygroundValidationErrors } from "./validation";

type RequestPanelProps = {
	route: ApiPlaygroundRoute;
	rawPath: string;
	pathRows: ApiKeyValue[];
	queryRows: ApiKeyValue[];
	headerRows: ApiKeyValue[];
	body: string;
	formBody: Record<string, ApiFormValue>;
	contentType: string;
	selectedTab: string;
	onTabChange: (tab: string) => void;
	errors?: PlaygroundValidationErrors;
	validateBeforeSend?: boolean;
	onValidateChange?: (validate: boolean) => void;
	onPathRowsChange: (rows: ApiKeyValue[]) => void;
	onQueryRowsChange: (rows: ApiKeyValue[]) => void;
	onHeaderRowsChange: (rows: ApiKeyValue[]) => void;
	onBodyChange: (body: string) => void;
	onFormBodyChange: (body: Record<string, ApiFormValue>) => void;
	onContentTypeChange: (contentType: string) => void;
};

export function RequestPanel({
	route,
	rawPath,
	pathRows,
	queryRows,
	headerRows,
	body,
	formBody,
	contentType,
	selectedTab,
	onTabChange,
	errors,
	validateBeforeSend,
	onValidateChange,
	onPathRowsChange,
	onQueryRowsChange,
	onHeaderRowsChange,
	onBodyChange,
	onFormBodyChange,
	onContentTypeChange,
}: RequestPanelProps) {
	const isForm = contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data";
	const bodyLanguage = contentType.includes("json") ? "json" : "plaintext";
	const pathTypes = useMemo(() => new Map(schemaProperties(route.paramsSchema).map((property) => [property.key, property.dataType])), [route.paramsSchema]);
	const pathNames = pathParameterNames(rawPath);

	const hasParamsError = Boolean((errors?.pathParams && Object.keys(errors.pathParams).length > 0) || (errors?.queryParams && Object.keys(errors.queryParams).length > 0));
	const hasBodyError = Boolean(errors?.bodyError || (errors?.formFields && Object.keys(errors.formFields).length > 0));

	return (
		<section className="min-h-0 overflow-hidden border-r border-border bg-background">
			<Tabs
				variant="secondary"
				selectedKey={selectedTab}
				onSelectionChange={(key) => onTabChange(key as string)}
				className="api-playground-tabs api-playground-tabs--request flex h-full flex-col"
			>
				<Tabs.ListContainer className="shrink-0 px-3">
					<div className="flex h-full w-full items-center justify-between gap-3">
						<Tabs.List aria-label="Request configuration" style={{ width: "max-content", minWidth: 0 }} className="gap-5">
							<Tabs.Tab id="params">
								<span>Params</span>
								{hasParamsError ? (
									<span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
										<TbAlertCircle size={12} />
										<span>{Object.keys(errors?.pathParams ?? {}).length + Object.keys(errors?.queryParams ?? {}).length}</span>
									</span>
								) : (
									<span className="ml-1.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px]">{pathRows.length + queryRows.filter((row) => row.key).length}</span>
								)}
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="headers">
								<span>Headers</span> <span className="ml-1.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px]">{headerRows.filter((row) => row.key).length}</span>
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="body">
								<span>Body</span>
								{hasBodyError ? (
									<span className="ml-1.5 inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">
										<TbAlertCircle size={12} />
									</span>
								) : (
									<span className="ml-1.5 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[10px]">{route.bodySchema ? 1 : 0}</span>
								)}
								<Tabs.Indicator />
							</Tabs.Tab>
						</Tabs.List>
						{onValidateChange && (
							<div
								title="Validate route parameters, query parameters, and body schemas client-side before sending. Disable to test raw server error responses."
								className="inline-flex shrink-0 items-center"
							>
								<Checkbox
									isSelected={validateBeforeSend}
									onChange={onValidateChange}
									className="font-sans text-xs text-muted select-none"
								>
									Validate
								</Checkbox>
							</div>
						)}
					</div>
				</Tabs.ListContainer>
				<Tabs.Panel id="params" className="min-h-0 flex-1 overflow-hidden p-3">
					<div className="space-y-3">
						<RequestCard title="Path Variables" icon={<TbBraces size={16} />} action={`${pathNames.length} detected`}>
							{pathRows.length ? (
								<div className="space-y-1.5">
									<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 px-1 text-[10px] font-medium uppercase tracking-wider text-muted">
										<span>Key</span>
										<span>Value</span>
									</div>
									{pathRows.map((row) => {
										const isInvalid = Boolean(errors?.pathParams?.[row.key]);
										return (
											<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2" key={row.id}>
												<div
													className={clsx(
														"flex h-8 min-w-0 items-center rounded-md border bg-surface px-2.5 font-mono text-xs",
														isInvalid ? "border-danger text-danger font-semibold" : "border-border text-muted"
													)}
												>
													:{row.key}
													<span className="ml-auto text-[10px]">{pathTypes.get(row.key) ?? "str"}</span>
												</div>
												<div className="flex flex-col min-w-0">
													<Input
														aria-label={`${row.key} value`}
														aria-invalid={isInvalid}
														value={row.value}
														onChange={(event) =>
															onPathRowsChange(
																pathRows.map((candidate) =>
																	candidate.id === row.id ? { ...candidate, value: event.target.value } : candidate
																)
															)
														}
														className={clsx("h-8 min-w-0 font-mono text-xs", isInvalid && "border-danger text-danger")}
													/>
													{isInvalid && <span className="text-[10px] text-danger mt-0.5">{errors?.pathParams?.[row.key]}</span>}
												</div>
											</div>
										);
									})}
								</div>
							) : (
								<Empty label="No path variables in this URL." />
							)}
						</RequestCard>
						<RequestCard
							title="Query Parameters"
							icon={<TbCode size={16} />}
							action={
								<Button size="sm" variant="secondary" onPress={() => onQueryRowsChange([...queryRows, createRow()])}>
									<TbPlus size={14} />
									Add
								</Button>
							}
						>
							<KeyValueTable rows={queryRows} onChange={onQueryRowsChange} addLabel="Add query" errors={errors?.queryParams} />
						</RequestCard>
					</div>
				</Tabs.Panel>
				<Tabs.Panel id="headers" className="min-h-0 flex-1 overflow-hidden p-3">
					<RequestCard
						title="Request Headers"
						icon={<TbTable size={16} />}
						action={
							<Button size="sm" variant="secondary" onPress={() => onHeaderRowsChange([...headerRows, createRow()])}>
								<TbPlus size={14} />
								Add
							</Button>
						}
					>
						<KeyValueTable rows={headerRows} onChange={onHeaderRowsChange} addLabel="Add header" />
					</RequestCard>
				</Tabs.Panel>
				<Tabs.Panel id="body" className="min-h-0 flex-1 overflow-hidden p-3">
					<RequestCard
						title="Request Body"
						icon={<TbBraces size={16} />}
						action={
							route.bodySchema ? (
								<Select selectedKey={contentType} onSelectionChange={(key) => onContentTypeChange(key as string)} className="w-52 font-mono text-[11px]">
									<Select.Trigger>
										<Select.Value />
										<Select.Indicator />
									</Select.Trigger>
									<Select.Popover>
										<ListBox>
											{(route.acceptedContentTypes?.length ? route.acceptedContentTypes : ["application/json"]).map((type) => (
												<ListBox.Item id={type} key={type} textValue={type}>
													{type}
													<ListBox.ItemIndicator />
												</ListBox.Item>
											))}
										</ListBox>
									</Select.Popover>
								</Select>
							) : undefined
						}
					>
						{errors?.bodyError && (
							<div className="mb-3 flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
								<TbAlertCircle className="shrink-0 size-4" />
								<span>{errors.bodyError}</span>
							</div>
						)}
						{!route.bodySchema ? (
							<Empty label="This route has no request body schema." />
						) : isForm ? (
							<SchemaForm schema={route.bodySchema} value={formBody} onChange={onFormBodyChange} errors={errors?.formFields} />
						) : (
							<div className={clsx("h-[calc(100%-20px)] min-h-64 overflow-hidden rounded-md border", errors?.bodyError ? "border-danger" : "border-border")}>
								<Editor
									height="100%"
									language={bodyLanguage}
									theme="vs-dark"
									value={body}
									onChange={(value) => onBodyChange(value ?? "")}
									options={{ minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, fontSize: 13, lineHeight: 20, padding: { top: 10, bottom: 10 } }}
								/>
							</div>
						)}
					</RequestCard>
				</Tabs.Panel>
			</Tabs>
		</section>
	);
}

function RequestCard({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
	return (
		<HeroCard style={{ padding: 0, gap: 0 }} className="overflow-hidden border-border bg-surface">
			<HeroCard.Header className="flex h-11 flex-row items-center gap-2 border-b border-border px-3 py-0">
				<span className="text-muted">{icon}</span>
				<HeroCard.Title className="text-[13px]">{title}</HeroCard.Title>
				<div className="ml-auto">{action}</div>
			</HeroCard.Header>
			<HeroCard.Content className="p-3">{children}</HeroCard.Content>
		</HeroCard>
	);
}

function Empty({ label }: { label: string }) {
	return <p className="py-2 text-center text-xs text-muted">{label}</p>;
}

