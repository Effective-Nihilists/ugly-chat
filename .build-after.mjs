// Rebuild the design-review page as a before/after. Images are inlined as data
// URIs — the Artifact CSP blocks every external host.
import { readFileSync, writeFileSync } from 'fs';

const OUT = '/private/tmp/claude-502/-Users-admin-Documents-GitHub-app/d5977315-1b83-4ef5-afd1-79c6b2779812/scratchpad/video-call-review.html';
const before = (f) => `data:image/png;base64,${readFileSync(`.shots-before/${f}`).toString('base64')}`;
const after = (f) => `data:image/png;base64,${readFileSync(`.shots/${f}`).toString('base64')}`;

const pairs = [
  {
    id: 'group',
    kicker: 'Scenario 01',
    title: 'Group call — three people',
    thesis:
      'The stage composed <code>participants.find(p =&gt; p.userId !== userId)</code> — exactly one peer, forever. All three were verified publishing (<code>session=yes tracks=2</code>), the transcript named all three, and the stage rendered one. It now composes the full roster.',
    b: before('group3-desktop.png'),
    a: after('group3-desktop.png'),
    bc: 'Before · three publishing, one rendered. Every client reported peerTiles:1.',
    ac: 'After · peerTiles:2 on every client. Named plates, reserved control band, stats strip gone.',
  },
  {
    id: 'groupm',
    kicker: 'Scenario 02',
    title: 'The same call, on a phone',
    thesis:
      'A composer sat permanently across the video just above the controls, so the first thing you saw in a call was a text box — and it covered the bottom row of tiles. Typing now lives behind the transcript toggle.',
    b: before('group-mobile.png'),
    a: after('group3-mobile.png'),
    bc: 'Before · composer across the stage, captions floating over a face.',
    ac: 'After · both peers tiled and named, captions anchored clear of the labels.',
  },
  {
    id: 'bot',
    kicker: 'Scenario 03',
    title: 'Bot call — the AI with a face',
    thesis:
      'Calling the bot was dead end to end: <code>videoBotJoin</code> gated on the static built-in map the canonical Ugly Bot had already left, so every attempt threw <code>not a bot</code> and the avatar never joined. The stage showed a grey disc reading <b>WF</b> — literally <code>initials("Waiting for others…")</code>.',
    b: before('bot-desktop.png'),
    a: after('bot-desktop.png'),
    bc: 'Before · “ringing · nobody has joined yet”, and the famous WF disc.',
    ac: 'After · the bot joins, renders, and is named — with the model it is actually running.',
  },
  {
    id: 'one',
    kicker: 'Scenario 04',
    title: '1:1 — and the raw id in the header',
    thesis:
      'Creating a 1:1 returned <code>errorAccessDenied</code> on production: <code>conversationCreateDirect</code> called <code>conversationUserAdd</code> on a <code>direct</code> conversation, which hard-rejects non-groups. The header showed <code>dm-t4ECy</code> because the id format was re-derived inline in three places, none of which stripped the <code>dm-</code> prefix.',
    b: before('1to1-mobile.png'),
    a: after('1to1-mobile.png'),
    bc: 'Before · raw conversation id where a person’s name belongs.',
    ac: 'After · “Tom Reed”, resolved from one parser that lives next to the minter.',
  },
];

const bugs = [
  ['Bot calls', '<code>videoBotJoin</code> gated on <code>botUser()</code> — the static built-in map the canonical bot left when it moved to the <code>bot</code> collection. Every bot call threw <code>not a bot</code>.', 'Gate on <code>isBot</code>; 4 unit tests.'],
  ['1:1 creation', '<code>conversationCreateDirect</code> ran <code>conversationUserAdd</code> on a <code>direct</code> conversation, which hard-rejects non-groups → <code>errorAccessDenied</code>.', 'Drop it — <code>conversationCreate</code> already adds both owners.'],
  ['DM titles', 'The <code>dm-A+B</code> id was parsed inline in three places, none stripping the prefix, so half of all DMs resolved a peer id of <code>dm-&lt;ourOwnId&gt;</code>.', 'One parser beside the minter; 6 unit tests.'],
  ['Who is talking', 'The speaking ring came only from typed-message TTS — on a real call, nobody was ever marked as speaking.', 'Measure it from live audio; single winner with hysteresis.'],
  ['Stale deploys', 'Two deploys of a server fix reported success while prod ran the old code.', '<code>rm -rf dist</code>; verify behaviour on prod, not the deploy log.'],
];

