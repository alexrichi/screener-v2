/**
 * Chromium serializes `#ffffff` as `#fff` in computed custom properties.
 * Monaco token colors accept only six or eight hex digits.
 */
export function expandHex(value: string): string {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3,4}$/.test(hex)) {
    return hex
      .split('')
      .map((char) => char + char)
      .join('');
  }
  return hex;
}
