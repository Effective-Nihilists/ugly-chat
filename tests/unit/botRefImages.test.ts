import { describe, it, expect, vi, beforeEach } from "vitest";
import { collections } from "../../shared/collections";
import {
  triggerBotReplies,
  extractRefImages,
  stripImageMarkdown,
  resolveImageModel,
  REF_ONLY_PROMPT,
  MAX_REF_IMAGES,
} from "../../server/bots";

describe("extractRefImages", () => {
  // The premise: attachments are already promoted to durable public https URLs
  // on send, so the URLs in the RAW message body are directly usable as the
  // image model's reference inputs — nothing is re-uploaded.
  it("pulls every attached image url out of a message body", () => {
    const body =
      "make a poster from these\n\n" +
      "![a.jpg](https://blob.ugly.chat/u1/a.jpg)\n\n" +
      "![b.jpg](https://blob.ugly.chat/u1/b.jpg)";
    expect(extractRefImages(body)).toEqual([
      "https://blob.ugly.chat/u1/a.jpg",
      "https://blob.ugly.chat/u1/b.jpg",
    ]);
  });

  it("dedupes the same image attached twice", () => {
    const url = "https://blob.ugly.chat/u1/a.jpg";
    expect(extractRefImages(`![a](${url})\n![a again](${url})`)).toEqual([url]);
  });

  it("caps the list so a 20-image paste can't be forwarded whole", () => {
    const body = Array.from(
      { length: 12 },
      (_, i) => `![x](https://blob.ugly.chat/u1/${i}.jpg)`,
    ).join("\n");
    expect(extractRefImages(body)).toHaveLength(MAX_REF_IMAGES);
  });

  it("ignores data: URIs and relative paths a provider could never fetch", () => {
    const body =
      "![inline](data:image/png;base64,AAAA)\n" +
      "![rel](/uploads/a.jpg)\n" +
      "![ok](https://blob.ugly.chat/u1/ok.jpg)";
    expect(extractRefImages(body)).toEqual([
      "https://blob.ugly.chat/u1/ok.jpg",
    ]);
  });

  it("ignores plain links — only embedded images are references", () => {
    expect(
      extractRefImages("see [the source](https://example.com/a.jpg)"),
    ).toEqual([]);
  });

  it("returns nothing for a text-only prompt", () => {
    expect(extractRefImages("a cat riding a bicycle")).toEqual([]);
  });
});

describe("stripImageMarkdown", () => {
  // Without this the prompt sent to the model was literally
  // "[image] [image] make it snowier" — sanitizeHistoryContent's placeholders
  // leaking into an image prompt.
  it("leaves only the typed instruction", () => {
    const body = "![a.jpg](https://blob.ugly.chat/u1/a.jpg)\n\nmake it snowier";
    expect(stripImageMarkdown(body)).toBe("make it snowier");
  });

  it("is empty when the user attached images and typed nothing", () => {
    expect(
      stripImageMarkdown("![a.jpg](https://blob.ugly.chat/u1/a.jpg)"),
    ).toBe("");
  });

  it("keeps normal links and text intact", () => {
    expect(stripImageMarkdown("like [this](https://x.test) but blue")).toBe(
      "like [this](https://x.test) but blue",
    );
  });
});

describe("resolveImageModel", () => {
  // Silently ignoring the user's reference photos is the failure this prevents:
  // most image models accept `options.images` and drop them, so the user gets an
  // unrelated picture and is billed for it with no clue why.
  it("leaves the picked model alone when there are no references", () => {
    expect(resolveImageModel("flux_1_dev", 0)).toEqual({
      model: "flux_1_dev",
      notice: "",
    });
  });

  it("keeps a ref-capable model as picked", () => {
    expect(resolveImageModel("seedream", 3)).toEqual({
      model: "seedream",
      notice: "",
    });
  });

  it("substitutes a ref-capable model AND says so when refs are attached", () => {
    const out = resolveImageModel("flux_1_dev", 2);
    expect(out.model).toBe("seedream");
    expect(out.notice).toContain("flux_1_dev");
    expect(out.notice).not.toBe("");
  });
});

// ── The whole path, through triggerBotReplies ────────────────────────────────

const created = vi.fn();
vi.mock("ugly-app/conversation/engine", () => ({
  conversationMessageCreate: (...args: unknown[]) => {
    created(...args);
    return Promise.resolve();
  },
}));
vi.mock("ugly-app/server/adapter/workers", () => ({
  getUserToken: () => "test-token",
  // No storage adapter → persistGeneratedImage passes the URL straight through.
  getAppContext: () => ({}),
}));
vi.mock("../../server/listDenorm", () => ({
  bumpListForMessage: () => Promise.resolve(),
}));

