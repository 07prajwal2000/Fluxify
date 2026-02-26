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
import { SiAnthropic, SiOpenai } from "react-icons/si";
import z from "zod";
import MemcachedIcon from "./icons/memcached";
import { TbBrandFirebase, TbBrandSupabase } from "react-icons/tb";
import { RiGeminiFill, RiOpenaiLine, RiRobot2Fill } from "react-icons/ri";
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
	OpenAI: <SiOpenai size={iconSize} style={iconStyles} />,
	Mistral: <RiRobot2Fill size={iconSize} style={iconStyles} />,
	Gemini: <RiGeminiFill size={iconSize} style={iconStyles} />,
	"Open Observe": <IoTelescope size={iconSize} style={iconStyles} />,
	Loki: <PiNotebookLight size={iconSize} style={iconStyles} />,
};
