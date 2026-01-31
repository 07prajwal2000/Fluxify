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
  const { selectedMenu } = useIntegrationState();
  const { setSelectedMenu } = useIntegrationActions();

  function handleClick(connector: IntegrationGroup) {
    setSelectedMenu(connector);
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
