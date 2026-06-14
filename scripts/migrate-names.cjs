/**
 * Migrate name/avatar data: prod `userPublic` (+ `bot`) → ugly.chat `userPublic`.
 * Gives ugly.chat local name/avatar resolution for sidebar DM titles and message
 * senders (no per-request ugly.bot calls). Idempotent upsert by _id.
 */
const fs=require('fs'),os=require('os');
const { Client } = require('/Users/admin/Documents/GitHub/app/node_modules/pg');
const creds=JSON.parse(fs.readFileSync(os.homedir()+'/.config/ugly-app/infra/uglybot.json'));
const PROD=`postgresql://${creds.dbUser}:${creds.dbPwd}@localhost:15432/uglybot`;
const NEON=JSON.parse(fs.readFileSync(os.homedir()+'/.ugly-studio/projects/11tm1kplpe/publish-state.json')).neon.connectionString;
const BATCH=1000;
(async()=>{
  const prod=new Client({connectionString:PROD}); await prod.connect();
  const neon=new Client({connectionString:NEON,ssl:{rejectUnauthorized:false}}); await neon.connect();

  // 1) userPublic verbatim
  let after='', done=0;
  for(;;){
    const {rows}=await prod.query(`SELECT _id,data,created,updated,version FROM "userPublic" WHERE _id>$1 ORDER BY _id LIMIT $2`,[after,BATCH]);
    if(!rows.length) break;
    const v=[],pr=[];
    rows.forEach((r,i)=>{const b=i*5; v.push(`($${b+1},$${b+2}::jsonb,$${b+3},$${b+4},$${b+5})`); pr.push(r._id,JSON.stringify(r.data),r.created,r.updated,r.version??1);});
    await neon.query(`INSERT INTO "userPublic" (_id,data,created,updated,version) VALUES ${v.join(',')} ON CONFLICT (_id) DO UPDATE SET data=EXCLUDED.data,updated=EXCLUDED.updated`,pr);
    done+=rows.length; after=rows[rows.length-1]._id;
  }
  console.log('userPublic migrated:', done);

  // 2) bot table → userPublic entries (don't overwrite existing userPublic)
  const bots=(await prod.query(`SELECT _id, data FROM bot`)).rows;
  let bdone=0;
  for(const r of bots){
    const d=r.data||{};
    const pub={ _id:r._id, name:d.name??d._id, isBot:true,
      ...(d.avatar?{avatar:d.avatar}:{}), ...(d.image?{image:d.image}:{}),
      ...(d.imageUri?{imageUri:d.imageUri}:{}), ...(d.avatarId?{avatarId:d.avatarId}:{}),
      ...(d.voiceId?{voiceId:d.voiceId}:{}) };
    await neon.query(`INSERT INTO "userPublic" (_id,data,created,updated,version) VALUES ($1,$2::jsonb,now(),now(),1) ON CONFLICT (_id) DO NOTHING`,[r._id,JSON.stringify(pub)]);
    bdone++;
  }
  console.log('bot names added:', bdone);
  const tot=(await neon.query(`SELECT count(*)::int n FROM "userPublic"`)).rows[0].n;
  console.log('neon userPublic total:', tot);
  await prod.end(); await neon.end();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)});
