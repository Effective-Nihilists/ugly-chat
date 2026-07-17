// Client-side custom-bot helpers: the model menu and the start-a-chat flow.
import type { AppSocket } from 'ugly-app/client';
import type { Avatar } from 'ugly-app/shared';
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

// Ugly Bot reply MODES (mirrors the old uglyBot mode menu). `chat` = the snarky
// default; `honest` = helpful, no roast; `lie` = satirical liar; `image` =
// generate an image from your prompt. The personas (honest/lie) only apply to
// the built-in Ugly Bot; custom bots use their own instruction.
// `desc` is the one-line hint shown under each mode in the composer picker — a
// newcomer had no idea what Honest/Lie/Chat meant, and a bare "Lie" is alarming
// without context.
export const BOT_MODES: { id: string; label: string; persona: boolean; desc: string }[] = [
  { id: 'chat', label: 'Chat', persona: true, desc: 'Normal conversation' },
  { id: 'honest', label: 'Honest', persona: true, desc: 'Blunt, no sugar-coating' },
  { id: 'lie', label: 'Lie', persona: true, desc: 'Deliberately, satirically false — for fun' },
  { id: 'image', label: 'Image', persona: false, desc: 'Generate an image from your prompt' },
  // Web search (cited answers) — runs the AnswerEngine via runBotSearch. Requires
  // ugly-app ≥ 0.1.863 (fixed web-search proxy op); before that it 400'd silently.
  { id: 'search', label: 'Search', persona: false, desc: 'Answer from the web, with citations' },
];

// Image-gen models ugly.bot serves (via /v1/ai/user-billed/image).
export const IMAGE_MODELS: { id: string; label: string }[] = [
  { id: 'flux_1_dev', label: 'Flux Dev' },
  { id: 'flux_1_pro', label: 'Flux Pro' },
  { id: 'nano_banana', label: 'Nano' },
  { id: 'nano_banana_pro', label: 'Nano Pro' },
];

// Image aspect ratios (maps to the proxy's `options.aspectRatio`).
export const IMAGE_SIZES: { id: string; label: string }[] = [
  { id: 'square', label: '1:1 Square' },
  { id: 'portrait_4_3', label: '3:4 Portrait' },
  { id: 'portrait_16_9', label: '9:16 Portrait' },
  { id: 'landscape_4_3', label: '4:3 Landscape' },
  { id: 'landscape_16_9', label: '16:9 Landscape' },
];

export interface BotDoc {
  _id: string;
  ownerId: string;
  name: string;
  avatar?: Avatar;
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
        image: bot.avatar?.image.uri ?? null,
      });
    }
    navigate(id);
  } catch (err) {
    console.error('[bots] startBotChat failed', err);
  }
}
