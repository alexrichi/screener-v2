import { describe, expect, it } from 'vitest';
import { renameScriptTitle } from '../src/lib/indicatorLibrary';

describe('renameScriptTitle', () => {
  it('renames the top-level indicator title', () => {
    expect(
      renameScriptTitle('//@version=6\nindicator("My indicator")\nplot(close)', 'My indicator copy'),
    ).toBe('//@version=6\nindicator("My indicator copy")\nplot(close)');
  });

  it('renames strategy and named titles, preserving the quote style', () => {
    expect(renameScriptTitle('//@version=6\nstrategy("Old", overlay=true)', 'New')).toBe(
      '//@version=6\nstrategy("New", overlay=true)',
    );
    expect(renameScriptTitle("//@version=6\nindicator(title='Old', overlay=true)", 'New')).toBe(
      "//@version=6\nindicator(title='New', overlay=true)",
    );
  });

  it('handles multiline declarations and named arguments before title', () => {
    const source =
      '//@version=6\nindicator(\n  shorttitle="S",\n  title="Old",\n  overlay=true\n)';
    expect(renameScriptTitle(source, 'New')).toBe(
      '//@version=6\nindicator(\n  shorttitle="S",\n  title="New",\n  overlay=true\n)',
    );
  });

  it('leaves non-literal titles and scripts without a declaration alone', () => {
    const dynamic = '//@version=6\nindicator(str.tostring(close))';
    expect(renameScriptTitle(dynamic, 'New')).toBe(dynamic);
    const none = '//@version=6\nplot(close)';
    expect(renameScriptTitle(none, 'New')).toBe(none);
    expect(renameScriptTitle('//@version=6\n// note\nplot(close)', 'New')).toBe(
      '//@version=6\n// note\nplot(close)',
    );
  });

  it('escapes quotes in the new title', () => {
    expect(renameScriptTitle('indicator("Old")', 'A "B"')).toBe('indicator("A \\"B\\"")');
  });
});
