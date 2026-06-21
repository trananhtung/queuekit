# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-21

### Added

- `Queue` — stateful async task queue: `add` (returns a promise for the task's
  result) and `addAll`, with a `concurrency` limit, per-task `priority`
  (higher first, ties FIFO), and isolated task failures.
- Control: `start` / `pause`, `clear` (rejects pending with `QueueClearedError`),
  and a runtime-settable `concurrency`.
- Drain awaiting: `onEmpty()` (nothing waiting) and `onIdle()` (nothing waiting
  and nothing running).
- Inspection getters: `size`, `pending`, `isPaused`, `concurrency`.
- `AbortSignal` support at the queue level (clears pending, blocks new adds) and
  per task (cancels a single queued task).
- ESM + CJS builds, types, and CI across Node 18 / 20 / 22.
