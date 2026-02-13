---
title: For Loop
description: Repeat actions a specific number of times.
---

# For Loop

The **For Loop** block runs a sequence of other blocks multiple times.

## Inputs

- **Start**: The number to start counting from (e.g., 0).
- **End**: The number to stop at.
- **Step**: How much to increase the count by each time (default is 1).
- **Block**: The block (or chain of blocks) to execute in each iteration.

## Logic

1.  The block starts a counter at **Start**.
2.  It checks if the counter is less than **End**.
3.  If true, it runs the **Block** you specified.
4.  It adds **Step** to the counter and repeats the check.
5.  This continues until the counter reaches **End**.
