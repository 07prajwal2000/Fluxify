import { Paper, Text, useMantineTheme } from "@mantine/core";
import React from "react";

type Proptypes = {
	method: "GET" | "POST" | "PUT" | "DELETE";
	small?: boolean;
};

const HttpMethodText = (props: Proptypes) => {
	const { blue, green, grape, red } = useMantineTheme().colors;
	let color = blue[8];
	if (props.method === "POST") color = green[8];
	else if (props.method === "PUT") color = grape[8];
	else if (props.method === "DELETE") color = red[8];

	return (
		<Paper
			shadow="xs"
			w={"fit-content"}
			withBorder
			c={"white"}
			bg={color}
			ta={"center"}
			p={props.small ? "2px 6px" : "xs"}
		>
			<Text fw={"600"} size={props.small ? "10px" : "xs"}>
				{props.method}
			</Text>
		</Paper>
	);
};

export default HttpMethodText;
