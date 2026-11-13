# Lunarz Sigilizer

Deterministic intention-to-sigil composition engine with a local Tauri v2 shell.

Runs fully local and offline. No network calls, no accounts, no telemetry.

## License

MIT. See `LICENSE`.

## Download and install

Local-first desktop app. It runs fully local and offline, with no accounts and no telemetry.

Get the published installers at https://github.com/technical-devop/lunarz-sigilizer/releases/latest:

| OS | Arch | Installer |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe` |
| Linux | x64 | `.deb` |

Installers are **unsigned**. Expect an OS unknown-publisher warning on first install.

- Windows: download the NSIS `.exe`, then run it after verifying the source before choosing whether to proceed.
- Linux: download the `.deb`, then in the download folder run `sudo apt install "./Lunarz.Sigilizer_0.1.4_amd64.deb"`. Later releases can have a different filename.

## Exports

The app can save the current mark as SVG (`Save SVG`) and as PNG (`Save PNG`). Both match the previewed lines on the night background. Exported geometry may reveal reduced letters. Wheel and sequence overlays are inspection-only and are not part of the exported files. Exported filenames are generic (`lunarz-sigil.svg`, `lunarz-sigil.png`).

## Status

- Web UI tests: `vitest` (`npm test`).
- Native Rust tests: pending. No `cargo test` coverage yet.

## Prerequisites

- Node.js 22.12+ in 22.x, 24.x, or 26+, and npm
- Rust stable toolchain
- Linux only: Tauri v2 system prerequisites

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

## Build locally

```bash
npm ci
npm test
npm run build
npx tauri build --bundles nsis -- --locked  # on Windows
npx tauri build --bundles deb -- --locked   # on Ubuntu 22.04
```

Output:

- Windows: `src-tauri/target/release/bundle/nsis/*.exe`
- Linux: `src-tauri/target/release/bundle/deb/*.deb`

## CI

`.github/workflows/build.yml` builds both installers on standard hosted runners and uploads them as workflow artifacts.

- `npm ci`
- `npm test`
- `npm run build`
- `npx tauri build --bundles nsis -- --locked` (Windows) / `--bundles deb -- --locked` (Linux)
- Upload installer via `actions/upload-artifact`
