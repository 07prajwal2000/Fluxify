import { Button } from "@fluxify/components";
import { useRef } from "react";
import { TbArrowBackUp } from "react-icons/tb";
import { useRestoreFlow } from "@/components/home/restore/useRestoreFlow";
import { backupsService } from "@/services/backups";

/**
 * Project settings > Backup > Roll back (#1130): this project, back to a backup
 * file, in place. The dialog shows what changes before anything does.
 */
export function RollbackUpload({ projectId }: { projectId: string }) {
	const input = useRef<HTMLInputElement>(null);
	const flow = useRestoreFlow();
	return (
		<section aria-label="Roll back" className="flex flex-col gap-3">
			<div>
				<h2 className="text-sm font-semibold text-foreground">Roll back</h2>
				<p className="text-sm text-muted">
					Put this project back the way a backup has it, keeping what still matches. It is backed up
					first, so the rollback can be undone.
				</p>
			</div>
			<div>
				<Button variant="secondary" onPress={() => input.current?.click()}>
					<TbArrowBackUp size={16} />
					Upload a backup to roll back
				</Button>
			</div>
			<input
				ref={input}
				type="file"
				accept=".tar.gz,.tgz,application/gzip"
				aria-label="Backup file to roll back to"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					// the same file can be picked again after a cancel
					e.target.value = "";
					if (file)
						void flow.start({
							kind: "rollback",
							title: "Roll back this project",
							subtitle: file.name,
							inspect: () => backupsService.inspectRollback(projectId, file),
							restore: (choice) => backupsService.rollback(projectId, file, choice),
						});
				}}
			/>
			{flow.element}
		</section>
	);
}
