import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserDraftSources } from '../../client/components/BrowserDraftSources';

describe('BrowserDraftSources', () => {
  it('shows attributed source cards and an explicit unsent state', () => {
    const html = renderToStaticMarkup(<BrowserDraftSources sources={[
      { title: 'One', url: 'https://one.test/' },
      { title: 'Two', url: 'https://two.test/' },
    ]} />);
    expect(html).toContain('Selected browser sources');
    expect(html).toContain('2 tabs · draft not sent');
    expect(html).toContain('https://one.test/');
    expect(html).toContain('rel="noreferrer"');
  });
});
