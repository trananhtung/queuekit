# queuekit

[![All Contributors](https://img.shields.io/badge/all_contributors-1-orange.svg?style=flat-square)](#contributors-)

> Tiny, type-safe **async task queue** — concurrency limit, **priority**, pause/resume, `onIdle`/`onEmpty` drain, and **`AbortSignal`**. **Zero dependencies**.

[![CI](https://github.com/trananhtung/queuekit/actions/workflows/ci.yml/badge.svg)](https://github.com/trananhtung/queuekit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@billdaddy/queuekit.svg)](https://www.npmjs.com/package/@billdaddy/queuekit)
[![bundle size](https://img.shields.io/bundlephobia/minzip/@billdaddy/queuekit)](https://bundlephobia.com/package/@billdaddy/queuekit)
[![types](https://img.shields.io/npm/types/@billdaddy/queuekit.svg)](https://www.npmjs.com/package/@billdaddy/queuekit)
[![license](https://img.shields.io/npm/l/@billdaddy/queuekit.svg)](./LICENSE)

When you have a *known list*, you map it with a concurrency limit and you're done.
But when work arrives **over time** — webhook handlers, a crawler discovering
links, jobs trickling off a stream — you need something *stateful*: a queue you
can keep adding to, that bounds how much runs at once and lets you await the
drain. That's `queuekit`.

```ts
import { Queue } from "@billdaddy/queuekit";

const queue = new Queue({ concurrency: 4 });

for (const url of discoverUrls()) {
  queue.add(() => crawl(url)); // returns a promise for this task's result
}

await queue.onIdle(); // resolves when everything has settled
```

## Why queuekit?

- **Stateful, not one-shot.** Add tasks whenever; each `add()` returns a promise
  that settles with that task's value (or its error — failures don't stall the queue).
- **Concurrency you can change live.** Set a limit up front, raise or lower it at
  runtime and the queue immediately starts (or stops feeding) tasks.
- **Priority.** Higher-priority tasks jump ahead; ties keep FIFO order.
- **Pause / resume / clear.** Stage work with `autoStart: false`, `pause()` to
  hold, `clear()` to drop what's waiting.
- **Await the drain.** `onEmpty()` (nothing waiting) and `onIdle()` (nothing
  waiting *and* nothing running).
- **Cancellable.** A queue-level `AbortSignal`, plus a per-task signal to cancel
  a single queued task.
- **Zero dependencies**, ESM + CJS + types.

## Install

```bash
npm install @billdaddy/queuekit
# or: pnpm add @billdaddy/queuekit  /  yarn add @billdaddy/queuekit  /  bun add @billdaddy/queuekit
```

## API

### `new Queue(options?)`

```ts
interface QueueOptions {
  concurrency?: number;  // max running at once (default Infinity)
  autoStart?: boolean;   // process as added (default true)
  signal?: AbortSignal;  // abort clears pending + blocks new adds
}
```

### `queue.add(task, options?) → Promise<T>`

```ts
interface AddOptions {
  priority?: number;     // higher first, ties FIFO (default 0)
  signal?: AbortSignal;  // cancel this task while still queued
}

const value = await queue.add(() => fetchJson(url));
await queue.add(() => fetchJson(url), { priority: 10 });
```

`addAll(tasks, options?)` enqueues many and resolves to their results in order.

### Control & inspection

| Member | Description |
| --- | --- |
| `start()` / `pause()` | Resume / stop starting new tasks (in-flight finish). |
| `clear()` | Drop pending tasks; each rejects with `QueueClearedError`. |
| `onEmpty()` | Promise that resolves when nothing is waiting. |
| `onIdle()` | Promise that resolves when fully drained. |
| `size` | Tasks waiting to start. |
| `pending` | Tasks currently running. |
| `isPaused` | Whether processing is paused. |
| `concurrency` | Get/set the limit (settable at runtime). |

## Patterns

**Rate-stable worker** — stage, then run in priority order:

```ts
const queue = new Queue({ concurrency: 2, autoStart: false });
jobs.forEach((j) => queue.add(() => run(j), { priority: j.urgent ? 1 : 0 }));
queue.start();
await queue.onIdle();
```

**Backpressure** — wait for room before queueing more:

```ts
for (const item of hugeStream) {
  if (queue.size > 1000) await queue.onEmpty();
  queue.add(() => process(item));
}
await queue.onIdle();
```

## Pairs well with

| Need | Use |
| --- | --- |
| Map a *known* list with a concurrency cap | [`runpool`](https://www.npmjs.com/package/runpool) |
| Cap *rate* (per second / token bucket) | [`ratebucket`](https://www.npmjs.com/package/ratebucket) |
| Serialize a critical section | [`mutexkit`](https://www.npmjs.com/package/mutexkit) |
| Retry a flaky task | [`retryfn`](https://www.npmjs.com/package/retryfn) |

## Contributors ✨

This project follows the [all-contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome — code, docs, bug reports, ideas, reviews! See the [emoji key](https://allcontributors.org/docs/en/emoji-key) for how each contribution is recognized, and open a PR or issue to get involved.

Thanks goes to these wonderful people:

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://github.com/trananhtung"><img src="https://avatars.githubusercontent.com/u/30992229?v=4?s=100" width="100px;" alt="Tung Tran"/><br /><sub><b>Tung Tran</b></sub></a><br /><a href="https://github.com/trananhtung/queuekit/commits?author=trananhtung" title="Code">💻</a> <a href="#maintenance-trananhtung" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

[MIT](./LICENSE) © Tung Tran
