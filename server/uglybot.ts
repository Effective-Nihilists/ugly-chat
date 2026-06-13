/**
 * Workers-safe call to ugly.bot's `/request` op dispatcher (textGen, profile
 * lookups, etc.). Importing `uglyBotRequest` from the 'ugly-app' main entry
 * would drag the Node server into the Workers bundle, so we inline a fetch.
 */
export async function uglyBotRequest<T>(op: string, input: unknown): Promise<T> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const base = env['UGLY_BOT_LOCAL'] === '1' ? 'http://localhost:3000' : env['UGLY_BOT_URL'] ?? 'https://ugly.bot';
  const token = env['UGLY_BOT_TOKEN'];
  if (!token) throw new Error('UGLY_BOT_TOKEN not set');
  const res = await fetch(`${base}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, input, sessionId: 'server' }),
  });
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}`);
  const data = (await res.json()) as { result?: T } & T;
  // ugly.bot wraps op results as { result } over /request in some paths.
  return (data.result ?? data) as T;
}
