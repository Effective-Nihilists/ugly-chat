import React, { useCallback } from "react";
import { useApp } from "ugly-app/client";
import { useRouter } from "../router";
import { NewChatPopup } from "../components/NewChatPopup";
import { useConversations } from "../lib/conversations";
import {
  publishCreatedConversation,
  useBrowserEmbed,
} from "../lib/browserEmbed";

/**
 * Starting a chat, as a PAGE rather than a modal.
 *
 * The browser's sidebar has its own "+", and a modal is the one thing it cannot
 * show: a popup opened inside the companion never renders there (verified — the
 * opener runs and nothing appears), and the browser cannot draw the form itself
 * because it holds no Chat credentials and no contact list. A route solves both
 * — the browser opens THIS in a dialog of its own, the way it opens the dialog
 * for a new dock app, and the form inside is the same one this app uses.
 *
 * Reusing `NewChatPopup` rather than restating it: a second new-chat form is a
 * second set of rules about who a chat can be started with.
 */
export default function NewChatPage(): React.ReactElement {
  const { socket } = useApp();
  const router = useRouter();
  const embed = useBrowserEmbed();
  const { conversations } = useConversations();

  const go = useCallback(
    (conversationId: string) => {
      // Embedded, this page is a dialog the BROWSER owns: it closes it and
      // opens the thread in its panel, so navigating here as well would leave
      // the new conversation open in a dialog nobody meant to keep.
      if (embed.embedded) {
        publishCreatedConversation(conversationId);
        return;
      }
      router.push(":conversationId", { conversationId });
    },
    [embed.embedded, router],
  );

  const close = useCallback(() => {
    if (embed.embedded) {
      publishCreatedConversation("");
      return;
    }
    router.push("", {});
  }, [embed.embedded, router]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        background: "var(--app-main)",
        padding: embed.embedded ? 0 : 16,
        boxSizing: "border-box",
      }}
      data-id="new-chat-page"
    >
      <NewChatPopup
        onClose={close}
        socket={socket}
        recent={conversations.filter((c) => c.type !== "group").slice(0, 8)}
        navigate={go}
      />
    </div>
  );
}
