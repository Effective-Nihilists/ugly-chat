import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installBrowserEmbedBridge,
  onBrowserAction,
  onBrowserConversationSelection,
  onBrowserConversationSelection,
  publishBrowserConversations,
  resetBrowserEmbedForTests,
} from "../../client/lib/browserEmbed";

afterEach(() => {
  resetBrowserEmbedForTests();
  vi.unstubAllGlobals();
});

describe("embedded browser contract", () => {
  it("publishes only bounded navigation metadata", () => {
    let contextListener: ((value: unknown) => void) | undefined;
    const publishConversations = vi.fn();
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (listener: (value: unknown) => void) => {
          contextListener = listener;
          return () => undefined;
        },
        onSelectConversation: () => () => undefined,
        publishConversations,
      },
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        toggleAttribute: vi.fn(),
      },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "dark", token: "secret" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.toggleAttribute).toHaveBeenCalledWith(
      "data-browser-embedded",
      true,
    );
    publishBrowserConversations(
      [
        {
          id: "conversation\u0000\u202e-1",
          title: "Plan\u2066ning",
          unread: 4,
          messages: ["secret"],
        } as never,
      ],
      "conversation\u0000\u202e-1",
    );
    expect(publishConversations).toHaveBeenCalledWith({
      conversations: [{ id: "conversation-1", title: "Planning", unread: 4 }],
      activeConversationId: "conversation-1",
      complete: true,
    });
    expect(JSON.stringify(publishConversations.mock.calls)).not.toContain(
      "secret",
    );
  });

  it("deduplicates metadata, clamps unread, and rejects an unknown active id", () => {
    let contextListener: ((value: unknown) => void) | undefined;
    const publishConversations = vi.fn();
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (listener: (value: unknown) => void) => {
          contextListener = listener;
          return () => undefined;
        },
        publishConversations,
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {}, toggleAttribute: vi.fn() },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });
    publishBrowserConversations(
      [
        { id: "one", title: "", unread: Number.NaN },
        { id: "one", title: "Duplicate", unread: 2 },
        { id: "two", title: "Two", unread: 5000 },
      ],
      "missing",
    );
    expect(publishConversations).toHaveBeenCalledWith({
      conversations: [
        { id: "one", title: "Conversation", unread: 0 },
        { id: "two", title: "Two", unread: 999 },
      ],
      activeConversationId: null,
      complete: true,
    });
  });

  it("marks a capped feed incomplete so absence cannot be called deletion", () => {
    let contextListener: ((value: unknown) => void) | undefined;
    const publishConversations = vi.fn();
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (listener: (value: unknown) => void) => {
          contextListener = listener;
          return () => undefined;
        },
        publishConversations,
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {}, toggleAttribute: vi.fn() },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });
    publishBrowserConversations(
      Array.from({ length: 25 }, (_, index) => ({
        id: `c-${index}`,
        title: `Chat ${index}`,
        unread: 0,
      })),
      null,
    );
    expect(publishConversations).toHaveBeenCalledWith(
      expect.objectContaining({
        complete: false,
        conversations: expect.any(Array),
      }),
    );
    expect(publishConversations.mock.calls[0][0].conversations).toHaveLength(
      24,
    );
  });

  it("forwards only bounded stable conversation selections", () => {
    let selectListener: ((value: string) => void) | undefined;
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: () => () => undefined,
        onSelectConversation: (listener: (value: string) => void) => {
          selectListener = listener;
          return () => undefined;
        },
      },
    });
    installBrowserEmbedBridge();
    selectListener?.(`  ${"x".repeat(200)}  `);
    const selected = vi.fn();
    onBrowserConversationSelection(selected);
    expect(selected).toHaveBeenCalledWith("x".repeat(160));
  });
});

/**
 * What the browser's Chats section draws each row from.
 *
 * Three separate reports, one publisher:
 *  • "the chat list is not populating" — `complete` was sent as
 *    `length <= MAX`, a TRUNCATION flag that is trivially true for the empty
 *    list held while `conversationListMine` is still in flight. The browser
 *    reads it as "this is the whole list", stops waiting and drops the guest.
 *    `loaded` is the honest flag: the request came back.
 *  • "the second line should show last message received" — never sent at all,
 *    so the browser had nothing to draw but the word "Conversation".
 *  • "each chat row should have a valid icon" — likewise, so every row wore the
 *    same generic glyph.
 */
