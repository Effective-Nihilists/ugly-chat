import React, { useState } from 'react';
import { Button, Card, Input, PageLayout, useApp } from 'ugly-app/client';
import { initPush, requestPushPermission } from '../push';

interface LogEntry {
  ts: number;
  msg: string;
  kind: 'info' | 'ok' | 'err';
}

export default function PushTestPage(): React.ReactElement {
  const { socket, userId } = useApp();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [targetUserId, setTargetUserId] = useState(userId);
  const [title, setTitle] = useState('Test Notification');
  const [body, setBody] = useState('Hello from ugly-app!');
  const [loading, setLoading] = useState(false);

  function addLog(msg: string, kind: LogEntry['kind'] = 'info') {
    const prefix = '[PushTest]';
    if (kind === 'err') console.error(prefix, msg);
    else console.log(prefix, msg);
    setLogs((prev) => [...prev, { ts: Date.now(), msg, kind }]);
  }

  function fmt(ms: number): string {
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }

  async function handleInit() {
    setLoading(true);
    const started = Date.now();
    try {
      addLog('Checking push registration...');
      const result = await initPush();
      setRegistered(result.registered);
      addLog(
        result.registered
          ? `Device is registered for push (${fmt(Date.now() - started)})`
          : `Device is NOT registered (${fmt(Date.now() - started)})`,
        result.registered ? 'ok' : 'info',
      );
    } catch (err) {
      addLog(`Init failed in ${fmt(Date.now() - started)}: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister() {
    setLoading(true);
    const started = Date.now();
    try {
      addLog('Requesting push permission...');
      const result = await requestPushPermission();
      if (result.success) {
        setRegistered(true);
        addLog(`Push registered in ${fmt(Date.now() - started)}`, 'ok');
      } else {
        addLog(`Registration failed in ${fmt(Date.now() - started)}: ${result.error ?? 'unknown'}`, 'err');
      }
    } catch (err) {
      addLog(`Register failed in ${fmt(Date.now() - started)}: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  async function handleSend() {
    if (!targetUserId.trim() || !title.trim()) return;
    setLoading(true);
    const started = Date.now();
    try {
      addLog(`Sending push to ${targetUserId} — "${title.trim()}"...`);
      const result = await socket.request('sendPush', {
        targetUserId: targetUserId.trim(),
        title: title.trim(),
        body: body.trim(),
        path: '',
      });
      const sent = (result as { sent: boolean }).sent;
      addLog(
        sent
          ? `Push sent in ${fmt(Date.now() - started)}`
          : `Push not delivered in ${fmt(Date.now() - started)} (no devices?)`,
        sent ? 'ok' : 'err',
      );
    } catch (err) {
      addLog(`Send failed in ${fmt(Date.now() - started)}: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageLayout
      header={
        <div>
          <a href="/test">← Tests</a>
        </div>
      }
    >
      <div>
        <h1>Push Notification Test</h1>

        <Card>
          <h2>1. Check Registration</h2>
          <p style={{ opacity: 0.7, marginBottom: 8 }}>
            Status: {registered === null ? 'unknown' : registered ? 'registered' : 'not registered'}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => { void handleInit(); }} disabled={loading}>
              Check Status
            </Button>
            {registered === false && (
              <Button onClick={() => { void handleRegister(); }} disabled={loading}>
                Register for Push
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <h2>2. Send Test Push</h2>
          <Input
            label="Target User ID"
            value={targetUserId}
            onChange={setTargetUserId}
            placeholder="user ID to send to"
          />
          <Input label="Title" value={title} onChange={setTitle} />
          <Input label="Body" value={body} onChange={setBody} />
          <Button
            onClick={() => { void handleSend(); }}
            disabled={loading || !targetUserId.trim() || !title.trim()}
          >
            {loading ? 'Sending...' : 'Send Push'}
          </Button>
        </Card>

        {logs.length > 0 && (
          <div style={{ marginTop: 16 }}>
            {logs.map((entry, i) => (
              <div key={i} style={{ fontSize: '0.85em' }}>
                {entry.kind === 'err' ? '✗' : entry.kind === 'ok' ? '✓' : '·'}{' '}
                {entry.msg}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageLayout>
  );
}
