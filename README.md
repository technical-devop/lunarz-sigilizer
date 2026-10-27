# Lunarz Sigilizer

Deterministic intention-to-sigil composition engine with a local Tauri v2 shell.

Runs fully local and offline. No network calls, no accounts, no telemetry.

## License

MIT. See `LICENSE`.

## Platforms

| OS | Arch | Installer | Runner |
| --- | --- | --- | --- |
| Windows | x64 | NSIS `.exe` | `windows-2022` |
| Ubuntu | x64 | `.deb` | `ubuntu-22.04` |

Installers are **unsigned**. Expect an OS unknown-publisher warning on first install.

## Status

- Web UI tests: `vitest` (`npm test`).
- Native Rust tests: pending. No `cargo test` coverage yet.

## Prerequisites

- Node.js 22 and npm
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

`.github/workflows/build.yml` builds both installers on standard hosted runners and uploads them as workflow artifacts. No releases are created.

- `npm ci`
- `npm test`
- `npm run build`
- `npx tauri build --bundles nsis -- --locked` (Windows) / `--bundles deb -- --locked` (Linux)
- Upload installer via `actions/upload-artifact`
