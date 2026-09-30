import { Input, Label, TextArea, TextField } from "@fluxify/components";
import { useState } from "react";
import { FormWizard, SummaryItem } from "@/components/common/FormWizard";
import { blockIcon, type ChainBlock, ChainEditor } from "@/components/middlewares/ChainEditor";

export type MiddlewareValues = { name: string; description: string; chain: ChainBlock[] };

/**
 * The middleware form (#534), step by step. Create and edit are the same form,
 * so a middleware is edited the way it was made.
 */
export function MiddlewareWizard({
	projectId,
	title,
	description,
	initial,
	submitLabel,
	isPending,
	onBack,
	onSubmit,
}: {
	projectId: string;
	title: string;
	description: string;
	initial: MiddlewareValues;
	submitLabel: string;
	isPending: boolean;
	onBack: () => void;
	onSubmit: (values: MiddlewareValues) => void;
}) {
	const [name, setName] = useState(initial.name);
	const [text, setText] = useState(initial.description);
	const [chain, setChain] = useState(initial.chain);

	return (
		<FormWizard
			title={title}
			description={description}
			onBack={onBack}
			submitLabel={submitLabel}
			isPending={isPending}
			onSubmit={() => onSubmit({ name: name.trim(), description: text.trim(), chain })}
			steps={[
				{
					key: "basics",
					label: "Basics",
					title: "Name the middleware",
					description: "This name is what you pick from a route's settings.",
					isValid: name.trim().length > 0,
					content: (
						<div className="flex flex-col gap-5">
							<TextField isRequired value={name} onChange={setName} autoFocus>
								<Label>Name</Label>
								<Input placeholder="Require API key" />
							</TextField>
							<TextField value={text} onChange={setText}>
								<Label>Description</Label>
								<TextArea rows={3} placeholder="What this middleware does" />
							</TextField>
						</div>
					),
				},
				{
					key: "chain",
					label: "Chain",
					title: "Build the chain",
					description:
						"Blocks run top to bottom, each getting the previous one's output. A Response block ends the request.",
					content: (
						<div className="mx-auto w-full max-w-xl">
							<ChainEditor projectId={projectId} chain={chain} onChange={setChain} />
						</div>
					),
				},
				{
					key: "review",
					label: "Review",
					title: "Review",
					description: "Attach it to routes from a route's Settings → Middlewares.",
					content: (
						<div className="flex flex-col gap-4">
							<dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
								<SummaryItem label="Name" value={name} />
								<SummaryItem label="Description" value={text || "None"} />
							</dl>
							<div>
								<p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Chain</p>
								{chain.length === 0 ? (
									<p className="text-sm text-muted">Empty. It passes its input straight on.</p>
								) : (
									<ol className="flex flex-wrap items-center gap-2">
										{chain.map((b, i) => (
											<li
												key={b.id}
												className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
											>
												<span className="text-xs text-muted">{i + 1}</span>
												{blockIcon(b)}
												{b.label || b.name}
											</li>
										))}
									</ol>
								)}
							</div>
						</div>
					),
				},
			]}
		/>
	);
}
