import { Button, Chip, CloseButton, cn, Modal, Spinner } from "@fluxify/components";
import { type ReactNode, useState } from "react";
import { TbAlertTriangle, TbFileText, TbInfoCircle } from "react-icons/tb";
import { labelOf, MODE_COPY } from "@/components/settings/backup/labels";
import type { ArchiveSummary } from "@/services/projects";
import { formReady, type ProjectForm } from "./NewProjectForm";
import { RestoreOverview } from "./RestoreOverview";
import { RestoreReadme } from "./RestoreReadme";
import { iconOf, SectionBrowser } from "./SectionBrowser";

type Props = {
	/** "New project from a file" unless given */
	title?: string;
	/** the file's name, or the backup's key in a bucket */
	subtitle: string;
	/** shown above the new project's details, e.g. what happens to the subdomain */
	notice?: ReactNode;
	/** null while the file is being checked */
	summary: ArchiveSummary | null;
	/** why the server refused the file; nothing more can be done with it */
	refusal?: string;
	form: ProjectForm;
	onForm: (form: ProjectForm) => void;
	/** a restore that failed and can be retried, e.g. a slug already taken */
	error?: string;
	isRestoring: boolean;
	onCreate: () => void;
	onClose: () => void;
};

/**
 * A new project from a backup or template file (#1104), or from a backup in a
 * bucket (#1107): what the archive holds, a section at a time and read only,
 * beside the details the project gets.
 */
export function RestoreDialog(props: Props) {
	const { summary, refusal, isRestoring } = props;
	return (
		<Modal isOpen onOpenChange={(open) => !open && !isRestoring && props.onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[92vh] w-[94vw] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						<Modal.Header className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-5 py-3">
							<div className="min-w-0">
								<Modal.Heading className="text-sm font-semibold">
									{props.title ?? "New project from a file"}
								</Modal.Heading>
								<p className="truncate text-xs text-muted">{props.subtitle}</p>
							</div>
							{summary && (
								<div className="flex items-center gap-2">
									<Chip size="sm" color={summary.mode === "backup" ? "accent" : "default"}>
										{MODE_COPY[summary.mode].title}
									</Chip>
									{summary.encrypted && <Chip size="sm">Encrypted</Chip>}
								</div>
							)}
							<CloseButton aria-label="Close" className="ml-auto" isDisabled={isRestoring} />
						</Modal.Header>
						<Modal.Body className="min-h-0 flex-1 p-0">
							{refusal ? (
								<Refused message={refusal} />
							) : summary ? (
								<Browser {...props} summary={summary} />
							) : (
								<div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
									<Spinner size="sm" /> Checking the file…
								</div>
							)}
						</Modal.Body>
						<Footer {...props} />
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function Refused({ message }: { message: string }) {
	return (
		<div className="flex h-full items-center justify-center p-8">
			<div className="flex max-w-xl gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
				<TbAlertTriangle size={20} className="mt-0.5 shrink-0 text-danger" />
				<div>
					<p className="text-sm font-medium text-foreground">This file can't be restored here</p>
					<p role="alert" className="mt-1 text-sm text-danger">
						{message}
					</p>
				</div>
			</div>
		</div>
	);
}

/** the left nav, like Project Settings: the overview, the README, then one entry per section */
function Browser({
	summary,
	form,
	onForm,
	isRestoring,
	notice,
}: Props & { summary: ArchiveSummary }) {
	const [active, setActive] = useState("overview");
	const warningsIn = (section: string) =>
		summary.warnings.filter((w) => w.section === section).length;
	const entries = [
		{
			id: "overview",
			label: "Overview",
			icon: TbInfoCircle,
			count: summary.warnings.length,
			warn: true,
		},
		...(summary.readme?.trim()
			? [{ id: "readme", label: "README", icon: TbFileText, count: 0, warn: false }]
			: []),
		...summary.preview.map((p) => ({
			id: p.section,
			label: labelOf(p.section),
			icon: iconOf(p.section),
			count: p.items.length,
			warn: warningsIn(p.section) > 0,
		})),
	];
	const section = summary.preview.find((p) => p.section === active);
	const firstResource = summary.preview[0]?.section;
	return (
		<div className="flex h-full min-h-0">
			<nav
				aria-label="What the file holds"
				className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border py-4 pl-3 pr-2"
			>
				{entries.map((e) => (
					<div key={e.id}>
						{e.id === firstResource && (
							<div className="mb-1 mt-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted">
								Resources
							</div>
						)}
						<button
							type="button"
							aria-current={active === e.id ? "page" : undefined}
							onClick={() => setActive(e.id)}
							className={cn(
								"flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
								active === e.id
									? "bg-surface-secondary text-foreground"
									: "text-muted hover:bg-surface-secondary hover:text-foreground",
							)}
						>
							<span className="flex items-center gap-3">
								<e.icon size={18} />
								{e.label}
							</span>
							<span className="flex items-center gap-1">
								{e.id !== "overview" && e.id !== "readme" && e.warn && (
									<TbAlertTriangle size={14} className="text-warning" />
								)}
								{e.id !== "readme" && (e.id !== "overview" || e.count > 0) && (
									<span
										className={cn(
											"flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-medium",
											e.id === "overview"
												? "bg-warning/15 text-warning"
												: "bg-surface-secondary text-foreground",
										)}
									>
										{e.count}
									</span>
								)}
							</span>
						</button>
					</div>
				))}
			</nav>
			<div className="min-w-0 flex-1">
				{section ? (
					<SectionBrowser
						key={section.section}
						section={section}
						warnings={summary.warnings.filter((w) => w.section === section.section)}
					/>
				) : active === "readme" && summary.readme?.trim() ? (
					<RestoreReadme text={summary.readme} />
				) : (
					<RestoreOverview
						notice={notice}
						summary={summary}
						form={form}
						onForm={onForm}
						isRestoring={isRestoring}
						onOpenSection={setActive}
					/>
				)}
			</div>
		</div>
	);
}

function Footer({ summary, refusal, form, error, isRestoring, onCreate, onClose }: Props) {
	const ready = summary && !refusal;
	return (
		<Modal.Footer className="flex shrink-0 flex-row flex-wrap items-end gap-3 border-t border-border px-5 py-3">
			{ready && (
				<>
					<div className="min-w-0 flex-1 self-center text-xs">
						{error ? (
							<p role="alert" className="text-danger">
								{error}
							</p>
						) : isRestoring ? (
							<p className="text-muted">
								Restoring… A template that fetches web knowledge sources can take a few minutes.
							</p>
						) : (
							<p className="text-muted">
								Restoring always makes a new project; nothing existing is changed.
							</p>
						)}
					</div>
				</>
			)}
			<div className="ml-auto flex items-center gap-2">
				<Button variant="ghost" isDisabled={isRestoring} onPress={onClose}>
					{refusal ? "Close" : "Cancel"}
				</Button>
				{ready && (
					<Button
						variant="primary"
						isPending={isRestoring}
						isDisabled={!formReady(form)}
						onPress={onCreate}
					>
						{isRestoring ? "Restoring…" : "Create project"}
					</Button>
				)}
			</div>
		</Modal.Footer>
	);
}
