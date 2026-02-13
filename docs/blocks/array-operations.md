---
title: Array Operations
description: Perform operations on a list of items.
---

# Array Operations

The **Array Operations** block lets you modify lists (arrays) of data. You can add items, remove them, or filter the list based on specific conditions.

## Inputs

- **Operation**: The action to perform:
    - `push`: Add an item to the end.
    - `pop`: Remove the last item.
    - `shift`: Remove the first item.
    - `unshift`: Add an item to the beginning.
    - `filter`: Keep only items that match a condition.
- **Datasource**: The name of the variable containing the list.
- **Value**: The item to add (for push/unshift).
- **Use Param As Input**: If checked, uses the output from the previous block as the value to add.
- **Filter Conditions**: (For filter operation) Rules to decide which items to keep.

## Logic

1.  The block gets the list from the **Datasource**.
2.  It performs the selected **Operation**.
3.  For `filter`, it checks each item against the **Filter Conditions**.
4.  The modified list is saved back to the **Datasource**.
5.  The updated list is also output by the block.
