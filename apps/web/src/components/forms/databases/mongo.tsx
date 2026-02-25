"use client";
import AppConfigSelector from "@/components/editors/appConfigSelector";
import { Button, ButtonGroup, Grid, Stack, TextInput } from "@mantine/core";
import { UseFormReturnType } from "@mantine/form";
import { useState } from "react";

type PropTypes = {
	form: UseFormReturnType<any>;
};

const MongoForm = (props: PropTypes) => {
	const form = props.form;
	const [tabSelected, setTabSelected] = useState(
		form.values.config.source === "url" ? "url" : "credentials",
	);
	const isUrlSelected = "url" === tabSelected;
	function selectUrl() {
		form.setFieldValue("config.source", "url");
		setTabSelected("url");
	}
	function selectCredentials() {
		form.setFieldValue("config.source", "credentials");
		setTabSelected("credentials");
	}

	return (
		<Stack>
			<TextInput
				label="Name"
				required
				value={form.values.name ?? ""}
				description="Unique Name for the integration"
				placeholder="My MongoDB Database"
				{...form.getInputProps("name")}
			/>
			<ButtonGroup bd={"1px solid violet"} bdrs={"md"} w={"100%"}>
				<Button
					variant={isUrlSelected ? "subtle" : "filled"}
					color="violet"
					fullWidth
					onClick={selectCredentials}
				>
					Credentials
				</Button>
				<Button
					onClick={selectUrl}
					variant={isUrlSelected ? "filled" : "subtle"}
					color="violet"
					fullWidth
				>
					Via URL
				</Button>
			</ButtonGroup>
			{!isUrlSelected && (
				<Grid>
					<Grid.Col span={6}>
						<AppConfigSelector
							value={form.values.config?.host ?? ""}
							onChange={(value) => form.setFieldValue("config.host", value)}
							label="Host"
							description="Database Host"
							placeholder="localhost"
						/>
					</Grid.Col>
					<Grid.Col span={6}>
						<AppConfigSelector
							value={form.values.config?.port?.toString() ?? ""}
							onChange={(value) => form.setFieldValue("config.port", value)}
							label="Port"
							description="Database Port (Default: 27017)"
							placeholder="27017"
						/>
					</Grid.Col>
					<Grid.Col span={6}>
						<AppConfigSelector
							value={form.values.config?.username?.toString() ?? ""}
							onChange={(value) => form.setFieldValue("config.username", value)}
							label="Username"
							placeholder="mongo_user"
						/>
					</Grid.Col>
					<Grid.Col span={6}>
						<AppConfigSelector
							value={form.values.config?.password?.toString() ?? ""}
							onChange={(value) => form.setFieldValue("config.password", value)}
							label="Password"
							placeholder="secret"
						/>
					</Grid.Col>
					<Grid.Col span={6}>
						<AppConfigSelector
							value={form.values.config?.database?.toString() ?? ""}
							onChange={(value) => form.setFieldValue("config.database", value)}
							label="Database Name"
							placeholder="mydatabase"
						/>
					</Grid.Col>
				</Grid>
			)}
			{isUrlSelected && (
				<AppConfigSelector
					value={form.values.config?.url ?? ""}
					onChange={(value) => form.setFieldValue("config.url", value)}
					label="URL"
					description="Connection String"
					placeholder="mongodb://user:pass@host:port/dbname"
				/>
			)}
		</Stack>
	);
};

export default MongoForm;
