/**
 * Cloudflare Workers entry — built by `npm run build:workers` and
 * uploaded by Studio's `workers-deploy` step.
 *
 * This file is bundled by esbuild into `dist/worker/worker.js`. The
 * Worker exposes:
 *   - `fetch`     — Hono router for HTTP + WS upgrades
 *   - `scheduled` — Cloudflare Cron Triggers → `setCronTasks` handlers
 *   - `queue`     — Cloudflare Queues → `setWorkers` handlers
 *   - `CollectionDO` / `SessionDO` — Durable Object classes referenced
 *     by `wrangler.toml`'s `[[durable_objects.bindings]]`
 *
 * If you add new request handlers, cron tasks, or workers in your
 * shared/server modules, no changes are needed here — the registries
 * are read at app construction time.
 */

import {
  CollectionDO,
  SessionDO,
  createWorkersApp,
} from 'ugly-app/server/adapter/workers';

import { requests } from '../shared/api';
import { collections } from '../shared/collections';
import { cronTasks } from '../shared/cron';
// Handlers + cron-handlers live in `server/handlers.ts` so this file
// (and the Workers bundle) stay free of Node-only deps that the
// Express startup in `server/index.ts` imports. If you don't have
// that split yet, run `ugly-app refactor:handlers` (see docs).
import {
  cronHandlers,
  requestHandlers,
} from './handlers';

const app = createWorkersApp(
  { requests },
  requestHandlers,
  collections,
  (cfg) => {
    cfg.setCronTasks(cronTasks, cronHandlers);
  },
);

export default app;
export { CollectionDO, SessionDO };
