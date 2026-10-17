/**
 * Ugly Chat inside a phone host (Studio's Android/iOS shells), at a phone
 * viewport. Feedback 3b639ded: "there is no way to switch between chats, and it
 * only opens in Dark Mode".
 *
 * The host is stubbed the way the phone shims install it: `window.uglyBrowser`
 * at document start, answering `onContext` synchronously. The stub keeps the
 * callback so the spec can push a theme change later, as Studio does when the
 * user flips its theme.
 *
 * Run against the deployed app (no dev server needed):
 *   PLAYWRIGHT_BASE_URL=https://ugly.chat npx playwright test embedded-phone --project=chromium
 */
import { expect, test, type Page } from "@playwright/test";
import { authenticateAs, testAccount } from "ugly-app/playwright";

const PHONE = { width: 360, height: 792 };
const INSET_TOP = 40;

/** A phone with a status bar: the native inset the shells report, and the
 *  CSS var the framework derives from it. */
async function withTopInset(page: Page): Promise<void> {
  await page.addInitScript((insetTop) => {
    const w = window as unknown as Record<string, unknown>;
    w.__safeAreaInsets = { top: insetTop, right: 0, bottom: 0, left: 0 };
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.style.setProperty(
        "--safe-area-inset-top",
        `${insetTop}px`,
      );
    });
  }, INSET_TOP);
}

async function embed(
  page: Page,
  context: Record<string, unknown>,
): Promise<void> {
  await withTopInset(page);
  await page.addInitScript((ctx) => {
    const w = window as unknown as Record<string, unknown>;
    let listener: ((value: unknown) => void) | null = null;
    w.__pushContext = (value: unknown) => listener?.(value);
    w.uglyBrowser = {
      onContext(cb: (value: unknown) => void) {
        listener = cb;
        cb(ctx);
        return () => undefined;
      },
      onSelectConversation: () => () => undefined,
      onAction: () => () => undefined,
      publishConversations: () => undefined,
      publishActionResult: () => undefined,
    };
  }, context);
}

/** First opaque background at a viewport point — what the framework's seam
 *  auditor samples. */
async function bgAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ([px, py]) => {
      for (const el of document.elementsFromPoint(px, py)) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg))
          return bg;
      }
      return getComputedStyle(document.body).backgroundColor;
    },
    [x, y] as const,
  );
}

test.describe("not embedded", () => {
  test.use({ viewport: PHONE, colorScheme: "light" });

  test("defaults to auto and follows the system theme live", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "only light",
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "dark",
    );
  });
});

test.describe("embedded in a phone host", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page, baseURL }) => {
    const account = await testAccount("embedded-phone");
    const host = new URL(baseURL ?? "https://ugly.chat").hostname;
    await authenticateAs(
      page,
      account,
      host === "localhost" ? undefined : host,
    );
  });

  test("shows its own chat list and a way back to it", async ({ page }) => {
    await embed(page, { embedded: true, theme: "light" });
    await page.goto("/");
    // The home is the full-page list (search + new chat), not the empty hero.
    await expect(page.locator('[data-id="search"]')).toBeVisible();
    await page
      .locator('[data-id="chat-with-ai"], [data-id="new-chat"]')
      .first()
      .waitFor();
    // Open a thread (the built-in bot) and come back through the header.
    // Let the first load's silent-SSO round trip finish, or this navigation
    // is aborted by it.
    await page.waitForTimeout(800);
    await page.goto("/bc-bot-ugly-" + (await userId(page)));
    const back = page.locator('[data-id="back"]');
    await expect(back).toBeVisible();
    await back.click();
    await expect(page.locator('[data-id="search"]')).toBeVisible();
  });

  test("hides its list only when the host says it has a picker", async ({
    page,
  }) => {
    await embed(page, {
      embedded: true,
      theme: "light",
      conversationPicker: true,
    });
    await page.goto("/bc-bot-ugly-" + (await userId(page)));
    await expect(page.locator(".uc-conversation-header")).toBeVisible();
    await expect(page.locator('[data-id="back"]')).toHaveCount(0);
  });

  test("follows the host's theme, including later changes", async ({
    page,
  }) => {
    await embed(page, { embedded: true, theme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "only light",
    );
    await page.evaluate(() =>
      (window as unknown as { __pushContext(v: unknown): void }).__pushContext({
        embedded: true,
        theme: "dark",
      }),
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "dark",
    );
    await page.evaluate(() =>
      (window as unknown as { __pushContext(v: unknown): void }).__pushContext({
        embedded: true,
        theme: "light",
      }),
    );
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "only light",
    );
  });

  test("the status-bar strip is the same surface as the page below it", async ({
    page,
  }) => {
    // Both themes. The light pair is the seam prod logged on 2026-10-15
    // ("rgb(242, 242, 244) vs rgb(255, 255, 255)": --app-sidebar over an
    // --app-main pane); the dark pair is its earlier twin.
    for (const ctx of [
      { embedded: true, theme: "dark" },
      { embedded: true, theme: "dark", conversationPicker: true },
      { embedded: true, theme: "light" },
      { embedded: true, theme: "light", conversationPicker: true },
    ]) {
      await embed(page, ctx);
      await page.goto("/");
      // The signed-in home: the phone list, or (host picker) the empty hero.
      // Waiting on it also rides out the silent-SSO round trip on first load.
      await page
        .locator('[data-id="search"], [data-id="chat-with-ai"]')
        .first()
        .waitFor();
      await page.waitForTimeout(800);
      const x = Math.floor(PHONE.width / 2);
      expect(await bgAt(page, x, 1)).toBe(await bgAt(page, x, INSET_TOP + 3));
    }
  });
});

test.describe("on a phone, not embedded", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test.beforeEach(async ({ page, baseURL }) => {
    const account = await testAccount("embedded-phone");
    const host = new URL(baseURL ?? "https://ugly.chat").hostname;
    await authenticateAs(
      page,
      account,
      host === "localhost" ? undefined : host,
    );
  });

  test("the status-bar strip is the same surface as the home and a thread", async ({
    page,
  }) => {
    await withTopInset(page);
    const x = Math.floor(PHONE.width / 2);
    const thread = "/bc-bot-ugly-" + (await userId(page));
    // The theme defaults to auto, so the OS scheme picks the palette.
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const path of ["/", thread]) {
        await page.goto(path);
        await page
          .locator('[data-id="search"], .uc-conversation-header')
          .first()
          .waitFor();
        await page.waitForTimeout(800);
        expect(await bgAt(page, x, 1)).toBe(await bgAt(page, x, INSET_TOP + 3));
      }
    }
  });
});

/** The signed-in user's id, read from the session the app itself holds. */
async function userId(page: Page): Promise<string> {
  if (!page.url().startsWith("http")) await page.goto("/");
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === "auth_token")?.value ?? "";
  const payload = JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
  ) as { sub?: string; userId?: string };
  return payload.sub ?? payload.userId ?? "";
}
