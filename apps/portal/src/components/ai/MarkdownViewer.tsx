import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Typography, Table } from "@fluxify/components";

interface MarkdownViewerProps {
	content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
	return (
		<div className="w-full text-left text-sm text-foreground/80 leading-loose">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: ({ children }) => <Typography.Heading level={1} className="text-2xl font-bold mb-4">{children}</Typography.Heading>,
					h2: ({ children }) => <Typography.Heading level={2} className="text-xl font-bold mb-3">{children}</Typography.Heading>,
					h3: ({ children }) => <Typography.Heading level={3} className="text-lg font-semibold mb-2">{children}</Typography.Heading>,
					h4: ({ children }) => <Typography.Heading level={4} className="text-base font-semibold mb-2">{children}</Typography.Heading>,
					h5: ({ children }) => <Typography.Heading level={5} className="text-sm font-semibold mb-1">{children}</Typography.Heading>,
					h6: ({ children }) => <Typography.Heading level={6} className="text-sm font-semibold mb-1 text-foreground/80">{children}</Typography.Heading>,
					p: ({ children }) => <Typography.Paragraph className="mb-4">{children}</Typography.Paragraph>,
					ul: ({ children }) => <ul className="list-disc ml-6 mb-4">{children}</ul>,
					ol: ({ children }) => <ol className="list-decimal ml-6 mb-4">{children}</ol>,
					li: ({ children }) => <li className="mb-1">{children}</li>,
					blockquote: ({ children }) => (
						<blockquote className="border-l-4 border-white/20 pl-4 italic mb-4">
							{children}
						</blockquote>
					),
					pre: ({ children }) => (
						<pre className="bg-black/20 p-4 rounded-xl mb-4 overflow-x-auto text-sm">
							{children}
						</pre>
					),
					code: ({ children, className }) => {
						const isInline = !className;
						if (isInline) {
							return <Typography.Code className="bg-black/20 px-1.5 py-0.5 rounded-md">{children}</Typography.Code>;
						}
						return <code className={className}>{children}</code>;
					},
					table: ({ children }) => (
						<div className="mb-4">
							<Table>
								<Table.ScrollContainer>
									<Table.Content>{children}</Table.Content>
								</Table.ScrollContainer>
							</Table>
						</div>
					),
					thead: ({ children }) => {
						let cols = children;
						const elements = React.Children.toArray(children).filter(React.isValidElement);
						if (elements.length === 1) {
							// @ts-ignore - props.children exists on elements
							cols = elements[0].props.children;
						}
						return <Table.Header>{cols}</Table.Header>;
					},
					tbody: ({ children }) => <Table.Body>{children}</Table.Body>,
					tr: ({ children }) => <Table.Row>{children}</Table.Row>,
					th: ({ children }) => <Table.Column>{children}</Table.Column>,
					td: ({ children }) => <Table.Cell>{children}</Table.Cell>,
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
