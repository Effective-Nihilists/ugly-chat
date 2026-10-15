import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserShareFromHash,
  browserShareMarkdown,
  browserDraftSources,
  normalizeBrowserShare,
} from "../../client/lib/browserShare";

describe("browser share", () => {
  it("accepts only bounded web URLs", () => {
    expect(
      normalizeBrowserShare({
        id: "1",
        title: "",
        url: "https://example.com/a",
      }),
    ).toEqual({
      id: "1",
      title: "example.com",
      url: "https://example.com/a",
    });
    expect(
      normalizeBrowserShare({
        id: "2",
        title: "Private",
        url: "file:///tmp/a",
      }),
    ).toBeNull();
  });

  it("creates an escaped markdown link for the unsent draft", () => {
    expect(
      browserShareMarkdown({
        id: "1",
        title: "A [useful] page",
        url: "https://example.com/a_(b)",
      }),
    ).toBe("[A \\[useful\\] page](https://example.com/a_%28b%29)");
  });

  it("adds selected text as a bounded blockquote", () => {
    const share = normalizeBrowserShare({
      id: "3",
      title: "Source",
      url: "https://example.com",
      excerpt: ` first line\nsecond line ${"x".repeat(1300)}`,
    });
    expect(share?.excerpt?.length).toBe(1200);
    expect(browserShareMarkdown(share!)).toContain(
      "[Source](https://example.com/)\n\n> first line\n> second line",
    );
  });

  it("accepts only a bounded JPEG screenshot", () => {
    const jpeg = "data:image/jpeg;base64,abc";
    expect(
      normalizeBrowserShare({
        id: "4",
        title: "Page",
        url: "https://example.com",
        screenshot: { dataUrl: jpeg, name: "capture.jpg" },
      })?.screenshot,
    ).toEqual({ dataUrl: jpeg, name: "capture.jpg" });
    expect(
      normalizeBrowserShare({
        id: "5",
        title: "Page",
        url: "https://example.com",
        screenshot: {
          dataUrl: "data:image/png;base64,abc",
          name: "capture.png",
        },
      }),
    ).not.toHaveProperty("screenshot");
  });

  it("renders only strict sanitized selected-tab metadata as attributed sources", () => {
    expect(
      browserDraftSources({
        id: "tabs",
        title: "First",
        url: "https://one.test/?q=kept&token=drop#hidden",
        excerpt:
          "Sec\u202eond — https://user:pass@two.test/path?state=drop&q=kept#hidden\nThird — https://three.test/",
      }),
    ).toEqual([
      { title: "First", url: "https://one.test/?q=kept" },
      { title: "Second", url: "https://two.test/path?q=kept" },
      { title: "Third", url: "https://three.test/" },
    ]);
    expect(
      browserDraftSources({
        id: "quote",
        title: "Page",
        url: "https://one.test/",
        excerpt: "ordinary selected text",
      }),
    ).toEqual([]);
  });

  it("accepts the server-private native mobile fragment", () => {
    expect(
      browserShareFromHash(
        "#ugly-browser-share?id=m1&title=Page&url=https%3A%2F%2Fexample.com%2Fa&excerpt=quote",
      ),
    ).toEqual({
      id: "m1",
      title: "Page",
      url: "https://example.com/a",
      excerpt: "quote",
    });
    expect(browserShareFromHash("#not-a-share")).toBeNull();
  });

  describe("installBrowserShareBridge", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    const stubPage = (uglyBrowser: Record<string, unknown>) => {
      vi.stubGlobal("window", { uglyBrowser, addEventListener: vi.fn() });
      vi.stubGlobal("location", { hash: "", pathname: "/", search: "" });
      vi.stubGlobal("history", { state: null, replaceState: vi.fn() });
      vi.stubGlobal("sessionStorage", {
        getItem: () => null,
        setItem: vi.fn(),
      });
    };

    // The Android and iOS Studio shims define window.uglyBrowser without
    // onShare. Calling it unguarded threw "onShare is not a function" and
    // left Chat as a blank screen inside the mobile app.
    it("does not throw when the shell omits onShare", async () => {
      stubPage({
        onContext: vi.fn(),
        onSelectConversation: vi.fn(),
        onAction: vi.fn(),
        publishConversations: vi.fn(),
        publishActionResult: vi.fn(),
      });
      const { installBrowserShareBridge } = await import(
        "../../client/lib/browserShare"
      );
      expect(() => installBrowserShareBridge()).not.toThrow();
    });

    it("subscribes through onShare when the shell provides it", async () => {
      const onShare = vi.fn();
      stubPage({ onShare });
      const { installBrowserShareBridge } = await import(
        "../../client/lib/browserShare"
      );
      installBrowserShareBridge();
      expect(onShare).toHaveBeenCalledOnce();
    });
  });
});
