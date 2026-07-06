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

const getFullDb = () => {
  const ctx = getAppContext();
  if (!ctx.typedDb) throw new Error('[workers] typedDb not initialized');
  return ctx.typedDb;
};
const getDb = (): DbSurface => getFullDb() as unknown as DbSurface;

const app = createWorkersApp(
  { requests, messages },
  createChatHandlers(getDb),
  // Attach the real ugly.bot-backed getter to the `userPublic` collection (the
  // shared def carries only a table-less placeholder getter).
  withUserPublic(collections),
  (cfg) => {
    cfg.setWorkers(cronTasks, cronHandlers);
    wireEngineDeps(getFullDb);
    // Cross-app chat API (/app/*) — authenticated by ugly.bot chat tokens.
    // `setRawRoutes` hands back a `Hono<{ Bindings: WorkersEnv }>`, but the
    // cross-app API treats bindings as a generic record (it reads app-specific
    // vars like UGLY_BOT_URL that WorkersEnv doesn't declare). Bridge the two
    // Hono binding shapes at this boundary.
    cfg.setRawRoutes((honoApp) => {
      registerAppApi(honoApp as unknown as Parameters<typeof registerAppApi>[0], getDb);
    });
  },
);

export default app;
export { CollectionDO, SessionDO };
