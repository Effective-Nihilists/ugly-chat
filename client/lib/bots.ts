// Client-side custom-bot helpers: the model menu and the start-a-chat flow.
import type { AppSocket } from 'ugly-app/client';
import type { AppRegistry } from '../../shared/api';

type Socket = AppSocket<AppRegistry>;

// Models ugly.bot serves for user-billed bot replies (the reply path calls
// /v1/ai/user-billed/text, which reaches every provider keyed on the live
// worker). Anthropic routes via OpenRouter (direct access dropped). Kept to
// providers verified working on the live worker.
export const BOT_MODELS: { id: string; label: string }[] = [
  { id: 'deepseek_v4_flash', label: 'DeepSeek V4 Flash — fast, open, cheap' },
  { id: 'deepseek_v4_pro', label: 'DeepSeek V4 Pro — smarter, open' },
  { id: 'gpt_4o', label: 'GPT-4o — OpenAI' },
  { id: 'gpt_5', label: 'GPT-5 — OpenAI' },
  { id: 'claude_sonnet_4_6', label: 'Claude Sonnet 4.6 — via OpenRouter' },
  { id: 'claude_opus_4_7', label: 'Claude Opus 4.7 — via OpenRouter' },
  { id: 'gemini_2_5', label: 'Gemini 2.5 — Google' },
  { id: 'llama_4_scout', label: 'Llama 4 Scout — Groq' },
  { id: 'qwen3_max_thinking', label: 'Qwen3 Max (thinking)' },
];

// Short, human display name for a model id (e.g. the chat header subtitle and
// per-message receipts). Derived from BOT_MODELS — the part before the em-dash —
// so it stays in sync with the picker. Falls back to the raw id so an unknown
// model still shows *something real* rather than a fabricated label.
const MODEL_LABELS: Record<string, string> = Object.fromEntries(
  BOT_MODELS.map((m) => [m.id, (m.label.split('—')[0] ?? m.label).trim()]),
);
export function modelLabel(id: string | null | undefined): string {
  if (!id) return '';
  return MODEL_LABELS[id] ?? id;
}

export interface BotDoc {
  _id: string;
  ownerId: string;
  name: string;
  avatarUrl?: string | null;
  instruction?: string;
  model?: string;
  firstMessage?: string | null;
  buttons?: { label: string; prompt: string }[];
}

/**
 * Open (or create) the current user's 1:1 conversation with a bot, then
 * navigate to it. One stable room per (bot, user): `bc-<botId>-<userId>`.
 */
export async function startBotChat(
  socket: Socket,
  userId: string,
  bot: BotDoc,
  navigate: (conversationId: string) => void,
): Promise<void> {
  const id = `bc-${bot._id}-${userId}`;
  try {
    const existing = await socket.getDoc('conversation', id);
    if (!existing) {
      await socket.request('conversationCreate', {
        id,
        type: 'group',
        title: bot.name,
        mode: 'public',
        ownerIds: [userId],
        bots: { [bot._id]: {} },
        image: bot.avatarUrl ?? null,
      });
    }
    navigate(id);
  } catch (err) {
    console.error('[bots] startBotChat failed', err);
  }
}
