// bot-search — a Perplexity-style search bot built on ugly-app/search.
//
// Runs the shared AnswerEngine (web retrieval → cited answer) and streams the
// reply through the conversation hub via runSearchReply. The final cited message
// is persisted once (commit) with its sources in `custom.sources`, and shows up
// live for everyone watching the conversation.

import { nanoid } from 'nanoid';
import { conversationMessageCreate } from 'ugly-app/conversation/engine';
import {
  AnswerEngine,
  WebRetriever,
  runSearchReply,
  type ModelCaller,
} from 'ugly-app/search/server';
import type { MsgTelemetry } from 'ugly-app/conversation/shared';

export const SEARCH_BOT_ID = 'bot-search';

/**
 * Show only the sources the answer actually CITES, renumbering `[n]` to match.
 * Exported for unit-testing.
 *
 * The engine reads its top-N sources and passes all of them along; the model
 * often cites just a couple, so the card list showed retrieved-but-unused
 * sources (sometimes off-topic) beside the cited ones. Simply dropping the
 * uncited cards would break the `[n]↔card` mapping, so we renumber the citations
 * too: cited sources are kept in order and re-labelled `[1]..[k]`.
 */
export function trimToCitedSources<T>(
  text: string,
  sources: T[] | undefined,
): { text: string; sources: T[] | undefined } {
  if (!sources || sources.length === 0) return { text, sources };
  const cited = [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])))]
    .filter((n) => n >= 1 && n <= sources.length)
    .sort((a, b) => a - b);
  // Nothing cited, or everything read was cited → leave it (numbers already line up).
  if (cited.length === 0 || cited.length === sources.length) return { text, sources };
  const remap = new Map(cited.map((old, i) => [old, i + 1]));
  const newText = text.replace(/\[(\d+)\]/g, (m, d: string) => {
    const n = remap.get(Number(d));
    return n ? `[${n}]` : m;
  });
  return { text: newText, sources: cited.map((n) => sources[n - 1]!) };
}

interface ChatTurn { role: 'system' | 'user' | 'assistant'; content: string }
type TextGen = (
  model: string,
  messages: ChatTurn[],
  maxTokens: number,
) => Promise<{ text: string; usage: MsgTelemetry }>;

export interface RunBotSearchOptions {
  conversationId: string;
  botId: string;
  /** Conversation history, oldest→newest; the last turn is the query. */
  history: ChatTurn[];
  model: string;
  textGen: TextGen;
  mode?: 'quick' | 'deep';
  /**
   * The chatting user's session JWT + id. Web retrieval runs through the same
   * ugly.bot proxy as textGen and must be billed to the user; without these the
   * retriever calls the proxy unauthenticated (owner token only) and, when no
   * app token is set, every retrieval throws → the engine answers "no sources".
   */
  userToken?: string;
  userId?: string;
}

export async function runBotSearch(opts: RunBotSearchOptions): Promise<void> {
  const query = opts.history[opts.history.length - 1]?.content ?? '';
  if (!query) return;

  const messageId = nanoid();
  // The streamed msgId MUST equal the eventual doc _id so the client dedupes the
  // live placeholder against the committed doc.
  const msgId = `${opts.conversationId}:${messageId}`;

  const model: ModelCaller = {
    complete: async ({ model: m, messages, maxTokens }) => {
      // Floor the answer budget at 2048 — cited answers over several sources were
      // being cut off mid-sentence (dangling "**") at the old 1024 default.
      const out = await opts.textGen(m, messages, Math.max(maxTokens ?? 0, 2048));
      return { text: out.text, telemetry: out.usage };
    },
  };

  const engine = new AnswerEngine({
    model,
    retrievers: [
      new WebRetriever(undefined, {
        ...(opts.userToken !== undefined ? { userToken: opts.userToken } : {}),
        ...(opts.userId !== undefined ? { userId: opts.userId } : {}),
      }),
    ],
    defaultModel: opts.model,
  });

  await runSearchReply(
    { conversationId: opts.conversationId, msgId, authorId: opts.botId, kind: 'bot' },
    {
      engine,
      hubOptions: { collection: 'message', keyField: 'conversationId' },
      persist: {
        commit: async (m) => {
          // Trim the shown sources to the ones the answer cites, renumbering [n].
          const { text, sources } = trimToCitedSources(m.text, m.sources);
          await conversationMessageCreate(
            {
              conversationId: opts.conversationId,
              message: {
                id: messageId,
                text,
                markdown: text,
                ...(sources ? { custom: { sources } } : {}),
                ...(m.telemetry ? { telemetry: m.telemetry } : {}),
              },
            },
            opts.botId,
          );
        },
      },
    },
    {
      query,
      history: opts.history.slice(0, -1),
      model: opts.model,
      mode: opts.mode ?? 'quick',
    },
  );
}
