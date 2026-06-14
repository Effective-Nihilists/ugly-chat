/**
 * Migrate chat history from ugly.bot prod Postgres → ugly.chat Neon.
 *
 * Both DBs use the ugly-app collection storage format (per-collection table with
 * columns _id text, data jsonb, created/updated timestamptz, version int), so
 * rows copy verbatim. userIds are federated (kept as-is). Idempotent: re-running
 * upserts by _id, and keyset pagination (_id > cursor) makes it resumable.
 *
 *   PROD tunnel must be up:  scripts/prod-proxy.sh  (localhost:15432)
 *   node scripts/migrate-chat-history.cjs [table ...]
 */
const fs = require('fs'), os = require('os');
const { Client } = require('/Users/admin/Documents/GitHub/app/node_modules/pg');

const creds = JSON.parse(fs.readFileSync(os.homedir() + '/.config/ugly-app/infra/uglybot.json'));
const PROD = `postgresql://${creds.dbUser}:${creds.dbPwd}@localhost:15432/uglybot`;
const NEON = JSON.parse(fs.readFileSync(os.homedir() + '/.ugly-studio/projects/11tm1kplpe/publish-state.json')).neon.connectionString;

// Dependency order: parents before children (message largest, last).
const TABLES = process.argv.slice(2).length ? process.argv.slice(2)
  : ['conversation', 'conversationUser', 'userConversation', 'messageReaction', 'message'];
const BATCH = 1000;

async function migrateTable(prod, neon, t) {
  const { rows: [{ n: total }] } = await prod.query(`SELECT count(*)::int n FROM "${t}"`);
  let after = '', done = 0, t0 = Date.now();
  for (;;) {
    const { rows } = await prod.query(
      `SELECT _id, data, created, updated, version FROM "${t}" WHERE _id > $1 ORDER BY _id LIMIT $2`,
      [after, BATCH],
    );
    if (!rows.length) break;
    const vals = [], params = [];
    rows.forEach((r, i) => {
      const b = i * 5;
      vals.push(`($${b+1},$${b+2}::jsonb,$${b+3},$${b+4},$${b+5})`);
      params.push(r._id, JSON.stringify(r.data), r.created, r.updated, r.version ?? 1);
    });
    await neon.query(
      `INSERT INTO "${t}" (_id, data, created, updated, version) VALUES ${vals.join(',')}
       ON CONFLICT (_id) DO UPDATE SET data = EXCLUDED.data, updated = EXCLUDED.updated, version = EXCLUDED.version`,
      params,
    );
    done += rows.length;
    after = rows[rows.length - 1]._id;
    if (done % 10000 < BATCH || done === total) {
      const rate = Math.round(done / ((Date.now() - t0) / 1000));
      console.log(`[${t}] ${done}/${total} (${rate}/s)`);
    }
  }
  console.log(`[${t}] DONE ${done} rows in ${Math.round((Date.now()-t0)/1000)}s`);
}

(async () => {
  const prod = new Client({ connectionString: PROD });
  const neon = new Client({ connectionString: NEON, ssl: { rejectUnauthorized: false } });
  await prod.connect(); await neon.connect();
  console.log('connected. migrating:', TABLES.join(', '));
  for (const t of TABLES) await migrateTable(prod, neon, t);
  await prod.end(); await neon.end();
  console.log('ALL DONE');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