const remaining = [
  'Peer video is cropped edge-to-edge rather than fit — on a real call this crops faces and shared content.',
  'The mobile self-view can sit in “Starting camera…” for the whole call when the local track never produces frames — the state is now named, but the underlying cause is unfixed.',
  'The sidebar files a group conversation under <span class="mono">// DIRECT</span>.',
  'Source-card quality/dedup, and the STT console flood (<code>send DROPPED stt:audio — ws null</code>) are still open from the earlier passes.',
];

const shot = (src, cap, tag) => `
  <figure class="shot">
    <div class="tag ${tag === 'Before' ? 'b' : 'a'}">${tag}</div>
    <img src="${src}" alt="${cap}" loading="lazy" />
    <figcaption>${cap}</figcaption>
  </figure>`;

const section = (p) => `
  <section class="scenario" id="${p.id}">
    <div class="skicker">${p.kicker}</div>
    <h2>${p.title}</h2>
    <p class="thesis">${p.thesis}</p>
    <div class="pair">
      ${shot(p.b, p.bc, 'Before')}
      ${shot(p.a, p.ac, 'After')}
    </div>
  </section>`;

const html = `<title>Video call — the pass · ugly.chat</title>
<style>
  :root{
    --ground:#0d0c0c; --panel:#151313; --line:#2b2827; --ink:#f4f1ef; --muted:#918a85;
    --accent:#f2510d; --good:#3d9a50;
    --mono: ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;
    --sans: ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  @media (prefers-color-scheme: light){
    :root{ --ground:#faf9f8; --panel:#ffffff; --line:#e6e2df; --ink:#141211; --muted:#6f6864; }
  }
  :root[data-theme="light"]{ --ground:#faf9f8; --panel:#ffffff; --line:#e6e2df; --ink:#141211; --muted:#6f6864; }
  :root[data-theme="dark"]{ --ground:#0d0c0c; --panel:#151313; --line:#2b2827; --ink:#f4f1ef; --muted:#918a85; }

  *{ box-sizing:border-box; }
  body{ margin:0; background:var(--ground); color:var(--ink); font-family:var(--sans);
        -webkit-font-smoothing:antialiased; line-height:1.5; }
  .wrap{ max-width:1180px; margin:0 auto; padding:0 24px 96px; }
  code{ font-family:var(--mono); font-size:0.88em; background:color-mix(in srgb,var(--accent) 12%,transparent);
        padding:1px 5px; }
  .label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.22em; color:var(--muted); }
  .mono{ font-family:var(--mono); font-size:12.5px; }

  header{ border-bottom:1px solid var(--line); padding:56px 0 28px; margin-bottom:8px; }
  h1{ font-size:clamp(34px,5.2vw,60px); line-height:.98; letter-spacing:-.035em; font-weight:800;
      margin:14px 0 0; text-wrap:balance; }
  h1 .dot{ color:var(--accent); }
  .sub{ color:var(--muted); max-width:64ch; margin:16px 0 0; font-size:15.5px; }

  .verdicts{ display:flex; gap:10px; flex-wrap:wrap; margin-top:28px; }
  .vcard{ border:1px solid var(--line); background:var(--panel); padding:14px 16px; min-width:190px; }
  .vcard .who{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.16em; color:var(--muted); }
  .vcard .score{ font-size:28px; font-weight:800; letter-spacing:-.03em; font-variant-numeric:tabular-nums;
                 margin-top:4px; display:flex; align-items:baseline; gap:8px; }
  .vcard .score .from{ font-size:15px; color:var(--muted); font-weight:600; text-decoration:line-through; }
  .vcard .score .to{ color:var(--accent); }
  .vcard .line{ font-size:12.5px; color:var(--muted); margin-top:4px; }

  .scenario{ padding:44px 0; border-bottom:1px solid var(--line); }
  .skicker{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.22em; color:var(--accent); }
  .scenario h2{ font-size:clamp(22px,2.7vw,31px); letter-spacing:-.025em; font-weight:800; margin:8px 0 0; }
  .thesis{ color:var(--muted); max-width:78ch; margin:12px 0 0; font-size:15px; }
  .thesis b{ color:var(--ink); }

  .pair{ display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:24px; align-items:start; }
  @media (max-width:820px){ .pair{ grid-template-columns:1fr; } }
  .shot{ margin:0; border:1px solid var(--line); background:var(--panel); position:relative; min-width:0; }
  .shot img{ display:block; width:100%; height:auto; }
  .shot figcaption{ font-family:var(--mono); font-size:10.5px; color:var(--muted); padding:8px 10px;
                    border-top:1px solid var(--line); }
  .tag{ position:absolute; top:0; left:0; z-index:2; font-family:var(--mono); font-size:9.5px; font-weight:700;
        text-transform:uppercase; letter-spacing:.14em; padding:4px 8px; color:#fff; }
  .tag.b{ background:#6f6864; } .tag.a{ background:var(--accent); }

  .block{ padding:48px 0 0; }
  .block h2{ font-size:clamp(22px,2.7vw,31px); letter-spacing:-.025em; font-weight:800; margin:8px 0 6px; }
  .block p.intro{ color:var(--muted); max-width:72ch; margin:0 0 20px; font-size:15px; }
  table{ width:100%; border-collapse:collapse; font-size:14px; }
  th{ text-align:left; font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.14em;
      color:var(--muted); font-weight:600; padding:0 10px 8px; border-bottom:1px solid var(--line); }
  td{ border-bottom:1px solid var(--line); padding:13px 10px; vertical-align:baseline; }
  td:first-child{ width:132px; font-weight:650; }
  td:nth-child(2){ color:var(--muted); }
  td:last-child{ width:290px; }
  @media (max-width:820px){ table, thead, tbody, tr, td, th{ display:block; } th{ display:none; }
    td{ border:0; padding:2px 0; } td:first-child{ padding-top:14px; }
    tr{ display:block; border-bottom:1px solid var(--line); padding:8px 0; } td:last-child{ width:auto; } }

  ul.rem{ margin:0; padding-left:20px; display:grid; gap:8px; font-size:14.5px; color:var(--muted); max-width:78ch; }
  ul.rem li::marker{ color:var(--accent); }
  footer{ margin-top:48px; color:var(--muted); font-size:12.5px; font-family:var(--mono);
          border-top:1px solid var(--line); padding-top:20px; }
</style>

<div class="wrap">
  <header>
    <div class="label">Design pass · verified on production</div>
    <h1>The video call<span class="dot">.</span><br />Before and after.</h1>
    <p class="sub">Two critics rated the call <b>2 / 5</b>. Their top finding was that the stage could not
      render a group: it composed exactly one peer no matter who was in the call. Fixing that surfaced three
      more bugs that were breaking the feature outright on production — bot calls, 1:1 creation, and DM names.
      Every frame below is real, captured from <span class="mono">ugly.chat</span>, with the server roster
      verified separately.</p>
    <div class="verdicts">
      <div class="vcard">
        <div class="who">Vera · call experience</div>
        <div class="score"><span class="from">2</span><span class="to">3</span><span style="font-size:14px;color:var(--muted)">/ 5</span></div>
        <div class="line">“The two things I screamed about got real fixes.”</div>
      </div>
      <div class="vcard">
        <div class="who">Dana · design</div>
        <div class="score"><span class="from">2</span><span class="to">3</span><span style="font-size:14px;color:var(--muted)">/ 5</span></div>
        <div class="line">“The human calls finally look like a designed product.”</div>
      </div>
      <div class="vcard">
        <div class="who">Verified</div>
        <div class="score"><span class="to">peerTiles 1 → 2</span></div>
        <div class="line">Every client, all three publishing.</div>
      </div>
    </div>
  </header>

  ${pairs.map(section).join('')}

  <section class="block">
    <div class="skicker">What was actually broken</div>
    <h2>Five bugs, not five opinions.</h2>
    <p class="intro">The design review kept walking into features that did not work at all. These were found by
      driving production and checking the server, not by reading the code.</p>
    <table>
      <thead><tr><th>Area</th><th>What was wrong</th><th>Fix</th></tr></thead>
      <tbody>
        ${bugs.map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>

  <section class="block">
    <div class="skicker">Still open</div>
    <h2>What I did not fix.</h2>
    <ul class="rem">${remaining.map((r) => `<li>${r}</li>`).join('')}</ul>
  </section>

  <footer>
    ugly.chat v0.1.52 · 7 frames · desktop 1280×800, mobile 390×844 · fake camera devices
    (the green pattern and the poster are the test feed) · roster verified server-side per run
  </footer>
</div>`;

writeFileSync(OUT, html);
console.log('wrote', OUT, (html.length / 1024 / 1024).toFixed(2), 'MB');
