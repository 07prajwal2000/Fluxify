---
title: An AI-built route looked fine in the editor and failed on the first request
date: 2026-08-11
author: Prajwal Aradhya
tags:
  - engineering
  - ai
  - reliability
---

# An AI-built route looked fine in the editor and failed on the first request

Fluxify's AI assistant builds routes by placing and wiring blocks on a canvas — the same canvas you'd build by hand. Every so often, a route the assistant built would open perfectly in the editor and then blow up the moment it actually ran. We tracked it down to a naming mismatch that had been sitting there long enough to file down its own paper trail, and fixing it properly meant closing the hole in two different places, not one.

## The mismatch

The assistant refers to blocks by AI-friendly names: `get_http_header`, `if_condition`, `get_single`. Storage refers to the same blocks by shorter internal names: `httpgetheader`, `if`, `db_getsingle`. Something in between was supposed to translate one into the other, but it only normalized casing and underscores — it never actually mapped the AI's vocabulary onto storage's vocabulary. Any block name that didn't survive that light touch-up got written to the canvas exactly as the assistant typed it.

The canvas looked complete and correctly wired. It just contained block types that don't exist. The part meant to catch this before it shipped was keyed off the same two mismatched name lists, so it waved the bad blocks through instead of catching them. The route only failed once something tried to actually run it — by which point the person looking at it had no reason to suspect the block *names* were the problem.

Headers, conditionals, and single-row database lookups were all affected, since their AI-facing names happened to be the ones that drifted furthest from storage's names.

The fix was to stop maintaining two name lists that could drift and give every block exactly one name, used everywhere — by the assistant, by storage, and by the check in between. A test now fails the build the moment a block's AI-facing name and its stored name disagree, so this can't quietly happen again.

## The second hole: storage trusted the input

Fixing the assistant's vocabulary closed the door it had been walking through, but it wasn't the only door. The canvas itself — the thing every save request goes through, whether it comes from the editor, the assistant, or an automation — never checked that a block's type was one Fluxify actually knows how to run. It accepted any string. A typo, a stale integration, or the very naming drift above would all sail through the same way: saved cleanly, broken at request time.

That's the more important fix, because it doesn't depend on the assistant getting every name right forever. Now, every canvas save checks each block's type against the real list of built-in blocks and the project's own custom blocks, and rejects the save outright if something doesn't match — naming exactly which type is invalid. A typo gets caught at save time, in the editor, instead of at request time, in production.

## While we were in here: slow down on rate limits, not on everything

Unrelated to the naming bug, but found in the same stretch of work: when an AI provider rate-limits a request, the assistant was waiting a flat 20 seconds before retrying, every time — even on the second attempt, when the provider's quota window had usually already refilled. Two retries could burn 40 seconds off a run that only gets 10 minutes total.

Rate limits are quota windows, not random blips, so the right response isn't a fixed pause — it's a growing one: 5 seconds, then 10, then 20, up to a one-minute cap, so an early retry doesn't wait longer than it needs to and a stubborn one doesn't hammer the provider. If the provider tells us exactly how long to wait, we still use that instead.

## What shipped

- Every block has exactly one name, used identically by the AI assistant, storage, and validation — with a test that fails if they ever drift apart again.
- Saving a canvas now rejects any block type that isn't a real built-in or a real custom block in that project, naming the invalid type instead of silently accepting it.
- AI-triggered rate limits now back off gradually instead of waiting a flat 20 seconds on every retry.

The naming fix stopped the assistant from causing this. The canvas check is why it can't happen again for any other reason.
