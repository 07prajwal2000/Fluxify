import { Checkbox } from "@fluxify/components";
import { SummaryItem } from "@/components/common/FormWizard";
import { NoticeList } from "./TriggerNotices";

export type ReviewRow = { label: string; value: string; mono?: boolean };
/** A labelled block of rows; params are grouped by the step they were set in. */
export type ReviewSection = { title?: string; rows: ReviewRow[] };

/**
 * The wizard's last step: what will be saved, grouped, plus the switch that
 * turns it on and whatever the server last refused.
 */
export function TriggerReview({
	sections,
	active,
	onActiveChange,
	isEdit,
	isConnector,
	disabledReason,
	error,
	readOnly,
}: {
	sections: ReviewSection[];
	active: boolean;
	onActiveChange: (active: boolean) => void;
	isEdit: boolean;
	isConnector: boolean;
	disabledReason?: string | null;
	error: string | null;
	readOnly?: boolean;
}) {
	return (
		<div className="flex flex-col gap-5">
			<NoticeList
				status="danger"
				title="Fluxify turned this trigger off"
				items={isEdit && disabledReason && !active ? [disabledReason] : []}
			/>
			{sections.map((section) => (
				<div key={section.title ?? "summary"} className="flex flex-col gap-1.5">
					{section.title && (
						<h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
							{section.title}
						</h3>
					)}
					<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
						{section.rows.map((row) => (
							<SummaryItem key={`${section.title ?? ""}-${row.label}`} {...row} />
						))}
					</dl>
				</div>
			))}

			<Checkbox
				isSelected={active}
				onChange={onActiveChange}
				isDisabled={readOnly}
				label={isEdit ? "Trigger is active" : "Turn this trigger on now"}
				description={
					isConnector
						? "Turning it on checks the integration's credentials and the source with the broker first."
						: "An inactive trigger never fires, and neither does an active one with no workflow attached."
				}
			/>

			<NoticeList status="danger" title="Not saved" items={error ? [error] : []} />
		</div>
	);
}
