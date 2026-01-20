"use client";
import { ActionIcon, Menu, Tooltip } from "@mantine/core";
import { usePathname, useRouter } from "next/navigation";
import React from "react";
import {
  TbDots,
  TbDownload,
  TbFileImport,
  TbGitCommit,
  TbSettings,
} from "react-icons/tb";

const TopbarEditorMoreOptions = () => {
  const router = useRouter();
  const path = usePathname();
  function onSettingsClick() {
    router.push(path + "/settings");
  }
  function onCommitClick() {}
  function onDownloadClick() {}
  function onImportClick() {}

  return (
    <Menu shadow="lg">
      <Menu.Target>
        <Tooltip withArrow label="More Options" color="dark">
          <ActionIcon variant="subtle" color="dark">
            <TbDots size={20} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<TbSettings size={18} />}
          onClick={onSettingsClick}
        >
          Settings
        </Menu.Item>
        <Menu.Item
          leftSection={<TbGitCommit size={18} />}
          onClick={onCommitClick}
        >
          Commit to Version History
        </Menu.Item>
        <Menu.Item
          leftSection={<TbDownload size={18} />}
          onClick={onDownloadClick}
        >
          Download
        </Menu.Item>
        <Menu.Item
          leftSection={<TbFileImport size={18} />}
          onClick={onImportClick}
        >
          Import
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};

export default TopbarEditorMoreOptions;
