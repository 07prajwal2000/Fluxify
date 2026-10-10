import {
	Button,
	Checkbox,
	CloseButton,
	CustomSelect,
	Input,
	Label,
	Modal,
	TextField,
	toast,
} from "@fluxify/components";
import { useState } from "react";
import { TbAlertTriangle, TbBraces, TbPlus } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { appConfigQuery } from "@/query/appConfigQuery";

const ENCODINGS = ["plaintext", "base64", "hex"] as const;
const DATA_TYPES = ["string", "number", "boolean"] as const;
const ENCODING_LABELS: Record<(typeof ENCODINGS)[number], string> = {
	plaintext: "Plain text",
	base64: "Base64",
	hex: "Hexadecimal",
};

/**
 * The "New key" button and its dialog. Callers that already have their own
 * trigger — the AI chips offer to create a key the plan referenced — drive it
 * with `isOpen`/`onOpenChange` instead, and can seed the key name.
 */
export function CreateConfigButton({
	projectId,
	isOpen,
	onOpenChange,
	initialKeyName = "",
}: {
	projectId: string;
	isOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	initialKeyName?: string;
}) {
	const create = appConfigQuery.create.mutation(projectId);
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const controlled = isOpen !== undefined;
	const open = controlled ? isOpen : uncontrolledOpen;
	const setOpen = (next: boolean) => {
		if (!controlled) setUncontrolledOpen(next);
		onOpenChange?.(next);
	};
	const [keyName, setKeyName] = useState(initialKeyName);
	const [description, setDescription] = useState("");
	const [value, setValue] = useState("");
	const [booleanValue, setBooleanValue] = useState(false);
	const [devValue, setDevValue] = useState("");
	const [devBooleanValue, setDevBooleanValue] = useState<boolean | null>(null);
	const [syncDev, setSyncDev] = useState(false);
	const [dataType, setDataType] = useState<(typeof DATA_TYPES)[number]>("string");
	const [isEncrypted, setIsEncrypted] = useState(false);
	const [encoding, setEncoding] = useState<(typeof ENCODINGS)[number]>("plaintext");

	function reset() {
		setKeyName(initialKeyName);
		setDescription("");
		setValue("");
		setBooleanValue(false);
		setDevValue("");
		setDevBooleanValue(null);
		setSyncDev(false);
		setDataType("string");
		setIsEncrypted(false);
		setEncoding("plaintext");
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		const finalValue = dataType === "boolean" ? String(booleanValue) : String(value);
		let finalDevValue: string | null = null;
		if (!syncDev) {
			if (dataType === "boolean") {
				finalDevValue = devBooleanValue !== null ? String(devBooleanValue) : null;
			} else {
				finalDevValue = devValue.trim() !== "" ? devValue : null;
			}
		}

		create.mutate(
			{
				keyName,
				description,
				value: finalValue,
				devValue: syncDev ? null : finalDevValue,
				syncDev,
				isEncrypted,
				encodingType: encoding,
				dataType,
			},
			{
				onSuccess: () => {
					toast.success("Config created");
					reset();
					setOpen(false);
				},
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	const devEmpty = dataType === "boolean" ? devBooleanValue === null : devValue.trim() === "";

	return (
		<Modal isOpen={open} onOpenChange={setOpen}>
			{!controlled && (
				<Modal.Trigger>
					<Button variant="primary">
						<TbPlus size={16} /> New key
					</Button>
				</Modal.Trigger>
			)}
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>Add a config key</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<form onSubmit={submit}>
							<Modal.Body>
								<div className="flex flex-col gap-4 pt-2">
									<div className="flex flex-col gap-1">
										<TextField isRequired value={keyName} onChange={setKeyName}>
											<Label>Key name</Label>
											<Input placeholder="API_TIMEOUT" className="font-mono" />
										</TextField>
										<p className="text-xs text-muted mt-1">
											Use a stable, descriptive name because it cannot be changed after creation.
										</p>
									</div>

									<div className="grid grid-cols-2 gap-4 mt-2">
										<CustomSelect
											label={
												<div className="flex items-center gap-1.5 text-sm font-medium text-muted">
													<TbBraces size={16} /> Data type
												</div>
											}
											options={DATA_TYPES.map((dt) => ({
												value: dt,
												label: dt[0].toUpperCase() + dt.slice(1),
											}))}
											value={dataType}
											onChange={(dt) => {
												setDataType(dt as any);
												if (dt === "boolean") {
													setBooleanValue(false);
													setDevBooleanValue(null);
												} else {
													setValue("");
													setDevValue("");
												}
											}}
										/>

										<CustomSelect
											label={<span className="text-sm font-medium text-muted">Encoding</span>}
											options={ENCODINGS.map((enc) => ({
												value: enc,
												label: ENCODING_LABELS[enc],
											}))}
											value={encoding}
											onChange={(enc) => setEncoding(enc as any)}
										/>
									</div>

									{dataType === "boolean" ? (
										<div className="flex flex-col gap-1 mt-2">
											<Label className="text-sm font-medium text-foreground">
												Production value
											</Label>
											<div className="rounded-lg border border-border p-2 bg-surface">
												<Checkbox isSelected={booleanValue} onChange={setBooleanValue}>
													<Checkbox.Content>
														<Checkbox.Control>
															<Checkbox.Indicator />
														</Checkbox.Control>
														<Label>Boolean Value: {booleanValue ? "True" : "False"}</Label>
													</Checkbox.Content>
												</Checkbox>
											</div>
										</div>
									) : (
										<div className="mt-2">
											<TextField isRequired value={value} onChange={setValue}>
												<Label>Production value</Label>
												<Input
													type={dataType === "number" ? "number" : "text"}
													placeholder={dataType === "number" ? "3000" : "Value"}
													className="font-mono"
												/>
											</TextField>
										</div>
									)}

									<div className="flex flex-col gap-3 mt-2 rounded-lg border border-border p-3 bg-surface">
										<Checkbox
											isSelected={syncDev}
											onChange={setSyncDev}
											aria-label="Same as production"
										>
											<Checkbox.Content>
												<Checkbox.Control>
													<Checkbox.Indicator />
												</Checkbox.Control>
												<Label className="text-sm font-medium text-foreground cursor-pointer">
													Same as production
												</Label>
											</Checkbox.Content>
										</Checkbox>

										{syncDev ? (
											<div
												role="alert"
												className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-danger"
											>
												<div className="flex items-start gap-3">
													<TbAlertTriangle size={20} className="shrink-0 mt-0.5 text-danger" />
													<div className="text-sm">
														<p className="font-semibold text-danger">Same as production</p>
														<p className="mt-1 text-xs text-danger/90">
															Dev runs, dev triggers and AI agents will read and write production —
															same database, same queues, same consumer groups. Use separate dev
															instances instead.
														</p>
													</div>
												</div>
											</div>
										) : (
											<div className="flex flex-col gap-2 pt-1">
												{devEmpty && (
													<p className="text-xs text-warning">
														Dev workers will fail until you set a development value or turn on Same
														as production.
													</p>
												)}
												{dataType === "boolean" ? (
													<CustomSelect
														label={
															<span className="text-sm font-medium text-foreground">
																Development value
															</span>
														}
														options={[
															{ value: "", label: "Unset" },
															{ value: "true", label: "True" },
															{ value: "false", label: "False" },
														]}
														value={
															devBooleanValue === null ? "" : devBooleanValue ? "true" : "false"
														}
														onChange={(v) => {
															if (v === "") setDevBooleanValue(null);
															else setDevBooleanValue(v === "true");
														}}
													/>
												) : (
													<TextField value={devValue} onChange={setDevValue}>
														<Label>Development value</Label>
														<Input
															type={dataType === "number" ? "number" : "text"}
															placeholder={dataType === "number" ? "3000" : "Development value"}
															className="font-mono"
														/>
													</TextField>
												)}
											</div>
										)}
									</div>

									<div className="mt-2">
										<TextField value={description} onChange={setDescription}>
											<Label>Description</Label>
											<Input placeholder="What this key controls" />
										</TextField>
									</div>

									<div className="mt-2 rounded-lg border border-border p-3 bg-surface">
										<Checkbox isSelected={isEncrypted} onChange={setIsEncrypted}>
											<Checkbox.Content>
												<Checkbox.Control>
													<Checkbox.Indicator />
												</Checkbox.Control>
												<Label>Encrypt this value in storage</Label>
											</Checkbox.Content>
										</Checkbox>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isPending={create.isPending}>
									Add key
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
