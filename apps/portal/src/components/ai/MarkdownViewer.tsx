import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownViewerProps {
	content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
	return (
		<div className="w-full text-left [&>p]:mb-4 [&>h1]:text-2xl [&>h1]:font-bold [&>h1]:mb-4 [&>h2]:text-xl [&>h2]:font-bold [&>h2]:mb-3 [&>h3]:text-lg [&>h3]:font-semibold [&>h3]:mb-2 [&>ul]:list-disc [&>ul]:ml-6 [&>ul]:mb-4 [&>ol]:list-decimal [&>ol]:ml-6 [&>ol]:mb-4 [&>li]:mb-1 [&>pre]:bg-black/20 [&>pre]:p-4 [&>pre]:rounded-xl [&>pre]:mb-4 [&>pre]:overflow-x-auto [&>code]:bg-black/20 [&>code]:px-1.5 [&>code]:py-0.5 [&>code]:rounded-md [&>blockquote]:border-l-4 [&>blockquote]:border-white/20 [&>blockquote]:pl-4 [&>blockquote]:italic [&>blockquote]:mb-4 text-foreground/90 leading-relaxed">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>
				{content}
			</ReactMarkdown>
		</div>
	);
}
