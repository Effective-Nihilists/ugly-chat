// Build a self-contained design-review page (images inlined as data URIs — the
// Artifact CSP blocks every external host).
import { readFileSync, writeFileSync } from 'fs';

const OUT = '/private/tmp/claude-502/-Users-admin-Documents-GitHub-app/d5977315-1b83-4ef5-afd1-79c6b2779812/scratchpad/video-call-review.html';
const dir = '/Users/admin/Documents/GitHub/ugly-chat/.shots';
const img = (f) => `data:image/png;base64,${readFileSync(`${dir}/${f}`).toString('base64')}`;

const shots = {
  botD: img('bot-desktop.png'),
  botM: img('bot-mobile.png'),
  oneD: img('1to1-desktop.png'),
  oneP: img('1to1-peer-desktop.png'),
  oneM: img('1to1-mobile.png'),
  grpD: img('group3-desktop.png'),
  grpM: img('group3-mobile.png'),
};

const F = (sev, area, text) => ({ sev, area, text });
const sections = [
  {
    id: 'group',
    kicker: 'Scenario 03',
    title: 'Group call — three people',
    thesis:
      'A genuine three-way call — the server roster confirms all three publishing (<code>session=yes tracks=2</code> each). The transcript rail names <b>YOU · ANA SILVA · BEN OKAFOR</b>. The stage shows <b>one of them</b>. The app knows Ben is there, lists him talking, and renders him nowhere: it composes <code>participants.find(p =&gt; p.userId !== userId)</code> — exactly one peer, forever.',
    shots: [
      { src: shots.grpD, cap: 'Desktop · all three publishing. Transcript names three. Stage renders one.', w: 'wide' },
      { src: shots.grpM, cap: 'Mobile · avatar fallback (the best-looking thing here)', w: 'narrow' },
    ],
    findings: [
      F('blocker', 'Stage', '“A group call surface that cannot compose more than two tiles is not a design — it’s a 1:1 view with a different title.” <span class="who">Dana</span>'),
      F('blocker', 'Roster', '“I cannot answer <i>who is here</i> — the most basic question a call must answer.” <span class="who">Vera</span>'),
      F('high', 'Labels', 'The one visible peer is named <b>twice</b> — chip top-right and plate bottom-left — “wasting the exact real estate a grid would need, while a third participant goes unnamed.”'),
      F('high', 'Self-view', 'The self-PiP renders as a flat black rectangle labelled “you” — “I cannot confirm my own camera is working, which is the reason self-view exists.” <span class="who">Vera</span>'),
      F('low', 'Asset', '“The 3D character over the painted backdrop is the only element in these seven shots with any craft.” It’s reachable only by accident, unlabelled, and cropped at the chin.'),
    ],
  },
  {
    id: 'bot',
    kicker: 'Scenario 01',
    title: 'Bot call — the AI with a face',
    thesis:
      'Calling a bot is a real feature: it joins as an avatar and speaks its replies. What ships instead is a grey disc reading <b>“WF”</b> — which is literally <code>initials("Waiting for others…")</code>, the placeholder label rendered as a human monogram. This is the “WF” nobody could explain.',
    shots: [
      { src: shots.botD, cap: 'Desktop · “ringing · nobody has joined yet” — beside a chip saying the bot IS in call', w: 'wide' },
      { src: shots.botM, cap: 'Mobile · captions collide with the PiP and the composer', w: 'narrow' },
    ],
    findings: [
      F('blocker', 'Identity', '“The call with an AI has no AI presence at all: no bot name, no avatar, no speaking state. It reads as a human participant named WF.” <span class="who">Vera</span>'),
      F('high', 'Honesty', '“Three widgets, three different stories about whether I am in a call” — LIVE timer counting, ‘ringing · nobody has joined yet’, and ‘ugly-bot / in call’, all within 100px.'),
      F('medium', 'Brand', '“A soft radial-gradient perfect circle with a diffuse glow — the single most off-brand element in the shots,” in a product where every primitive is 0-radius and flat.'),
      F('medium', 'Empty state', '“600px of dead charcoal with one small disc floating dead-center. The most common first 10 seconds of a call is designed as a void.”'),
    ],
  },
  {
    id: 'onetoone',
    kicker: 'Scenario 02',
    title: '1:1 human — the one that works',
    thesis:
      'Real two-way WebRTC, sub-second ring, both sides live. Peers are named correctly now (“Tom Reyes”, previously the raw id <code>yG1edFUS</code>). This is the baseline worth protecting — and even here the header reads <code>dm-G7QvP</code>, a raw conversation id where a person’s name belongs.',
    shots: [
      { src: shots.oneD, cap: 'Desktop · caller’s view', w: 'wide' },
      { src: shots.oneP, cap: 'Desktop · the same call, other side', w: 'wide' },
      { src: shots.oneM, cap: 'Mobile · composer sits on the control bar', w: 'narrow' },
    ],
    findings: [
      F('high', 'Chrome', 'The chat stats strip stays mounted over a live call — <span class="mono">LEFT ON READ 2× · YOUR SHARE 100% · “the data doesn’t lie”</span> — and the two sides disagree (100% vs 0%). “Actively hostile to the person on it.”'),
      F('high', 'Controls', '“End-call is the same orange as the captions toggle. The one irreversible action has zero visual privilege over a toggle.”'),
      F('medium', 'Video', 'Peer video is cropped edge-to-edge rather than fit — “on a real call this crops faces and shared content.”'),
      F('medium', 'Title', 'Header shows <code>dm-G7QvP</code>: the DM-partner parse splits <code>dm-A+B</code> on “+” without stripping the <code>dm-</code> prefix, so it resolves a bogus id and falls back to the raw one.'),
    ],
  },
];

