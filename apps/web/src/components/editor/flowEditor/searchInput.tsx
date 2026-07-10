import DebouncedTextInput from "@/components/editors/debouncedTextInput";
import { useEditorSearchbarStore } from "@/store/editor";
import { ActionIcon } from "@mantine/core";
import React, { forwardRef } from "react";
import { TbSearch, TbX } from "react-icons/tb";

const SearchInput = forwardRef<HTMLInputElement>((props, ref) => {
  const { searchQuery, setSearchQuery } = useEditorSearchbarStore();

  function resetSearch() {
    setSearchQuery("");
  }

  return (
    <DebouncedTextInput
      value={searchQuery}
      placeholder="Search blocks..."
      size="md"
      ref={ref}
      onValueChange={setSearchQuery}
      debounceDelay={300}
      leftSection={<TbSearch size={16} />}
      rightSection={
        <ActionIcon
          display={searchQuery ? "block" : "none"}
          variant="transparent"
          color="dark"
          onClick={resetSearch}
        >
          <TbX size={12} />
        </ActionIcon>
      }
    />
  );
});

export default SearchInput;
