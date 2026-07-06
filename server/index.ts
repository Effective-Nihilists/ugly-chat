import {
  createApp,
  type AppConfigurator,
  type InboundEmail,
} from 'ugly-app';
import { enableCollab } from 'ugly-app/collab/server';
import { dbDefaults } from 'ugly-app/shared';
import { messages, requests } from '../shared/api';
import { collections } from '../shared/collections';
import { cronTasks } from '../shared/cron';
import { experiments } from '../shared/experiments';
import en from '../shared/lang/en';
import es from '../shared/lang/es';
import { pages } from '../shared/pages';
import { stringsDef } from '../shared/strings';
import { createChatHandlers, cronHandlers, type DbSurface } from './handlers';
import { wireEngineDeps } from './configure';
import { withUserPublic } from './userPublic';

// Lazy db resolver (arrow is only invoked at request time, after `app` is set).
const getDb = (): DbSurface => app.db as unknown as DbSurface;

const app = createApp(
  { requests, messages },
  createChatHandlers(getDb),
  // Attach the real ugly.bot-backed getter to the `userPublic` collection (the
  // shared def carries only a table-less placeholder getter).
  withUserPublic(collections),
  (configurator: AppConfigurator) => {
    configurator.setPages({ pages });
    configurator.setExperiments(experiments);
    const tables: Record<string, Record<string, string>> = {
      en: en as unknown as Record<string, string>,
      es: es as unknown as Record<string, string>,
    };
    configurator.setStrings({
      defaultLang: stringsDef.defaultLang,
      langs: stringsDef.langs,
      criticalKeys: stringsDef.criticalKeys,
      getTable: (lang) => tables[lang] ?? tables[stringsDef.defaultLang]!,
    });
    configurator.setWorkers(cronTasks, cronHandlers);
    configurator.setOnEmail(async (inbound: InboundEmail) => {
      await Promise.resolve();
      console.log('[Email] Received:', { from: inbound.from, id: inbound.id, subject: inbound.subject });
    });

    // Conversation engine deps (shared with the Workers entry). The engine needs
    // the full TypedDB surface, so pass `app.db` directly (not the narrowed getter).
    wireEngineDeps(() => app.db);

    enableCollab(configurator, {
      async loadState(docId) {
        try {
          const doc = await app.db.getDoc(collections.collabDoc, docId);
          return doc?.yjsState ?? null;
        } catch {
          return null;
        }
      },
      async saveState(docId, state, serialized) {
        await app.db.setDoc(collections.collabDoc, {
          _id: docId,
          yjsState: state.yjsState,
          serialized,
          lastSyncedAt: state.lastSyncedAt,
          ...dbDefaults(),
        });
      },
    });
  },
);

// eslint-disable-next-line @typescript-eslint/dot-notation
const port = parseInt(process.env['PORT'] ?? '4321');
await app.start(port);
