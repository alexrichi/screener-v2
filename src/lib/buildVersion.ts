export interface BuildStamp {
  major: string;
  built: string;
  git: string;
}

/** `major.BUILT.HASH`; the packaged app supplies the executable's mtime minute. */
export function formatBuildVersion(stamp: BuildStamp, executableBuilt?: string | null): string {
  return `${stamp.major}.${executableBuilt || stamp.built}.${stamp.git}`;
}

export const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;

const stamp: BuildStamp =
  typeof __BUILD_STAMP__ === 'undefined'
    ? { major: '0', built: 'dev', git: 'dev' }
    : __BUILD_STAMP__;

export const BUILD_VERSION = formatBuildVersion(
  stamp,
  typeof window === 'undefined' ? null : window.screenerWindow?.buildBuilt,
);
