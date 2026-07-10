import { BlockCanvasContext } from "@/context/blockCanvas";
import { useEditorSearchbarStore } from "@/store/editor";
import { BlockCategory, BlockTypes } from "@/types/block";
import { Box, Center, Flex, Grid, Paper, Text } from "@mantine/core";
import { useHover } from "@mantine/hooks";
import React, { useContext, useEffect, useRef } from "react";
import { TbArrowNarrowRight, TbCodeVariable } from "react-icons/tb";

type OnClickParams = {
  itemType: "block" | "category";
  value: string;
};

type Props = {
  id: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  active?: boolean;
  showRightArrow?: boolean;
  onClick?: (params: OnClickParams) => void;
  itemType: "block" | "category";
  blockType?: BlockTypes;
  category?: BlockCategory;
};

const SearchBlockItem = (props: Props) => {
  const activeElement = useRef<HTMLDivElement>(null);
  const { ref, hovered } = useHover<HTMLDivElement>();

  useEffect(() => {
    if (!props.active || !activeElement.current) return;
    scrollIntoViewIfNotVisible(activeElement.current);
  }, [props.active]);

  function scrollIntoViewIfNotVisible(target: HTMLDivElement) {
    if (target.getBoundingClientRect().bottom > window.innerHeight) {
      target.scrollIntoView(false);
    }

    if (target.getBoundingClientRect().top < 0) {
      target.scrollIntoView(true);
    }
  }

  function onClick() {
    props.onClick &&
      props.onClick({
        itemType: props.itemType,
        value: props.blockType || props.category || "",
      });
  }

  const hoveredBg = hovered ? "gray.0" : "white";
  const activeBg = props.active ? "violet.0" : hoveredBg;

  return (
    <Paper
      onClick={onClick}
      autoFocus={props.active}
      ref={ref}
      p={"xs"}
      pos={"relative"}
      style={{
        cursor: "pointer",
      }}
      bg={activeBg}
    >
      <Box
        ref={activeElement}
        pos={"absolute"}
        top={0}
        bottom={0}
        display={props.active || hovered ? "block" : "none"}
        left={0}
        p={1}
        bg={props.active ? "violet" : hovered ? "gray.5" : "transparent"}
      />
      <Grid>
        <Grid.Col span={2}>
          <Center my={"auto"} h={"100%"} p={4} c={"dark"}>
            {props.icon || <TbCodeVariable size={20} />}
          </Center>
        </Grid.Col>
        <Grid.Col span={9}>
          <Flex direction={"column"}>
            <Text>{props.title}</Text>
            <Text c={"gray"} size={"xs"}>
              {props.description}
            </Text>
          </Flex>
        </Grid.Col>
        <Grid.Col span={1} h={"100%"} c="dark">
          <Center my={"auto"} h={"100%"} w={"100%"}>
            {props.showRightArrow && <TbArrowNarrowRight size={30} />}
          </Center>
        </Grid.Col>
      </Grid>
    </Paper>
  );
};

export default SearchBlockItem;
