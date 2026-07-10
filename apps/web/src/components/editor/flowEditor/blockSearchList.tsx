"use client";
import { useEditorSearchbarStore } from "@/store/editor";
import { Box } from "@mantine/core";
import { useContext, useEffect, useMemo } from "react";
import SearchBlockItem from "./searchBlocktem";
import blocksForSearch, { categoryList } from "../blocks/searchList";
import { BlockCanvasContext } from "@/context/blockCanvas";
import { BlockTypes } from "@/types/block";
import { customBlocksQueries } from "@/query/customBlocksQuery";
import { useFlowEditorContext } from "./flowEditorContext";
import { getCustomBlockIcon } from "../blocks/customBlockNode";
import { TbCodeVariable } from "react-icons/tb";

const BlockSearchList = () => {
  const { projectId } = useFlowEditorContext();
  const { data: customBlocks } = customBlocksQueries.getAll.useQuery({
    projectId: projectId!,
  });

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

  const allCategories = useMemo(() => {
    const categories = [...categoryList];
    const newCategoriesMap: Record<string, boolean> = {};

    if (customBlocks) {
      customBlocks.forEach((cb) => {
        let cat = cb.sourceType === "inhouse" ? "User Defined" : cb.source || "Plugin";
        if (!categories.find((c) => c.category === cat) && !newCategoriesMap[cat]) {
          newCategoriesMap[cat] = true;
          categories.push({
            id: crypto.randomUUID(),
            category: cat as any,
            description: `Blocks from ${cat}`,
            icon: <TbCodeVariable size={20} />,
          });
        }
      });
    }
    return categories;
  }, [customBlocks]);

  const allBlocks = useMemo(() => {
    const blocks = [...blocksForSearch];
    if (customBlocks) {
      customBlocks.forEach((cb) => {
        let cat = cb.sourceType === "inhouse" ? "User Defined" : cb.source || "Plugin";
        blocks.push({
          id: cb.id,
          title: cb.label || cb.name,
          description: cb.description || `Custom block: ${cb.name}`,
          icon: getCustomBlockIcon(cb.icon || undefined, cb.iconUrl || undefined, 20) as any,
          tags: ["custom", cb.name],
          type: cb.name as BlockTypes,
          category: cat as any,
        });
      });
    }
    return blocks;
  }, [customBlocks]);

  const filteredBlocks = useMemo(() => {
    return allBlocks.filter((block: any) => {
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
  }, [searchQuery, allBlocks]);

  useEffect(() => {
    if (opened) {
      document.addEventListener("keydown", handleKeyDownEvent);
    } else {
      document.removeEventListener("keydown", handleKeyDownEvent);
    }

    return () => {
      document.removeEventListener("keydown", handleKeyDownEvent);
    };
  }, [searchQuery, currentIndex, opened, allCategories, filteredBlocks]);

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
        setSearchQuery(`cat:${allCategories[currentIndex].category}`);
      } else {
        addBlock(filteredBlocks[currentIndex].type);
        closeSearchbar();
      }
    }
    if (incrementor !== 0) {
      const max = inCategoryMode ? allCategories.length : filteredBlocks.length;
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
        {allCategories.map((category: any, i: number) => (
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