describe("what the browser needs to draw a row", () => {
  it("sends the last message, the artwork and an honest loaded flag", () => {
    const publishConversations = vi.fn();
    let contextListener: ((raw: unknown) => void) | undefined;
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (cb: (raw: unknown) => void) => {
          contextListener = cb;
        },
        onSelectConversation: () => {},
        publishConversations,
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {}, toggleAttribute: vi.fn() },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });

    publishBrowserConversations(
      [
        {
          id: "c1",
          title: "Sebrina Somers",
          unread: 0,
          lastMessage: "see you at six",
          image: "https://blob.ugly.bot/a.png",
        },
      ],
      null,
      true,
    );
    expect(publishConversations).toHaveBeenCalledWith({
      conversations: [
        {
          id: "c1",
          title: "Sebrina Somers",
          unread: 0,
          lastMessage: "see you at six",
          image: "https://blob.ugly.bot/a.png",
        },
      ],
      activeConversationId: null,
      complete: true,
      loaded: true,
    });
  });

  it("never claims to have loaded a list it is still fetching", () => {
    const publishConversations = vi.fn();
    let contextListener: ((raw: unknown) => void) | undefined;
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (cb: (raw: unknown) => void) => {
          contextListener = cb;
        },
        onSelectConversation: () => {},
        publishConversations,
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {}, toggleAttribute: vi.fn() },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });

    // The state every mount starts in: empty, because the request is in flight.
    publishBrowserConversations([], null, false);
    expect(publishConversations).toHaveBeenCalledWith({
      conversations: [],
      activeConversationId: null,
      complete: true,
      loaded: false,
    });
  });

  it("bounds and strips the preview like every other field", () => {
    const publishConversations = vi.fn();
    let contextListener: ((raw: unknown) => void) | undefined;
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (cb: (raw: unknown) => void) => {
          contextListener = cb;
        },
        onSelectConversation: () => {},
        publishConversations,
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {}, toggleAttribute: vi.fn() },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });

    publishBrowserConversations(
      [
        {
          id: "c1",
          title: "T",
          unread: 0,
          lastMessage: `spoof‮evil${"x".repeat(400)}`,
          image: 42 as never,
        },
      ],
      null,
      true,
    );
    const row = publishConversations.mock.calls[0][0].conversations[0];
    expect(row.lastMessage).not.toContain("‮");
    expect(row.lastMessage.length).toBeLessThanOrEqual(160);
    // Artwork that is not a string is simply absent — never a broken <img>.
    expect(row.image).toBeUndefined();
  });
});

/**
 * "If I select a conversation, then I cannot select a different one."
 *
 * The browser sends one `chat-select` per click — verified against the real
 * chrome: clicking a second row does send `chat-select` for that row. So the
 * failure is on this side of the bridge, and this pins the contract the browser
 * is relying on: EVERY select must reach the current subscriber, not just the
 * first, and a resubscribe (which happens on every navigation, because the
 * router object changes identity with the route) must not drop the next one.
 */
describe("selecting a second conversation", () => {
  function embedded() {
    let selectListener: ((raw: unknown) => void) | undefined;
    let contextListener: ((raw: unknown) => void) | undefined;
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (cb: (raw: unknown) => void) => {
          contextListener = cb;
        },
        onSelectConversation: (cb: (raw: unknown) => void) => {
          selectListener = cb;
        },
        publishConversations: vi.fn(),
      },
    });
    vi.stubGlobal("document", {
      documentElement: { dataset: {}, toggleAttribute: vi.fn() },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });
    return { select: (id: string) => selectListener?.(id) };
  }

  it("navigates on every selection, not only the first", () => {
    const { select } = embedded();
    const navigated: string[] = [];
    onBrowserConversationSelection((id) => navigated.push(id));
    select("conv-a");
    select("conv-b");
    select("conv-a");
    expect(navigated).toEqual(["conv-a", "conv-b", "conv-a"]);
  });

  it("keeps delivering across the resubscribe every navigation causes", () => {
    const { select } = embedded();
    const navigated: string[] = [];
    // What the bridge component does on each route change: drop the listener
    // closed over the old router, add one closed over the new.
    let stop = onBrowserConversationSelection((id) => navigated.push(id));
    select("conv-a");
    stop();
    stop = onBrowserConversationSelection((id) => navigated.push(id));
    select("conv-b");
    stop();
    onBrowserConversationSelection((id) => navigated.push(id));
    select("conv-c");
    expect(navigated).toEqual(["conv-a", "conv-b", "conv-c"]);
  });
});

/**
 * "Chat in sidebar panel should use the same background color as the
 * ugly-studio frame."
 *
 * The companion painted its own white against the browser's grey, so the panel
 * read as a foreign window pasted into the sidebar rather than part of it. The
 * theme NAME cannot fix that — light/dark says which palette, not which grey,
 * and the two apps do not share one — so the browser sends its actual frame
 * colour and this applies it.
 *
 * It is still a string from outside this app being written into a stylesheet,
 * so only ordinary colour literals are taken.
 */
