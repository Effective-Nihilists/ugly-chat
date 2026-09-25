import { describe, it, expect } from "vitest";
import {
  isAllowedAttachmentUrl,
  fragmentId,
  formatPassages,
  extractPdfLinks,
} from "../../server/chatFileIngest";

const SELF = "https://ugly.chat";

describe("isAllowedAttachmentUrl", () => {
  it("allows our own origin's public objects", () => {
    expect(
      isAllowedAttachmentUrl("https://ugly.chat/public/abc/doc.pdf", SELF),
    ).toBe(true);
  });

  it("allows another ugly app's public objects", () => {
    // The reported document was open in Ugly File and shared into chat.
    expect(
      isAllowedAttachmentUrl("https://file.ugly.bot/public/k/doc.pdf", SELF),
    ).toBe(true);
  });

  it("allows a static subdomain", () => {
    expect(
      isAllowedAttachmentUrl("https://static.ugly.chat/public/x.pdf", SELF),
    ).toBe(true);
  });

  // ── the SSRF surface ───────────────────────────────────────────────────────

  it("refuses an arbitrary external host", () => {
    expect(
      isAllowedAttachmentUrl("https://evil.example/public/x.pdf", SELF),
    ).toBe(false);
  });

  it("refuses cloud metadata even with a /public/ path", () => {
    expect(
      isAllowedAttachmentUrl("http://169.254.169.254/public/x.pdf", SELF),
    ).toBe(false);
  });

  it("refuses a lookalike host that merely contains our domain", () => {
    expect(
      isAllowedAttachmentUrl("https://ugly.bot.evil.com/public/x.pdf", SELF),
    ).toBe(false);
  });

  it("refuses a host that ends with our name but isn't a subdomain", () => {
    expect(
      isAllowedAttachmentUrl("https://notugly.bot/public/x.pdf", SELF),
    ).toBe(false);
  });

  it("refuses non-http schemes", () => {
    expect(isAllowedAttachmentUrl("file:///etc/passwd", SELF)).toBe(false);
    expect(
      isAllowedAttachmentUrl("data:application/pdf;base64,AAAA", SELF),
    ).toBe(false);
  });

  it("refuses plain http on a platform host", () => {
    expect(
      isAllowedAttachmentUrl("http://file.ugly.bot/public/x.pdf", SELF),
    ).toBe(false);
  });

  it("refuses a platform URL outside /public/", () => {
    expect(isAllowedAttachmentUrl("https://ugly.chat/api/secret", SELF)).toBe(
      false,
    );
  });

  it("refuses garbage", () => {
    expect(isAllowedAttachmentUrl("not a url", SELF)).toBe(false);
    expect(isAllowedAttachmentUrl("", SELF)).toBe(false);
  });
});

describe("fragmentId", () => {
  it("is stable, so re-ingesting replaces rather than duplicates", () => {
    expect(fragmentId("https://ugly.chat/public/a.pdf", 3)).toBe(
      fragmentId("https://ugly.chat/public/a.pdf", 3),
    );
  });

  it("separates chunks of one file", () => {
    expect(fragmentId("https://ugly.chat/public/a.pdf", 1)).not.toBe(
      fragmentId("https://ugly.chat/public/a.pdf", 2),
    );
  });

  it("separates different files at the same chunk index", () => {
    expect(fragmentId("https://ugly.chat/public/a.pdf", 1)).not.toBe(
      fragmentId("https://ugly.chat/public/b.pdf", 1),
    );
  });

  it("produces an id safe to use as a document key", () => {
    expect(fragmentId("https://ugly.chat/public/Ræ 🎉.pdf", 0)).toMatch(
      /^[a-z0-9]+:\d+$/,
    );
  });
});

describe("formatPassages", () => {
  it("is empty when nothing was retrieved, so no stray heading is appended", () => {
    expect(formatPassages([])).toBe("");
  });

  it("labels every passage with its file and page for citation", () => {
    const out = formatPassages([
      { fileName: "book.pdf", page: 12, text: "alpha" },
      { fileName: "book.pdf", page: 99, text: "beta" },
    ]);
    expect(out).toContain("[book.pdf · p.12]");
    expect(out).toContain("[book.pdf · p.99]");
    expect(out).toContain("alpha");
    expect(out).toContain("beta");
  });

  it("tells the model to admit a miss instead of claiming it cannot open the file", () => {
    const out = formatPassages([{ fileName: "b.pdf", page: 1, text: "x" }]);
    expect(out).toMatch(/do not claim you cannot open the file/i);
  });
});

describe("extractPdfLinks", () => {
  it("finds the shared Ugly File link that started this bug", () => {
    const md =
      "have a look [La'alau'l-Hikmih_Jild_3.pdf](https://file.ugly.bot/public/k/La'alau'l-Hikmih_Jild_3.pdf)";
    expect(extractPdfLinks(md)).toEqual([
      {
        name: "La'alau'l-Hikmih_Jild_3.pdf",
        url: "https://file.ugly.bot/public/k/La'alau'l-Hikmih_Jild_3.pdf",
      },
    ]);
  });

  it("ignores images, which already had their own path", () => {
    expect(
      extractPdfLinks("![shot](https://ugly.chat/public/a/shot.png)"),
    ).toEqual([]);
  });

  it("ignores non-PDF attachments", () => {
    expect(
      extractPdfLinks("[notes.txt](https://ugly.chat/public/a/notes.txt)"),
    ).toEqual([]);
  });

  it("ignores an ordinary link that is not an attachment path", () => {
    expect(extractPdfLinks("[paper](https://example.com/x.pdf)")).toEqual([]);
  });

  it("dedupes a document quoted several times in the history", () => {
    const one = "[a.pdf](https://ugly.chat/public/k/a.pdf)";
    expect(extractPdfLinks(`${one}\n${one}`)).toHaveLength(1);
  });

  it("falls back to the filename when the link text is empty", () => {
    expect(extractPdfLinks("[](https://ugly.chat/public/k/b.pdf)")).toEqual([
      { name: "b.pdf", url: "https://ugly.chat/public/k/b.pdf" },
    ]);
  });

  it("finds several distinct documents", () => {
    const md =
      "[a.pdf](https://ugly.chat/public/k/a.pdf) and [b.pdf](https://file.ugly.bot/public/k/b.pdf)";
    expect(extractPdfLinks(md).map((f) => f.name)).toEqual(["a.pdf", "b.pdf"]);
  });
});
