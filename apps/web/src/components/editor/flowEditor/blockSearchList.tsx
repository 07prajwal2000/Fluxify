"use client";
import { useEditorSearchbarStore } from "@/store/editor";
import { Box } from "@mantine/core";
import { useContext, useEffect, useMemo } from "react";
import SearchBlockItem from "./searchBlocktem";
import blocksForSearch, { categoryList } from "../blocks/searchList";
import { BlockCanvasContext } from "@/context/blockCanvas";
import { BlockTypes } from "@/types/block";

const BlockSearchList = () => {
  const {
    searchQuery,
    setSearchQuery,
    close: closeSearchbar,
    setCurrentIndex,
    currentIndex,
    opened,
  } = useEditorSearchbarStore();
  const inCategoryMode = searchQuery?.trim().length === 0;

  const { addBlock } = useContext(BlockCanvasContext);

  const filteredBlocks = useMemo(() => {
    return blocksForSearch.filter((block: any) => {
      if (searchQuery.startsWith("cat:")) {
        return block.category === searchQuery.slice(4);
      }
      return (
        block.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.tags.filter((tag: string) =>
          tag.toLowerCase().includes(searchQuery.toLowerCase()),
        ).length > 0
      );
    });
  }, [searchQuery]);

  useEffect(() => {
    if (opened) {
      document.addEventListener("keydown", handleKeyDownEvent);
    } else {
      document.removeEventListener("keydown", handleKeyDownEvent);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDownEvent);
    };
  }, [searchQuery, currentIndex, opened]);

  function handleKeyDownEvent(ev: KeyboardEvent) {
    if (!opened) return;
    if (ev.key === "Escape") closeSearchbar();
    let incrementor = 0;
    if (ev.key === "ArrowUp") {
      incrementor = -1;
    } else if (ev.key === "ArrowDown") {
      incrementor = 1;
    } else if (ev.key === "Enter") {
      if (inCategoryMode) {
        setSearchQuery(`cat:${categoryList[currentIndex].category}`);
      } else {
        addBlock(filteredBlocks[currentIndex].type);
        closeSearchbar();
      }
    }
    if (incrementor !== 0) {
      const max = inCategoryMode ? categoryList.length : filteredBlocks.length;
      let newIndex = currentIndex + incrementor;
      if (newIndex < 0) newIndex = max - 1;
      if (newIndex >= max) newIndex = 0;
      setCurrentIndex(newIndex);
    }
  }

  function onSearchItemClick(ev: {
    itemType: "block" | "category";
    value: string;
  }) {
    if (ev.itemType === "block") {
      addBlock(ev.value as BlockTypes);
      closeSearchbar();
    } else if (ev.itemType === "category") {
      setSearchQuery(`cat:${ev.value}`);
    }
  }

  return (
    <Box style={{ height: "100%" }}>
      <Box
        style={{
          height: "100%",
          display: inCategoryMode ? "block" : "none",
        }}
      >
        {categoryList.map((category: any, i: number) => (
          <SearchBlockItem
            active={currentIndex === i}
            key={category.id}
            id={category.id}
            itemType={"category"}
            category={category.category}
            title={category.category}
            description={category.description}
            icon={category.icon}
            showRightArrow
            onClick={onSearchItemClick}
          />
        ))}
      </Box>
      {!inCategoryMode &&
        filteredBlocks.map((block: any, i: number) => (
          <SearchBlockItem
            active={currentIndex === i}
            key={block.id}
            id={block.id}
            itemType={"block"}
            blockType={block.type}
            title={block.title}
            description={block.description}
            icon={block.icon}
            onClick={onSearchItemClick}
          />
        ))}
    </Box>
  );
};

export default BlockSearchList;