describe("the frame colour the browser sends", () => {
  function embed(raw: Record<string, unknown>) {
    // Each case installs the bridge again, and the install is once-only.
    resetBrowserEmbedForTests();
    const setProperty = vi.fn();
    let contextListener: ((value: unknown) => void) | undefined;
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (cb: (value: unknown) => void) => {
          contextListener = cb;
        },
        onSelectConversation: () => {},
        publishConversations: vi.fn(),
      },
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        toggleAttribute: vi.fn(),
        style: { setProperty },
      },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light", ...raw });
    return setProperty;
  }

  it("paints the browser's own background", () => {
    const setProperty = embed({ frame: "#f2f2f4" });
    expect(setProperty).toHaveBeenCalledWith("--app-main", "#f2f2f4");
    expect(setProperty).toHaveBeenCalledWith("--app-sidebar", "#f2f2f4");
  });

  it("accepts the ordinary colour spellings", () => {
    expect(embed({ frame: "rgb(242, 242, 244)" })).toHaveBeenCalledWith(
      "--app-main",
      "rgb(242, 242, 244)",
    );
    expect(embed({ frame: "#FFF" })).toHaveBeenCalledWith("--app-main", "#FFF");
  });

  it("ignores anything that is not one", () => {
    for (const frame of [
      "url(https://example.com/x.png)",
      "red; background-image: url(x)",
      "var(--anything)",
      "expression(alert(1))",
      42,
      "",
    ]) {
      const setProperty = embed({ frame });
      expect(setProperty).not.toHaveBeenCalledWith(
        "--app-main",
        expect.anything(),
      );
    }
  });

  it("leaves the app's own colours alone when the browser sends none", () => {
    const setProperty = embed({});
    expect(setProperty).not.toHaveBeenCalledWith(
      "--app-main",
      expect.anything(),
    );
  });
});

/**
 * Pin, remove and new chat, asked for from the browser's sidebar.
 *
 * The browser draws the conversation list but holds no Chat credentials, so it
 * cannot pin or delete anything itself — each press arrives here as a request
 * and THIS app makes the same call its own sidebar makes. What crosses the
 * bridge is therefore an instruction from outside, and is treated like one:
 * unknown verbs are dropped rather than passed along to be interpreted.
 */
describe("actions from the browser's sidebar", () => {
  function embedded() {
    resetBrowserEmbedForTests();
    let actionListener: ((raw: unknown) => void) | undefined;
    let contextListener: ((raw: unknown) => void) | undefined;
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (cb: (raw: unknown) => void) => {
          contextListener = cb;
        },
        onSelectConversation: () => {},
        onAction: (cb: (raw: unknown) => void) => {
          actionListener = cb;
        },
        publishConversations: vi.fn(),
      },
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        toggleAttribute: vi.fn(),
        style: { setProperty: vi.fn() },
      },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });
    return { send: (raw: unknown) => actionListener?.(raw) };
  }

  it("delivers each request the browser makes", () => {
    const { send } = embedded();
    const got: unknown[] = [];
    onBrowserAction((action) => got.push(action));
    send({ type: "pin", conversationId: "c1" });
    send({ type: "unpin", conversationId: "c1" });
    send({ type: "remove", conversationId: "c2" });
    expect(got).toEqual([
      { type: "pin", conversationId: "c1" },
      { type: "unpin", conversationId: "c1" },
      { type: "remove", conversationId: "c2" },
    ]);
  });

  it("holds a request made before this app was listening", () => {
    const { send } = embedded();
    send({ type: "pin", conversationId: "c1" });
    const got: unknown[] = [];
    onBrowserAction((action) => got.push(action));
    // A button that did nothing because the app was still mounting is the same
    // to the user as a button that is broken.
    expect(got).toEqual([{ type: "pin", conversationId: "c1" }]);
  });

  it("drops anything that is not one of the three", () => {
    const { send } = embedded();
    const got: unknown[] = [];
    onBrowserAction((action) => got.push(action));
    send({ type: "delete-everything", conversationId: "c1" });
    send({ type: "new" });
    send({ type: "pin" });
    send({ type: "remove", conversationId: "   " });
    send(null);
    send("pin");
    expect(got).toEqual([]);
  });

  it("publishes the pinned state the browser's row reflects", () => {
    const publishConversations = vi.fn();
    let contextListener: ((raw: unknown) => void) | undefined;
    resetBrowserEmbedForTests();
    vi.stubGlobal("window", {
      uglyBrowser: {
        onContext: (cb: (raw: unknown) => void) => {
          contextListener = cb;
        },
        onSelectConversation: () => {},
        onAction: () => {},
        publishConversations,
      },
    });
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {},
        toggleAttribute: vi.fn(),
        style: { setProperty: vi.fn() },
      },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: "light" });
    publishBrowserConversations(
      [
        { id: "c1", title: "Pinned", unread: 0, pinned: true },
        { id: "c2", title: "Ordinary", unread: 0 },
      ],
      null,
      true,
    );
    const rows = publishConversations.mock.calls[0][0].conversations;
    expect(rows[0].pinned).toBe(true);
    expect(rows[1].pinned).toBeUndefined();
  });
});
