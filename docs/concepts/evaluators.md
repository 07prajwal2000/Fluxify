---
title: Condition Evaluator
description: The logic engine behind decision making.
---

# Condition Evaluator

The **Condition Evaluator** is the brain behind the **If Condition** and **Filter** blocks. It determines whether a set of rules evaluates to `True` or `False`.

## Logic

It supports complex logic chains:
- **AND / OR**: Combine multiple conditions.
- **Operators**: a wide range of comparisons:
    - `Equals` (eq) / `Not Equals` (neq)
    - `Greater Than` (gt) / `Less Than` (lt)
    - `Is Empty` / `Is Not Empty`
    - `JS Expression`: Use custom JavaScript for complex checks.

## Recursive Evaluation
It can handle nested or dynamic values (like those starting with `js:`) by resolving them in the VM before making the comparison.
