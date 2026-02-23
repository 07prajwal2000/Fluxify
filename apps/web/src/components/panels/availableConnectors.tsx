"use client";
import { Stack, Text } from "@mantine/core";
import { FaRobot, FaTableList } from "react-icons/fa6";
import { LuServerCrash } from "react-icons/lu";
import { TbDatabase, TbHeartRateMonitor } from "react-icons/tb";
import MenuItem from "../rootSidebar/menuItem";
import {
  IntegrationGroup,
  useIntegrationActions,
  useIntegrationState,
} from "@/store/integration";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const connectors = [
  {
    name: "Databases",
    icon: <TbDatabase size={20} />,
    type: "database" as IntegrationGroup,
  },
  {
    name: "KV",
    type: "kv" as IntegrationGroup,
    icon: <FaTableList size={20} />,
  },
  {
    name: "AI",
    type: "ai" as IntegrationGroup,
    icon: <FaRobot size={20} />,
  },
  {
    name: "BaaS",
    type: "baas" as IntegrationGroup,
    icon: <LuServerCrash size={20} />,
  },
  {
    name: "Observability",
    type: "observability" as IntegrationGroup,
    icon: <TbHeartRateMonitor size={20} />,
  },
];

const AvailableConnectors = () => {
  const searchParams = useSearchParams();
  const group = searchParams.get("group");
  const router = useRouter();

  const { selectedMenu } = useIntegrationState();
  const { setSelectedMenu } = useIntegrationActions();

  useEffect(() => {
    if (group) {
      setSelectedMenu(group as IntegrationGroup);
    }
    router.push(`?group=${group || "database"}`);
  }, [group]);

  function handleClick(connector: IntegrationGroup) {
    setSelectedMenu(connector);
    router.push(`?group=${connector}`);
  }

  return (
    <Stack p={"xs"} bg={"gray.1"} w={"100%"} h={"100%"} gap={"4"}>
      {connectors.map((connector, index) => {
        return (
          <MenuItem
            isActive={selectedMenu === connector.type}
            color="dark"
            onClick={() => handleClick(connector.type)}
            text={<Text fw={"500"}>{connector.name}</Text>}
            leftIcon={connector.icon}
            key={index}
          />
        );
      })}
    </Stack>
  );
};

export default AvailableConnectors;
