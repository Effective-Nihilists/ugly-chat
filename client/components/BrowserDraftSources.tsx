import React from "react";
import type { BrowserDraftSource } from "../lib/browserShare";

/** Attribution preview for an unsent Browser-selected-tabs draft. */
export function BrowserDraftSources({
  sources,
}: {
  sources: readonly BrowserDraftSource[];
}): React.ReactElement | null {
  if (sources.length < 2) return null;
  return (
    <section
      className="uc-browser-draft-sources"
      aria-label="Selected browser sources"
      data-id="browser-draft-sources"
    >
      <strong>Selected browser sources</strong>
      <span>{sources.length} tabs · draft not sent</span>
      <div>
        {sources.map((source, index) => (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            data-id="browser-draft-source"
          >
            <small>{index + 1}</small>
            <span>{source.title}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
