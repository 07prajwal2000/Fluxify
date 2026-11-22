import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { TbBrandGit, TbFileUpload, TbPlus } from "react-icons/tb";
import { SplitButton } from "@/components/common/SplitButton";
import { projectsService } from "@/services/projects";
import { GitRestoreDialog } from "./GitRestoreDialog";
import { useRestoreFlow } from "./useRestoreFlow";

/** "New Project", with menu items that make one from a backup or template file (#1104) or from a git repository (#1152). */
export function NewProjectButton() {
	const navigate = useNavigate();
	const input = useRef<HTMLInputElement>(null);
	const flow = useRestoreFlow();
	const [fromGit, setFromGit] = useState(false);

	return (
		<>
			<SplitButton
				variant="primary"
				menuLabel="More ways to create a project"
				onPress={() => navigate({ to: "/projects/new" })}
				items={[
					{
						id: "from-file",
						label: "From backup or template file",
						icon: <TbFileUpload size={16} />,
						onAction: () => input.current?.click(),
					},
					{
						id: "from-git",
						label: "Restore from a git repository",
						icon: <TbBrandGit size={16} />,
						onAction: () => setFromGit(true),
					},
				]}
			>
				<TbPlus className="h-4 w-4" />
				New Project
			</SplitButton>
			<input
				ref={input}
				type="file"
				accept=".tar.gz,.tgz,application/gzip"
				aria-label="Backup or template file"
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					// the same file can be picked again after a cancel
					e.target.value = "";
					if (file)
						void flow.start({
							subtitle: file.name,
							inspect: () => projectsService.inspectArchive(file),
							restore: (form) => projectsService.restore(file, form),
						});
				}}
			/>
			{fromGit && (
				<GitRestoreDialog
					onClose={() => setFromGit(false)}
					onPick={(source) => {
						setFromGit(false);
						void flow.start(source);
					}}
				/>
			)}
			{flow.element}
		</>
	);
}
