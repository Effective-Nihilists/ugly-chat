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
import { registerAppApi } from './appApi';
import { withUserPublic } from './userPublic';

const getDb = (): DbSurface => {
  const ctx = getAppContext();
  if (!ctx.typedDb) throw new Error('[workers] typedDb not initialized');
  return ctx.typedDb as unknown as DbSurface;
};

const app = createWorkersApp(
  { requests, messages },
  createChatHandlers(getDb),
  // Attach the real ugly.bot-backed getter to the `userPublic` collection (the
  // shared def carries only a table-less placeholder getter).
  withUserPublic(collections),
  (cfg) => {
    cfg.setWorkers(cronTasks, cronHandlers);
    wireEngineDeps(getDb);
    // Cross-app chat API (/app/*) — authenticated by ugly.bot chat tokens.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cfg.setRawRoutes((honoApp: any) => registerAppApi(honoApp, getDb));
  },
);

export default app;
export { CollectionDO, SessionDO };
