/**
 * The landing page used to hardcode a dark palette, which meant it ignored the
 * user's theme — including the two custom ones this app ships. These tests are
 * the guard against that regressing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BG, TEXT } from "../../client/landing/landingBrandTokens";

const css = readFileSync(
  new URL("../../client/styles.css", import.meta.url),
  "utf8",
);

describe("theme bridge", () => {
  it("defines --app-background, which the brand tokens derive from", () => {
    // One alias in :root covers every theme block: var() resolves at use time,
    // so it picks up whichever --app-main the active theme set.
    expect(css).toContain("--app-background: var(--app-main)");
  });

  it("derives the landing surfaces from theme variables, not hex literals", () => {
    expect(BG).toContain("var(--app-background");
    expect(TEXT).toContain("var(--app-foreground");
  });
});

describe("HomePage palette", () => {
  const src = readFileSync(
    new URL("../../client/pages/HomePage.tsx", import.meta.url),
    "utf8",
  );

  it("no longer hardcodes the old dark background", () => {
    expect(src).not.toContain("#0b0b0d");
    expect(src).not.toContain("#141417");
  });

  it("imports the shared brand tokens", () => {
    expect(src).toContain('from "../landing/landingBrandTokens"');
  });
});