function makeDb(
  messages: Record<string, unknown>[],
  botCfg: Record<string, unknown>,
) {
  return {
    async getDoc(collection: unknown, id: string) {
      if (collection === collections.conversation && id === "c1")
        return { _id: "c1", type: "bot", bots: { "bot-ugly": botCfg } };
      if (collection === collections.bot && id === "bot-ugly")
        return {
          _id: "bot-ugly",
          name: "Ugly Bot",
          model: "deepseek_v4_flash",
        };
      return null;
    },
    async getDocs(collection: unknown) {
      return collection === collections.message ? messages : [];
    },
  };
}

describe("triggerBotReplies — image mode with reference images", () => {
  let lastBody: {
    model: string;
    prompt: string;
    options: { images?: string[]; aspectRatio?: string };
  } | null = null;

  beforeEach(() => {
    lastBody = null;
    created.mockClear();
    vi.stubGlobal("fetch", (_url: string, init: { body: string }) => {
      lastBody = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ url: "https://blob.ugly.bot/out.png", usage: {} }),
      } as Response);
    });
  });

  const message = (text: string) => [
    { _id: "m1", conversationId: "c1", userId: "u1", text, created: 1 },
  ];

  it("sends the attached images as reference inputs, not as prompt text", async () => {
    await triggerBotReplies(
      makeDb(
        message(
          "![a.jpg](https://blob.ugly.chat/u1/a.jpg)\n\n" +
            "![b.jpg](https://blob.ugly.chat/u1/b.jpg)\n\n" +
            "put them on a surfboard",
        ),
        { mode: "image", imageModel: "seedream" },
      ) as never,
      { conversation: collections.conversation, message: collections.message },
      "c1",
      "u1",
    );

    expect(lastBody).not.toBeNull();
    expect(lastBody!.options.images).toEqual([
      "https://blob.ugly.chat/u1/a.jpg",
      "https://blob.ugly.chat/u1/b.jpg",
    ]);
    // The prompt must be the typed instruction — NOT sanitizeHistoryContent's
    // "[image: a.jpg] [image: b.jpg] put them on a surfboard".
    expect(lastBody!.prompt).toBe("put them on a surfboard");
  });

  it("omits `images` entirely for a plain text-to-image prompt", async () => {
    await triggerBotReplies(
      makeDb(message("a cat on a bicycle"), {
        mode: "image",
        imageModel: "flux_1_dev",
      }) as never,
      { conversation: collections.conversation, message: collections.message },
      "c1",
      "u1",
    );
    expect(lastBody!.options.images).toBeUndefined();
    expect(lastBody!.model).toBe("flux_1_dev");
  });

  it("draws with a ref-capable model, and tells the user, when the picked one can't", async () => {
    await triggerBotReplies(
      makeDb(
        message("![a.jpg](https://blob.ugly.chat/u1/a.jpg)\n\nmake it snowier"),
        { mode: "image", imageModel: "flux_1_dev" },
      ) as never,
      { conversation: collections.conversation, message: collections.message },
      "c1",
      "u1",
    );
    expect(lastBody!.model).toBe("seedream");
    const posted = created.mock.calls[0]?.[0] as {
      message: { markdown: string };
    };
    expect(posted.message.markdown).toContain("![make it snowier](");
    expect(posted.message.markdown).toContain("flux_1_dev");
  });

  it("accepts images with no words instead of asking what to draw", async () => {
    await triggerBotReplies(
      makeDb(message("![a.jpg](https://blob.ugly.chat/u1/a.jpg)"), {
        mode: "image",
        imageModel: "seedream",
      }) as never,
      { conversation: collections.conversation, message: collections.message },
      "c1",
      "u1",
    );
    expect(lastBody).not.toBeNull();
    expect(lastBody!.prompt).toBe(REF_ONLY_PROMPT);
    expect(lastBody!.options.images).toHaveLength(1);
  });

  it("still asks what to draw when the message is genuinely empty", async () => {
    await triggerBotReplies(
      makeDb(message(""), { mode: "image", imageModel: "seedream" }) as never,
      { conversation: collections.conversation, message: collections.message },
      "c1",
      "u1",
    );
    expect(lastBody).toBeNull();
    const posted = created.mock.calls[0]?.[0] as {
      message: { markdown: string };
    };
    expect(posted.message.markdown).toContain("Tell me what to draw");
  });
});
