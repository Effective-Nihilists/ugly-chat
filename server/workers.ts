/**
 * Cloudflare Workers entry — built by `npm run build:workers` and uploaded by
 * Studio's `workers-deploy` step. Bundled by esbuild into `dist/worker/worker.js`.
 *
 * Uses the runtime-agnostic `createChatHandlers(getDb)` from `server/handlers.ts`
 * (shared with the Node entry) and `wireEngineDeps(getDb)` from `server/configure.ts`.
 * On Workers the db is resolved per-request via `getAppContext().typedDb`.
 */
import {
  CollectionDO,
  SessionDO,
  createWorkersApp,
  getAppContext,
} from 'ugly-app/server/adapter/workers';

import { messages, requests } from '../shared/api';
import { collections } from '../shared/collections';
import { cronTasks } from '../shared/cron';
import { createChatHandlers, cronHandlers, type DbSurface } from './handlers';
import { wireEngineDeps } from './configure';

const getDb = (): DbSurface => {
  const ctx = getAppContext();
  if (!ctx.typedDb) throw new Error('[workers] typedDb not initialized');
  return ctx.typedDb as unknown as DbSurface;
};

const app = createWorkersApp(
  { requests, messages },
  createChatHandlers(getDb),
  collections,
  (cfg) => {
    cfg.setWorkers(cronTasks, cronHandlers);
    wireEngineDeps(getDb);
  },
);

export default app;
export { CollectionDO, SessionDO };
