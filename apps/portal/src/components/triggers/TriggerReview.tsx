import { Checkbox } from "@fluxify/components";
import { SummaryItem } from "@/components/common/FormWizard";
import { NoticeList } from "./TriggerNotices";

export type ReviewRow = { label: string; value: string; mono?: boolean };
/** A labelled block of rows; params are grouped by the step they were set in. */
export type ReviewSection = { title?: string; rows: ReviewRow[] };

/** A trigger's two switches (#1072): `active` is production, `devActive` development. */
export type TriggerSwitchState = { active: boolean; devActive: boolean };

/**
 * The wizard's last step: what will be saved, grouped, plus a switch per
 * environment and whatever the server last refused.
 */
export function TriggerReview({
	sections,
	switches,
	onSwitchesChange,
	isEdit,
	isConnector,
	disabledReason,
	error,
	readOnly,
}: {
	sections: ReviewSection[];
	switches: TriggerSwitchState;
	onSwitchesChange: (switches: TriggerSwitchState) => void;
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
				items={
					isEdit && disabledReason && !switches.active && !switches.devActive
						? [disabledReason]
						: []
				}
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

			<div className="flex flex-col gap-3">
				<Checkbox
					isSelected={switches.active}
					onChange={(active) => onSwitchesChange({ ...switches, active })}
					isDisabled={readOnly}
					label="On in production"
					description="Fires on production workers, once its workflow has a promoted version."
				/>
				<Checkbox
					isSelected={switches.devActive}
					onChange={(devActive) => onSwitchesChange({ ...switches, devActive })}
					isDisabled={readOnly}
					label="On in development"
					description="Fires on development workers, with development values."
				/>
				<p className="text-xs text-muted">
					{isConnector
						? "Turning it on checks the integration's credentials and the source with the broker first."
						: "A trigger that is off never fires, and neither does one with no workflow attached."}
				</p>
			</div>

			<NoticeList status="danger" title="Not saved" items={error ? [error] : []} />
		</div>
	);
}