const decisions = [
  ['Stage', 'Adaptive grid + active speaker', '1 peer full-bleed → 2–4 equal grid → 5+ active speaker with a filmstrip. Every participant gets a tile, a name, a mute badge and a speaking ring. Self stays a PiP.'],
  ['Bot', 'Lean in — make it an avatar call', 'Full-bleed 3D avatar over its backdrop, badged “AI · voice call”, HUD says “Ugly Bot is listening” — not “ringing”. The renderer already exists; make it the point.'],
  ['Mobile', 'A real mobile layout', 'Composer behind a toggle instead of stacked under the controls, self-PiP inside the viewport with its label, safe areas respected, tap targets sized.'],
];

const extra = [
  ['high', 'Rank the controls', 'End-call becomes the only red object and is separated; mic/cam go full-contrast with a visible on/off state; the dashed bot button — “reads as a broken asset” — becomes a solid chip.'],
  ['high', 'Answer the four questions', 'Who’s here · who’s talking · am I muted · is my camera on. Per-tile name + mute badge + speaking ring, and a self-view that isn’t a black rectangle.'],
  ['medium', 'Kill the stats strip during calls', 'Async message-latency snark is the wrong context — and wrong data — inside a synchronous call.'],
  ['medium', 'De-dupe the peer label + scrim the HUD', 'One authoritative name per tile. Grey mono on a live video plate is unreadable; give it a scrim.'],
];

const sevRow = (s) => `<span class="sev ${s}">${s}</span>`;

const shotBlock = (s) => `
  <figure class="shot ${s.w}">
    <img src="${s.src}" alt="${s.cap}" loading="lazy" />
    <figcaption>${s.cap}</figcaption>
  </figure>`;

const section = (s) => `
  <section class="scenario" id="${s.id}">
    <div class="skicker">${s.kicker}</div>
    <h2>${s.title}</h2>
    <p class="thesis">${s.thesis}</p>
    <div class="shots">${s.shots.map(shotBlock).join('')}</div>
    <ul class="findings">
      ${s.findings.map((f) => `<li>${sevRow(f.sev)}<span class="area">${f.area}</span><span class="ftext">${f.text}</span></li>`).join('')}
    </ul>
  </section>`;

