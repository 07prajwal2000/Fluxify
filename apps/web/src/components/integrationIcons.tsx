import {
	aiVariantSchema,
	baasVariantSchema,
	databaseVariantSchema,
	kvVariantSchema,
	observabilityVariantSchema,
} from "@fluxify/server/src/api/v1/integrations/schemas";
import React from "react";
import { BiLogoPostgresql, BiLogoMongodb } from "react-icons/bi";
import { DiRedis, DiMysql } from "react-icons/di";
import { SiAnthropic } from "react-icons/si";
import z from "zod";
import MemcachedIcon from "./icons/memcached";
import { TbBrandFirebase, TbBrandSupabase } from "react-icons/tb";
import { RiGeminiFill, RiOpenaiLine, RiRobot2Fill, RiOpenaiFill } from "react-icons/ri";
import { IoTelescope } from "react-icons/io5";
import { PiNotebookLight } from "react-icons/pi";

export type IntegrationVariants =
	| z.infer<typeof databaseVariantSchema>
	| z.infer<typeof kvVariantSchema>
	| z.infer<typeof aiVariantSchema>
	| z.infer<typeof observabilityVariantSchema>
	| z.infer<typeof baasVariantSchema>;

type IntegrationIcons = Record<IntegrationVariants, React.ReactNode>;

const iconSize = 20;
const iconStyles: React.CSSProperties = {};
export const integrationIcons: IntegrationIcons = {
	PostgreSQL: <BiLogoPostgresql size={iconSize} style={iconStyles} />,
	MongoDB: <BiLogoMongodb size={iconSize} style={iconStyles} />,
	MySQL: <DiMysql size={iconSize} style={iconStyles} />,
	Redis: <DiRedis size={iconSize} style={iconStyles} />,
	Memcached: <MemcachedIcon />,
	Supabase: <TbBrandSupabase size={iconSize} style={iconStyles} />,
	Firebase: <TbBrandFirebase size={iconSize} style={iconStyles} />,
	"OpenAI Compatible": <RiOpenaiLine size={iconSize} style={iconStyles} />,
	Anthropic: <SiAnthropic size={iconSize} style={iconStyles} />,
	OpenAI: <RiOpenaiFill size={iconSize} style={iconStyles} />,
	Mistral: <RiRobot2Fill size={iconSize} style={iconStyles} />,
	Gemini: <RiGeminiFill size={iconSize} style={iconStyles} />,
	"Open Telemetry": (
		<div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
			<svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStyles}>
				{/* OTel Logo approximation (telescope/node graph) + logs */}
				<path d="M4 22h14a2 2 0 0 0 2-2V7.5L14.5 2H6a2 2 0 0 0-2 2v4" />
				<polyline points="14 2 14 8 20 8" />
				<path d="M16 13H8" />
				<path d="M16 17H8" />
				<path d="M10 9H8" />
				<circle cx="5" cy="14" r="2" />
				<path d="M5 16v4" />
			</svg>
		</div>
	),
	Loki: <PiNotebookLight size={iconSize} style={iconStyles} />,
};
