import { Checkbox } from "@fluxify/components";

const DOCS_URL = "https://docs.fluxify.rest/testing/setup-and-teardown.html";

/** "Use only for test suite setup / teardown" (#483), shared by create and settings */
export function TestOnlyField({
	value,
	onChange,
	isDisabled,
}: {
	value: boolean;
	onChange: (next: boolean) => void;
	isDisabled?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Checkbox
				isDisabled={isDisabled}
				isSelected={value}
				onChange={onChange}
				label="Use only for test suite setup / teardown"
				description="Hidden from the block picker. It runs before or after a test suite, never in live routes or workflows."
			/>
			{/* outside the checkbox's label, so following the link never toggles it */}
			<a
				href={DOCS_URL}
				target="_blank"
				rel="noreferrer"
				className="ml-6 w-fit text-xs text-accent hover:underline"
			>
				What does this do?
			</a>
		</div>
	);
}
