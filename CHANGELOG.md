# Changelog

The app follows the semver in `package.json`. About shows that version next to
the build stamp; the updater compares only the version.

## 0.1.3 — 2026-11-18

- A title bar button appears when an update has downloaded. The app no longer
  opens a modal on its own; clicking the button asks before restarting.
- Update state is exposed to the renderer through the preload bridge, and the
  button reads the current state when the window opens.

## 0.1.2 — 2026-11-18

- About shows the package version (`Version 0.1.2`) next to the build stamp
  (`Build 0.2026...`).
- Verified a differential update from 0.1.1.

## 0.1.1 — 2026-11-18

- Patch release used to verify the GitHub release update path.

## 0.1.0 — 2026-11-18

- First public NSIS installer for Windows.
- GitHub release updater with `latest.yml` and background downloads.
- HashHedge partner button in the title bar.
- MIT license and the workspace screenshot in the README.

[0.1.3]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.3
[0.1.2]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.2
[0.1.1]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.1
[0.1.0]: https://github.com/alexrichi/screener-v2/releases/tag/v0.1.0
