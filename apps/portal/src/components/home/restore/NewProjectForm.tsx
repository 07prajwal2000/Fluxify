import { Input, Label, TextArea, TextField } from "@fluxify/components";
import { Section } from "@/components/common/Section";
import { SubdomainField, subdomainError } from "@/components/settings/SubdomainField";

/** what the new project is given; subdomain and description may be empty */
export type ProjectForm = { name: string; slug: string; description: string; subdomain: string };

export const EMPTY_FORM: ProjectForm = { name: "", slug: "", description: "", subdomain: "" };

/** what enables the dialog's Create button */
export const formReady = (f: ProjectForm) =>
	f.name.trim().length >= 2 && !subdomainError(f.subdomain);

/** The new project's own details. They win over whatever the file holds, a subdomain included. */
export function NewProjectForm({
	form,
	onForm,
	isDisabled,
}: {
	form: ProjectForm;
	onForm: (form: ProjectForm) => void;
	isDisabled: boolean;
}) {
	const set = (patch: Partial<ProjectForm>) => onForm({ ...form, ...patch });
	return (
		<Section
			title="New project"
			description="What the restored project is called and where it is served. The file's own subdomain is replaced by the one below."
		>
			<fieldset disabled={isDisabled} className="flex flex-col gap-4">
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<TextField value={form.name} onChange={(name) => set({ name })} isDisabled={isDisabled}>
						<Label>Project name</Label>
						<Input maxLength={50} />
					</TextField>
					<TextField value={form.slug} onChange={(slug) => set({ slug })} isDisabled={isDisabled}>
						<Label>Slug</Label>
						<Input className="font-mono" />
					</TextField>
				</div>
				<SubdomainField value={form.subdomain} onChange={(subdomain) => set({ subdomain })} />
				<TextField
					value={form.description}
					onChange={(description) => set({ description })}
					isDisabled={isDisabled}
				>
					<Label>Description</Label>
					<TextArea rows={3} placeholder="What this project is for" maxLength={1000} />
				</TextField>
			</fieldset>
		</Section>
	);
}
