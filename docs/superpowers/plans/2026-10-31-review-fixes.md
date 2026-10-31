# Review Findings Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans or the scoped implementation brief below, preserving RED → GREEN evidence.

**Goal:** Resolve all nine findings from the review of bdbde5c.

**Architecture:** Keep the current browser scripts and Cloudflare Worker. Replace community dictionary overlays as snapshots, invalidate rendered translations by revision, coordinate refreshes, and bound popup reconnection. Use durable, recoverable publication operations and atomic submission replacement in D1. Release the integrated fixes as 1.9.4, as requested by the user.

**Tech Stack:** Native JavaScript, Node test/VM harnesses, SQLite/D1, existing GitHub REST integration. No new services or dependencies.

**Spec:** The nine numbered findings in the review accepted by the user's “全部修复”.

## Global Constraints

- Preserve existing browser features and public editor API behavior.
- Manual translation updates must not reload NovelAI.
- A removed community entry must restore the base dictionary and remove community-only tags/search terms.
- Failed or older downloads must not replace newer successful cached translations.
- Never publish a rejected submission or report a published operation as pending.
- Recover publishing operations without duplicate GitHub commits or edit history rows.
- Preserve author attribution, validation and moderation access checks.
- All verification is local; do not mutate production services or push branches.

## Review Focus

- Empty snapshots and aliases-only changes restore base labels and search terms.
- Dictionary updates invalidate existing comparison panels without prompt edits.
- Slow, overlapping, aborted and cross-tab downloads preserve the latest successful data.
- GitHub success followed by D1 failure or lost responses remains recoverable.
- Concurrent submissions and abandoned moderation claims cannot bypass moderation.

## Task 1: Recoverable Worker publication and atomic submissions

Files: worker/src/index.js, worker/schema.sql, worker migrations/docs, scripts/test-worker.mjs.

- [x] Add failing regressions for GitHub success followed by D1 failure, expired approval versus rejection, and concurrent replacement submissions.
- [x] Add durable publication identity/state and reconciliation for retries; final D1 bookkeeping must be atomic/idempotent.
- [x] Separate reclaimable preparation from potentially in-flight publication, and validate claim ownership before irreversible work.
- [x] Atomically replace pending submissions and enforce at most one active record per user/tag, with an upgrade path for existing databases.
- [x] Run Worker tests and record RED/GREEN evidence.

## Task 2: Browser dictionary snapshots and cooperative startup

Files: src/core.js, src/main.js, scripts/test.mjs and browser regression tests.

- [x] Add failing tests for replacing/removing community overlays and asynchronous construction yielding before completion.
- [x] Preserve createZhDict(raw, t2s) and add a cooperative async construction path with bounded batches.
- [x] Add snapshot replacement and revision tracking; base aliases and labels must survive overlay removal.
- [x] Share a pending preload promise and ensure its completion never overwrites an already initialized/updated dictionary.
- [x] Verify lookup/search equivalence and compare initialization responsiveness to baseline.

## Task 3: Community refresh ordering and view invalidation

Files: src/community.js, src/compare.js, relevant tests.

- [x] Add failing tests for removal, unchanged-prompt redraw, overlapping responses and another tab's newer cache surviving a failed refresh.
- [x] Coalesce same-page downloads, retain latest persisted data on failure, use monotonic request ordering and synchronize storage changes.
- [x] Replace dictionary overlays from snapshots; notify comparison/annotation views and include dictionary revision in render keys.
- [x] Keep existing cache compatibility and explicit failure reporting.

## Task 4: Popup reconnect and offline saves

Files: extension/popup.js, scripts/test-popup.mjs.

- [x] Add failing tests for delayed reconnect after settings reload and successive offline setting edits.
- [x] Retry reconnection to a bounded deadline and keep saved settings consistent while waiting.
- [x] Disable controls while storage is pending so user actions are not silently dropped.
- [x] Run all popup tests.

## Task 5: Integrate and verify

- [x] Increment version to 1.9.4 and rebuild dist/extensions.
- [x] Run search, popup, browser integration and Worker suites; check generated files and syntax.
- [x] Review the whole diff, including migration compatibility and failure paths.
- [x] Report all nine resolutions, tests, performance evidence and any deployment prerequisites.
