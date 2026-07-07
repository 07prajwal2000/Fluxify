import {
	TextInput,
	Select,
	Switch,
	Title,
	Text,
	Stack,
	Alert,
	Box,
	Code,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import React, { useRef, useState, useMemo, useEffect } from "react";
import {
	OnboardingStepper,
	OnboardingStep,
} from "../stepper/OnboardingStepper";
import { SchemaEditor } from "../editors/schemaEditor/SchemaEditor";
import { SchemaPreview } from "../editors/schemaEditor/SchemaPreview";
import {
	ValidationSchema,
	SchemaEditorRef,
	DataType,
} from "@/types/schemaEditor";
import { TbInfoCircle } from "react-icons/tb";

export type RouteFormValues = {
	id?: string;
	name: string;
	path: string;
	method: string;
	active: boolean;
	projectId?: string;
	bodySchema?: ValidationSchema;
	querySchema?: ValidationSchema;
	paramsSchema?: ValidationSchema;
};

interface RouteFormStepperProps {
	initialValues?: Partial<RouteFormValues>;
	onSubmit: (values: RouteFormValues) => void;
	onCancel?: () => void;
	loading?: boolean;
	readOnly?: boolean;
}

export const RouteFormStepper: React.FC<RouteFormStepperProps> = ({
	initialValues,
	onSubmit,
	onCancel,
	loading,
	readOnly,
}) => {
	const [activeStep, setActiveStep] = useState(0);

	// Form for General Info
	const generalForm = useForm({
		mode: "uncontrolled",
		initialValues: {
			name: initialValues?.name || "",
			path: initialValues?.path || "",
			method: initialValues?.method || "GET",
			active: initialValues?.active ?? false,
		},
		validate: {
			name: (value) =>
				value.length < 2 ? "Name must have at least 2 letters" : null,
			path: (value) =>
				!value.startsWith("/") ? "Path must start with /" : null,
		},
	});

	// Extract variables from path to auto-generate paramsSchema
	const pathValue = generalForm.getValues().path;
	const pathParams = useMemo(() => {
		return Array.from(pathValue.matchAll(/:([a-zA-Z0-9_]+)/g)).map((m) => m[1]);
	}, [pathValue]);

	const hasBody = ["POST", "PUT"].includes(generalForm.getValues().method);
	const hasParams = pathParams.length > 0;

	// Refs for SchemaEditors to trigger save internally
	const bodySchemaRef = useRef<SchemaEditorRef>(null);
	const querySchemaRef = useRef<SchemaEditorRef>(null);
	const paramsSchemaRef = useRef<SchemaEditorRef>(null);

	const [bodySchema, setBodySchema] = useState<ValidationSchema | undefined>(
		initialValues?.bodySchema,
	);
	const [querySchema, setQuerySchema] = useState<ValidationSchema | undefined>(
		initialValues?.querySchema || { dataType: "object", properties: [] },
	);
	const [paramsSchema, setParamsSchema] = useState<
		ValidationSchema | undefined
	>(initialValues?.paramsSchema);
	const [generatedParamsSchema, setGeneratedParamsSchema] =
		useState<ValidationSchema | null>(null);

	const paramTypeOverrides = useMemo(() => {
		return pathParams.reduce(
			(acc, param) => {
				acc[param] = ["str", "int", "bool", "float"];
				return acc;
			},
			{} as Record<string, DataType[]>,
		);
	}, [pathParams]);

	// Initialize the params schema whenever path variables change
	useEffect(() => {
		if (initialValues?.paramsSchema) {
			setParamsSchema(initialValues.paramsSchema);
		} else {
			setGeneratedParamsSchema({
				dataType: "object",
				properties: pathParams.map((p) => ({
					key: p,
					dataType: "str",
					required: true,
				})),
			});
		}
	}, [pathParams, initialValues?.paramsSchema]);

	const handleStepChange = (step: number) => {
		// If going forward from a schema step, we want to save its state
		const currentStepDef = steps[activeStep];
		if (currentStepDef.label === "Body Validation") {
			bodySchemaRef.current?.save();
		} else if (currentStepDef.label === "Query Params Validation") {
			querySchemaRef.current?.save();
		} else if (currentStepDef.label === "Route Params Validation") {
			paramsSchemaRef.current?.save();
		}

		if (readOnly && step !== steps.length - 1) {
			// In readOnly mode, we can allow clicking steps if needed, but normally it's locked.
			// We will handle it by just letting them navigate if readOnly allows.
		}
		setActiveStep(step);
	};

	const submitForm = () => {
		// Before submitting from Summary step, ensure we get latest if needed, though they should be saved by step change.
		const values: RouteFormValues = {
			...generalForm.getValues(),
			id: initialValues?.id,
			projectId: initialValues?.projectId,
			bodySchema: hasBody ? bodySchema : undefined,
			querySchema,
			paramsSchema: hasParams ? paramsSchema : undefined,
		};
		onSubmit(values);
	};

	const steps: OnboardingStep[] = [
		{
			label: "General Info",
			description: "Basic route details",
			validate: () => {
				const validation = generalForm.validate();
				return !validation.hasErrors;
			},
			content: (
				<Stack gap="sm">
					<Title order={5}>Route Details</Title>
					<TextInput
						label="Name"
						placeholder="e.g. Create User"
						withAsterisk
						disabled={readOnly}
						{...generalForm.getInputProps("name")}
					/>
					<TextInput
						label="Path"
						placeholder="e.g. /api/users"
						withAsterisk
						disabled={readOnly}
						{...generalForm.getInputProps("path")}
					/>
					<Select
						label="Method"
						placeholder="GET"
						data={["GET", "POST", "PUT", "DELETE"]}
						disabled={readOnly}
						{...generalForm.getInputProps("method")}
					/>
					<Switch
						label="Active"
						disabled={readOnly}
						{...generalForm.getInputProps("active", { type: "checkbox" })}
					/>
				</Stack>
			),
		},
	];

	if (hasBody) {
		steps.push({
			label: "Body Validation",
			description: "Configure HTTP Body Schema",
			content: (
				<Stack gap="sm">
					<Title order={5}>Body Validation Schema</Title>
					<Alert icon={<TbInfoCircle />} color="violet">
						Define the payload structure expected in the HTTP request body.
					</Alert>
					<SchemaEditor
						key="bodySchema"
						ref={bodySchemaRef}
						initialData={bodySchema || { dataType: "object", properties: [] }}
						onSave={(data) => setBodySchema(data)}
					/>
				</Stack>
			),
		});
	}

	if (hasParams) {
		// Generate initial params schema if missing
		const generatedParamsSchema: ValidationSchema = paramsSchema || {
			dataType: "object",
			properties: pathParams.map((p) => ({
				key: p,
				dataType: "str",
				required: true,
			})),
		};

		steps.push({
			label: "Route Params Validation",
			description: "URL Path Parameters",
			content: (
				<Stack gap="sm">
					<Title order={5}>Route Parameters Schema</Title>
					<Alert icon={<TbInfoCircle />} color="violet">
						The following parameters were extracted from your path:{" "}
						<Code>{pathValue}</Code>. You can configure their validation rules
						below.
					</Alert>
					<SchemaEditor
						key="paramsSchema"
						ref={paramsSchemaRef}
						initialData={generatedParamsSchema}
						onSave={(data) => setParamsSchema(data)}
						// @ts-ignore
						locked={true}
						typeOverrides={paramTypeOverrides}
					/>
				</Stack>
			),
		});
	}

	steps.push({
		label: "Query Params Validation",
		description: "URL Query string",
		content: (
			<Stack gap="sm">
				<Title order={5}>Query Parameters Schema</Title>
				<Alert icon={<TbInfoCircle />} color="violet">
					Define any query string parameters this route expects (e.g.
					?page=1&sort=desc).
				</Alert>
				<SchemaEditor
					key="querySchema"
					ref={querySchemaRef}
					initialData={querySchema}
					onSave={(data) => setQuerySchema(data)}
					allowedRootSchemaTypes={['object']}
				/>
			</Stack>
		),
	});

	steps.push({
		label: "Summary",
		description: "Review and Submit",
		content: (
			<Stack gap="md">
				<Title order={4}>Review Route Configuration</Title>

				<Box>
					<Text fw={600} size="md" mb="xs">
						General Information
					</Text>
					<Stack gap="md">
						<TextInput
							label="Name"
							readOnly
							value={generalForm.getValues().name}
							variant="filled"
						/>
						<TextInput
							label="Path"
							readOnly
							value={generalForm.getValues().path}
							variant="filled"
						/>
						<TextInput
							label="Method"
							readOnly
							value={generalForm.getValues().method}
							variant="filled"
						/>
						<Switch
							label="Active"
							checked={generalForm.getValues().active}
							readOnly
						/>
					</Stack>
				</Box>

				{hasBody && bodySchema && (
					<Box>
						<Text fw={600} size="md" mb="xs">
							Body Validation Schema
						</Text>
						<SchemaPreview schema={bodySchema} />
					</Box>
				)}

				{hasParams && paramsSchema && (
					<Box>
						<Text fw={600} size="md" mb="xs">
							Route Params Schema
						</Text>
						<SchemaPreview schema={paramsSchema} />
					</Box>
				)}

				{querySchema &&
					querySchema.properties &&
					querySchema.properties.length > 0 && (
						<Box>
							<Text fw={600} size="md" mb="xs">
								Query Params Schema
							</Text>
							<SchemaPreview schema={querySchema} />
						</Box>
					)}
			</Stack>
		),
	});

	return (
		<OnboardingStepper
			steps={steps}
			activeStep={readOnly ? steps.length - 1 : activeStep}
			onStepChange={handleStepChange}
			onSubmit={submitForm}
			loading={loading}
			onCancel={onCancel}
			readOnly={readOnly}
		/>
	);
};
