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

type ChatTurn = { role: 'system' | 'user' | 'assistant'; content: string };
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
      const out = await opts.textGen(m, messages, maxTokens ?? 1024);
      return { text: out.text, telemetry: out.usage };
    },
  };

  const engine = new AnswerEngine({
    model,
    retrievers: [new WebRetriever()],
    defaultModel: opts.model,
  });

  await runSearchReply(
    { conversationId: opts.conversationId, msgId, authorId: opts.botId, kind: 'bot' },
    {
      engine,
      hubOptions: { collection: 'message', keyField: 'conversationId' },
      persist: {
        commit: async (m) => {
          await conversationMessageCreate(
            {
              conversationId: opts.conversationId,
              message: {
                id: messageId,
                text: m.text,
                markdown: m.text,
                onlyUserIds: ['global'],
                ...(m.sources ? { custom: { sources: m.sources } } : {}),
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
