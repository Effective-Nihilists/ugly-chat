// Client-side custom-bot helpers: the model menu and the start-a-chat flow.
import type { AppSocket } from 'ugly-app/client';
import type { AppRegistry } from '../../shared/api';

type Socket = AppSocket<AppRegistry>;

// The open models ugly.bot serves directly for child apps (DeepSeek group).
// Other providers (Google/Anthropic/Groq/OpenRouter) aren't keyed for the
// app's proxy token, so they'd error — keep the menu to what actually works.
export const BOT_MODELS: { id: string; label: string }[] = [
  { id: 'deepseek_v4_flash', label: 'DeepSeek V4 Flash — fast, open, cheap' },
  { id: 'deepseek_v4_pro', label: 'DeepSeek V4 Pro — smarter, open' },
];

export interface BotDoc {
  _id: string;
  ownerId: string;
  name: string;
  avatarUrl?: string | null;
  backgroundUrl?: string | null;
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
        background: bot.backgroundUrl ?? null,
      });
    }
    navigate(id);
  } catch (err) {
    console.error('[bots] startBotChat failed', err);
  }
}