const html = `<title>Video call — design review · ugly.chat</title>
<style>
  :root{
    --ground:#0d0c0c; --panel:#151313; --line:#2b2827; --ink:#f4f1ef; --muted:#918a85;
    --accent:#f2510d; --blocker:#e5484d; --high:#f2510d; --medium:#d08700; --low:#7a7370;
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
  a{ color:inherit; }
  code{ font-family:var(--mono); font-size:0.88em; background:color-mix(in srgb,var(--accent) 12%,transparent);
        padding:1px 5px; color:var(--ink); }
  .label{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.22em; color:var(--muted); }

  /* Masthead */
  header{ border-bottom:1px solid var(--line); padding:56px 0 28px; margin-bottom:44px; }
  h1{ font-size:clamp(34px,5.2vw,60px); line-height:.98; letter-spacing:-.035em; font-weight:800;
      margin:14px 0 0; text-wrap:balance; }
  h1 .dot{ color:var(--accent); }
  .sub{ color:var(--muted); max-width:62ch; margin:16px 0 0; font-size:15.5px; }

  .verdicts{ display:flex; gap:10px; flex-wrap:wrap; margin-top:28px; }
  .vcard{ border:1px solid var(--line); background:var(--panel); padding:14px 16px; min-width:172px; }
  .vcard .who{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.16em; color:var(--muted); }
  .vcard .score{ font-size:30px; font-weight:800; letter-spacing:-.03em; font-variant-numeric:tabular-nums; margin-top:4px; }
  .vcard .score b{ color:var(--accent); }
  .vcard .line{ font-size:12.5px; color:var(--muted); margin-top:4px; }

  /* Convergence */
  .converge{ border:1px solid var(--accent); background:color-mix(in srgb,var(--accent) 7%,transparent);
             padding:20px 22px; margin:36px 0 8px; }
  .converge h3{ margin:0 0 10px; font-size:14px; letter-spacing:.02em; }
  .converge ol{ margin:0; padding-left:20px; display:grid; gap:7px; font-size:14.5px; }
  .converge li::marker{ color:var(--accent); font-family:var(--mono); font-weight:700; }

  /* Scenario */
  .scenario{ padding:48px 0; border-bottom:1px solid var(--line); }
  .skicker{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.22em; color:var(--accent); }
  .scenario h2{ font-size:clamp(22px,2.7vw,31px); letter-spacing:-.025em; font-weight:800; margin:8px 0 0; }
  .thesis{ color:var(--muted); max-width:74ch; margin:12px 0 0; font-size:15px; }
  .thesis b{ color:var(--ink); }

  .shots{ display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; margin:24px 0 0; }
  .shot{ margin:0; border:1px solid var(--line); background:var(--panel); flex:1 1 380px; min-width:0; }
  .shot.narrow{ flex:0 1 232px; }
  .shot img{ display:block; width:100%; height:auto; }
  .shot figcaption{ font-family:var(--mono); font-size:10.5px; color:var(--muted); padding:8px 10px;
                    border-top:1px solid var(--line); }

  .findings{ list-style:none; margin:22px 0 0; padding:0; display:grid; gap:1px; background:var(--line);
             border:1px solid var(--line); }
  .findings li{ background:var(--panel); padding:12px 14px; display:grid;
                grid-template-columns:74px 84px 1fr; gap:12px; align-items:baseline; font-size:14px; }
  @media (max-width:720px){ .findings li{ grid-template-columns:1fr; gap:5px; } }
  .sev{ font-family:var(--mono); font-size:9.5px; text-transform:uppercase; letter-spacing:.1em;
        font-weight:700; padding:3px 6px; color:#fff; justify-self:start; }
  .sev.blocker{ background:var(--blocker); } .sev.high{ background:var(--high); }
  .sev.medium{ background:var(--medium); } .sev.low{ background:var(--low); }
  .area{ font-family:var(--mono); font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); }
  .ftext i{ color:var(--muted); }
  .who{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.12em;
        color:var(--accent); margin-left:6px; }
  .mono{ font-family:var(--mono); font-size:12.5px; }

  /* Plan */
  .plan{ padding:52px 0 0; }
  .plan h2{ font-size:clamp(22px,2.7vw,31px); letter-spacing:-.025em; font-weight:800; margin:8px 0 18px; }
  .dgrid{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; }
  .dcard{ border:1px solid var(--line); background:var(--panel); padding:18px; border-top:3px solid var(--accent); }
  .dcard .k{ font-family:var(--mono); font-size:10px; text-transform:uppercase; letter-spacing:.2em; color:var(--muted); }
  .dcard h4{ margin:8px 0 8px; font-size:16.5px; letter-spacing:-.01em; }
  .dcard p{ margin:0; font-size:14px; color:var(--muted); }
  table{ width:100%; border-collapse:collapse; margin-top:22px; font-size:14px; }
  td{ border-bottom:1px solid var(--line); padding:11px 8px; vertical-align:baseline; }
  td:first-child{ width:74px; } td:nth-child(2){ width:190px; font-weight:650; }
  td:last-child{ color:var(--muted); }
  footer{ margin-top:44px; color:var(--muted); font-size:12.5px; font-family:var(--mono); }
  :where(a,button):focus-visible{ outline:2px solid var(--accent); outline-offset:2px; }
</style>

<div class="wrap">
  <header>
    <div class="label">Design review · captured from production</div>
    <h1>The video call<span class="dot">.</span><br />Seven real frames.</h1>
    <p class="sub">Every image below is a live call on ugly.chat, driven by real accounts with synthetic cameras.
      The green shapes are Chrome’s fake webcam — judge the frame around them, not the picture inside.
      Two critics reviewed these independently and landed on the same number.</p>
    <div class="verdicts">
      <div class="vcard"><div class="who">Dana · design</div><div class="score"><b>2</b> / 5</div>
        <div class="line">“A competent 1:1 skin wearing a group-call label.”</div></div>
      <div class="vcard"><div class="who">Vera · call experience</div><div class="score"><b>2</b> / 5</div>
        <div class="line">“Unchanged from my last pass.”</div></div>
      <div class="vcard"><div class="who">Agreement</div><div class="score"><b>3</b> / 3</div>
        <div class="line">Same top three, reached separately.</div></div>
    </div>
    <div class="converge">
      <h3>What both critics demanded, independently</h3>
      <ol>
        <li><b>Render every participant.</b> “3 in call” must produce three tiles — each with a name, a mute badge and a speaking ring.</li>
        <li><b>Get the composer off the control bar.</b> On mobile the text input and the call controls occupy the same pixels.</li>
        <li><b>Rank the controls.</b> End-call is the same orange as a toggle; mic and camera are the lowest-contrast objects in the bar.</li>
      </ol>
    </div>
  </header>

  ${sections.map(section).join('')}

  <section class="plan">
    <div class="skicker">The pass</div>
    <h2>What we’re changing</h2>
    <div class="dgrid">
      ${decisions.map(([k, h, p]) => `<div class="dcard"><div class="k">${k}</div><h4>${h}</h4><p>${p}</p></div>`).join('')}
    </div>
    <table>
      ${extra.map(([s, t, d]) => `<tr><td>${sevRow(s)}</td><td>${t}</td><td>${d}</td></tr>`).join('')}
    </table>
    <footer>ugly.chat · captured at 1280×800 and 390×844 · Vera drove both sides of every human call.</footer>
  </section>
</div>`;

writeFileSync(OUT, html);
console.log('wrote', OUT, (html.length / 1024 / 1024).toFixed(2), 'MB');
