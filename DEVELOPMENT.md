# Development and releases

## Prerequisites

- Node 24 and npm.
- The app resolves Vela and the Pine packages from sibling checkouts:

  ```
  ../Vela
  ../pine-engine
  ../pine-editor
  ../pine-script-syntax-highlighter
  ```

  Those repositories stay private. Local builds use the working trees; CI is not
  configured.
- No `.env` is needed. The AI key lives in
  `%APPDATA%\screener-v2\ai.json`, never in the repository.

## Local modes

### Browser

```powershell
# terminal 1
npm run sidecar
# terminal 2
npm run dev
```

Open `http://localhost:5173`. The sidecar serves market data on port 8787. This
is the fastest loop: HMR, no Electron, no updater.

### Electron without installing

```powershell
npm run electron:start
```

Builds `dist`, the sidecar and the updater, then runs `electron .`. The app is
not packaged, so the updater is disabled. There is no HMR; restart after edits.

### Electron with HMR

```powershell
# terminal 1
npm run dev
# terminal 2, once after sidecar changes
npm run sidecar:build
$env:ELECTRON_START_URL = 'http://localhost:5173'
npx electron .
```

Electron loads the Vite server while the main process starts the sidecar. If
Vite picks another port, use the URL it prints.

### Packaged build without installing

```powershell
npm run electron:pack
release\win-unpacked\Screener.exe
```

This is the packaged app with ASAR and the bundled sidecar. The updater is
active, but it only reacts to a published release newer than the local version.
Use it to check the native title bar, IPC and packaging, not for daily edits.

### Installer build

```powershell
npm run electron:dist
```

Writes to `release/`:

```
Screener-Setup-<version>.exe
Screener-Setup-<version>.exe.blockmap
latest.yml
```

The script passes `--publish never`; nothing is uploaded.

## Release checklist

1. Bump the version, add the changelog entry, and commit:

   ```powershell
   npm version patch --no-git-tag-version
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "Bump version to X.Y.Z"
   ```

2. Run the gate:

   ```powershell
   npm run typecheck
   npm test
   npm run build
   ```

3. Make sure the sibling checkouts are clean and record their commits for the
   release notes:

   ```powershell
   git -C ../Vela rev-parse --short HEAD
   git -C ../pine-engine rev-parse --short HEAD
   git -C ../pine-editor rev-parse --short HEAD
   git -C ../pine-script-syntax-highlighter rev-parse --short HEAD
   ```

4. Build the installer:

   ```powershell
   npm run electron:dist
   ```

5. Check `release/latest.yml`: the version, `path` and `sha512` must match the
   `.exe`. Do not rename the installer after building.

6. Tag and push:

   ```powershell
   git tag -a vX.Y.Z -m "Screener X.Y.Z"
   git push origin dev-oak main vX.Y.Z
   ```

7. On GitHub, create a release for the tag, upload the `.exe`, `.blockmap` and
   `latest.yml`, and publish it. A draft release is ignored by the updater.

8. Install an older version, launch it, wait about ten seconds, and confirm the
   update prompt. The first install is always manual; later ones update
   themselves.

## Update behavior

- Only NSIS installs update. `release\win-unpacked` and `npm run dev` are not the
  target of an update.
- The app checks ten seconds after startup, then every four hours.
- The compared version is the semver in `package.json`. The build stamp is
  display only; rebuilding the same version does not create an update.
- A release must be published, not a draft, and its version must be higher than
  the installed one.
- `latest.yml` must be on the latest release and its `path` and `sha512` must
  match the uploaded installer.
- The download happens in the background. A title bar button appears when it is
  ready; clicking it asks before restarting because scan results and alerts are
  session-only. If the user chooses later, the update installs on quit.
- The repository is public, so releases are read anonymously. Making it private
  would break updates for existing installs.
- Builds are unsigned: SmartScreen may warn. `publisherName` must stay unset
  until a certificate is configured.
- About shows `Version` from `package.json` and `Build` as
  `<major>.<built>.<git>`; the updater compares `Version`.

## Local installation

The installed app lives in `%LOCALAPPDATA%\Programs\Screener`. To replace it
without publishing a release, run the new installer manually. A normal rebuild
does not touch that directory, and the installed app does not see a new version
until a newer release is published.

## Troubleshooting

- `EBUSY` while removing `release\win-unpacked`: close Explorer windows on that
  folder and stop `Screener.exe`, then rebuild.
- Port 8787 busy: another sidecar is running. Check
  `http://127.0.0.1:8787/health` and stop the old process.
- Port 5173 busy: Vite chooses 5174; point `ELECTRON_START_URL` at the printed
  URL.
- Updater errors are logged to the main process console. A failed check never
  blocks the app.
