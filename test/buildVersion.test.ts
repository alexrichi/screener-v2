import { describe, expect, it } from 'vitest';
import { formatBuildVersion } from '../src/lib/buildVersion';

describe('build version', () => {
  it('uses the packaged executable build minute when present', () => {
    expect(
      formatBuildVersion(
        { major: '0', built: '202601010000', git: 'abc1234' },
        '202611111330',
      ),
    ).toBe('0.202611111330.abc1234');
  });

  it('falls back to the bundle build minute and keeps the dirty marker', () => {
    expect(
      formatBuildVersion(
        { major: '1', built: '202601010000', git: 'abc1234-dirty' },
        null,
      ),
    ).toBe('1.202601010000.abc1234-dirty');
  });
});
