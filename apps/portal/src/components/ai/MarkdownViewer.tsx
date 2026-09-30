import { Table, Typography } from "@fluxify/components";
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import {
	CanvasChangesButton,
	CreationInlineBtn,
	CustomBlockButton,
	RouteButton,
} from "./AiDirectives";
import { ResourceChip } from "./ResourceChip";
import { remarkDirectiveRehype } from "./remarkDirectiveRehype";

const CALLOUTS = {
	info: { label: "Info", className: "border-accent/40 bg-accent/5" },
	tip: { label: "Tip", className: "border-success/40 bg-success/5" },
	warning: { label: "Warning", className: "border-warning/40 bg-warning/5" },
	danger: { label: "Danger", className: "border-danger/40 bg-danger/5" },
};

/** `:::tip` / `:::info` / `:::warning` / `:::danger` blocks (VitePress containers). */
const calloutComponents = Object.fromEntries(
	Object.entries(CALLOUTS).map(([kind, { label, className }]) => [
		`ai-${kind}`,
		({ children }: { children?: React.ReactNode }) => {
			const titled = React.Children.toArray(children).some(
				(c) =>
					React.isValidElement<{ className?: string }>(c) &&
					c.props.className?.includes("fx-callout__title"),
			);
			return (
				<div className={`mb-3 rounded-md border-l-4 px-3 py-2 [&_p:last-child]:mb-0 ${className}`}>
					{!titled && <strong className="mb-1 block text-foreground">{label}</strong>}
					{children}
				</div>
			);
		},
	]),
);

interface MarkdownViewerProps {
	content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
	return (
		<div className="w-full text-left text-sm text-foreground/80 leading-relaxed">
			<ReactMarkdown
				remarkPlugins={[remarkGfm, remarkDirective, remarkDirectiveRehype]}
				components={
					{
						h1: ({ children }: any) => (
							<Typography.Heading level={1} className="text-2xl font-bold mb-4">
								{children}
							</Typography.Heading>
						),
						h2: ({ children }: any) => (
							<Typography.Heading level={2} className="text-xl font-bold mb-3">
								{children}
							</Typography.Heading>
						),
						h3: ({ children }: any) => (
							<Typography.Heading level={3} className="text-lg font-semibold mb-2">
								{children}
							</Typography.Heading>
						),
						h4: ({ children }: any) => (
							<Typography.Heading level={4} className="text-base font-semibold mb-2">
								{children}
							</Typography.Heading>
						),
						h5: ({ children }: any) => (
							<Typography.Heading level={5} className="text-sm font-semibold mb-1">
								{children}
							</Typography.Heading>
						),
						h6: ({ children }: any) => (
							<Typography.Heading
								level={6}
								className="text-sm font-semibold mb-1 text-foreground/80"
							>
								{children}
							</Typography.Heading>
						),
						p: ({ children }: any) => (
							<Typography.Paragraph className="mb-3 text-sm text-foreground/80">
								{children}
							</Typography.Paragraph>
						),
						ul: ({ children }: any) => (
							<ul className="list-disc ml-6 mb-3 text-sm text-foreground/80">{children}</ul>
						),
						ol: ({ children }: any) => (
							<ol className="list-decimal ml-6 mb-3 text-sm text-foreground/80">{children}</ol>
						),
						li: ({ children }: any) => <li className="mb-1 text-sm">{children}</li>,
						blockquote: ({ children }: any) => (
							<blockquote className="border-l-4 border-border pl-4 italic mb-3 text-muted">
								{children}
							</blockquote>
						),
						pre: ({ children }: any) => (
							<pre className="bg-surface-secondary border border-border p-4 rounded-xl mb-3 overflow-x-auto text-sm">
								{children}
							</pre>
						),
						code: ({ children, className }: any) => {
							const isInline = !className;
							if (isInline) {
								return (
									<Typography.Code className="bg-[var(--surface-secondary)] border border-[var(--border-secondary)] px-1.5 py-0.5 rounded-md">
										{children}
									</Typography.Code>
								);
							}
							return <code className={className}>{children}</code>;
						},
						table: ({ children }: any) => (
							<div className="mb-3">
								<Table>
									<Table.ScrollContainer>
										<Table.Content>{children}</Table.Content>
									</Table.ScrollContainer>
								</Table>
							</div>
						),
						thead: ({ children }: any) => {
							let cols = children;
							const elements = React.Children.toArray(children).filter(React.isValidElement);
							if (elements.length === 1) {
								// @ts-expect-error - props.children exists on elements
								cols = elements[0].props.children;
							}
							return <Table.Header>{cols}</Table.Header>;
						},
						tbody: ({ children }: any) => <Table.Body>{children}</Table.Body>,
						tr: ({ children }: any) => <Table.Row>{children}</Table.Row>,
						th: ({ children }: any) => <Table.Column>{children}</Table.Column>,
						td: ({ children }: any) => <Table.Cell>{children}</Table.Cell>,

						a: ({ children, href }: any) => (
							<a
								href={href}
								target="_blank"
								rel="noopener noreferrer"
								className="text-accent underline"
							>
								{children}
							</a>
						),
						...calloutComponents,
						"ai-u": ({ children }: any) => <u>{children}</u>,

						// AI Directives Mapping
						"ai-resource": (props: any) => <ResourceChip {...props} />,
						// An integration or config the plan needs is a resource like any
						// other — it just may not exist yet. The chip looks it up and
						// offers Create or Go to; the artifact sidebar has nothing to
						// show for something no sub-artifact ever produced.
						"ai-createintegration": (props: any) => (
							<ResourceChip type="integration" identifier="" name={props.label} />
						),
						"ai-createappconfig": (props: any) => (
							<ResourceChip type="app_config" identifier="" name={props.label} />
						),
						"ai-createroute": (props: any) => <CreationInlineBtn kind="Route" {...props} />,
						"ai-createcustomblock": (props: any) => (
							<CreationInlineBtn kind="Custom Block" {...props} />
						),
						"ai-route": (props: any) => <RouteButton {...props} />,
						"ai-customblock": (props: any) => <CustomBlockButton {...props} />,
						"ai-canvaschanges": (props: any) => <CanvasChangesButton {...props} />,
					} as any
				}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
