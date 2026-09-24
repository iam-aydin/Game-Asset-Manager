# Game Asset Manager
![Game Asset Manager screenshot](docs/screenshot.jpg)
> Forked from [mthorson](https://github.com/mthorson) by [iam-aydin](https://github.com/iam-aydin) and restructured as **Game Asset Manager** to focus specifically on game asset organization and workflow management.

A desktop browser and organizer for game assets and 3D model files.

---

## 📋 What's New in v0.7.5

* 📦 **Media Support:** Added full format support for Audio (`.wav`, `.mp3`, `.flac`), Image (`.png`, `.jpg`, `.jpeg`, `.bmp`), and Text (`.txt`, `.md`) assets.
* 🎵 **Audio DSP:** Interactive player with pitch shifting, 3-band EQ (Sub Bass, Bass, Treble), and support for up to 200 files.
* 🖼️ **Image & Text Viewer:** Native preview support for images and built-in viewing for text files.
* 🎮 **Viewport Navigation:** Added WASD controls (`W`/`S` to zoom, `A`/`D` to pan left/right, `Shift + W`/`S` to move up/down).
* 🖼️ **Thumbnail Fixes:** Resolved thumbnail loading and rendering issues.
* 📁 **Side Panel Fixes:** Fixed "Show in Folder" and file "Rename" functions in the left sidebar.

---

## 📦 Supported File Formats

* **3D Models:** `.fbx`, `.gltf`, `.glb`, `.obj`, `.stl`, `.ply`, `.3mf`
* **Audio Assets:** `.wav`, `.mp3`, `.flac`
* **Image Assets:** `.png`, `.jpg`, `.jpeg`, `.bmp`
* **Text & Notes:** `.txt`, `.md`

---

## ✨ Key Features

### 🎮 Interactive 3D Viewport

* **WASD Navigation:** Move around models effortlessly (`W`/`S` to zoom, `A`/`D` to pan left/right, `Shift + W`/`S` to pan up/down).
* **Lighting & Render Control:** Choose from 5 lighting presets and 4 quality tiers.
* **Custom Thumbnail Snapshots:** Capture any camera angle as the permanent asset thumbnail with one click.
* **Orientation Overrides:** Set per-file rotation corrections for assets that import sideways.

### 🎵 Built-In Audio DSP Studio

* **Interactive Equalizer:** Real-time 3-band EQ control over **Sub Bass**, **Bass**, and **Treble**.
* **Pitch Shifting:** Adjust pitch on the fly ($\pm 12$ semitones) for sound design testing.
* **Waveform Visualization:** Integrated waveform overlays on the audio seekbar.
* **Large Library Support:** Smoothly browse and play collections with over 200+ audio files.

### 🖼️ Image & Text Viewers

* **Native Texture Preview:** Inspect 2D image files directly in the viewport.
* **Text & Markdown Reader:** View project notes, license files, and documentation alongside your models.

### 🏷️ Organization & Smart Search

* **Hierarchical Tagging:** Tag assets like `characters/heroes/hero_01` to automatically organize them under parent categories.
* **Ratings & Labels:** Assign 1–5 star ratings (`1`–`5`) and color codes (`Cmd/Ctrl+1`–`5`) with instant keyboard shortcuts.
* **Smart Collections:** Save custom search queries and filter combinations.
* **SQLite FTS5 Fast Search:** Instant search across file names, tags, and metadata.

### ⚡ Workflow & File Operations

* **Drag-and-Drop Management:** Drag files directly into folders to move them, duplicate with `Cmd/Ctrl+D`, or send to trash.
* **Batch Operations:** Batch rename, compress into ZIP archives, or generate contact-sheet exports.
* **External App Integration:** Configure right-click "Open With..." menu shortcuts for DCC tools (Blender, Unreal Engine, Photoshop, etc.).

---

## 🚀 Future Roadmap

* 🎬 **Video Player Support:** For previewing game trailers, UI animations, cutscenes, and transparency overlays.
* ⚙️ **Extended Config Files:** Native `.ini` file viewing support.
* 🎹 **Media Hotkeys & Looping:** `J` (-5s), `K` (play/pause), `L` (+5s) hotkeys with indefinite audio repeat loops.
* 🎮 **Navigation Refinements:** Control adjustments to set `W`/`S` for vertical panning and `Shift + W`/`S` for zooming.
* 🛠️ **Preferences Overhaul:** Removing outdated 3D-printing tabs ("Print beds" & "Print costs") and expanding the "External apps" extension list to include new 2D/Audio formats.

### 🐛 Known Issues

* **Mesh Camera Bug:** Keyboard zooming can fly the camera directly inside certain 3D geometries.
* **Render Glitch:** Thumbnails occasionally display instead of waveforms when switching between asset types.

---

# 🛠️ Developer Guide

## Architecture Overview

Game Asset Manager is built on **Electron**, **React**, **Mantine UI**, and **Three.js**. It runs across three main process layers:

1. **Main Process:** Manages the SQLite database via `better-sqlite3`, filesystem watching via `chokidar`, external app execution, and the thumbnail worker queue.
2. **Renderer Process:** Manages the React UI, state, sound engine, and Three.js 3D viewport.
3. **Thumbnail Workers:** Off-screen `BrowserWindow` instances that render 3D models into PNG tile thumbnails in the background.

The renderer communicates through custom protocols:

* `wh3d-thumb://` — Handles thumbnail cache delivery.
* `wh3d-file://` — Streams raw 3D, audio, and image asset bytes directly from disk.

---

## How Libraries Work

Opening a folder as a "Library" creates a `.meshFlask.db` SQLite database at the folder's root (tagged with a unique UUID). Per-machine mount paths live in user app data:

* **macOS:** `~/Library/Application Support/meshFlask/`
* **Windows:** `%APPDATA%/meshFlask/`

Key configuration files:

* `libraries.json`: UUID-to-path registry. Moving a library to another machine requires editing one line in this file to reconnect it.
* `preferences.json`: Global app settings (units, external application routes, NAS polling intervals, render quality).

---

## Running Locally

```sh
npm install
npm run dev

```

> **Note on Native Modules:** `npm install` automatically rebuilds `better-sqlite3` against Electron's Node ABI via a `postinstall` script.

### Running Tests

Because `vitest` runs in system Node rather than Electron, use the full test script to handle ABI rebuilding automatically:

```sh
npm run test:full

```

Other utility commands:

* `npm run typecheck` — Runs TypeScript type verification.
* `npm run build` — Compiles renderer and main bundles without modifying native modules.

---

## Packaging & Releases

Build standalone platform installers using `electron-builder`:

```sh
npm run dist        # Build for current OS
npm run dist:mac    # macOS DMG + ZIP (arm64 & x64)
npm run dist:win    # Windows NSIS Installer (x64)
npm run dist:linux  # Linux AppImage (x64)

```

Binaries are placed in `release/`. To regenerate app icon PNGs from source SVG:

```sh
npm run build:icon

```

---

## Project Structure

```text
src/
  main/             Electron main process
    db/             better-sqlite3 wrapper, migrations, repositories
    libraries/      Library registry and attachment lifecycle
    scanner/        Filesystem walker + chokidar watcher
    thumb-pool/     Hidden BrowserWindow background render queue
    preferences/    preferences.json read/write handlers
    cache/          Thumbnail cache management
    ipc/            Typed IPC handlers
    protocol/       wh3d-thumb:// and wh3d-file:// custom protocols
  renderer/         React UI + Three.js & Audio engines
    components/     Panels, modals, viewports, media widgets
    three/          ModelViewer, lighting rig, model loaders
    util/           Custom React hooks, formatters
  preload/          contextBridge IPC API layer
  shared/           Shared utilities (paths, types, sorting, smart-queries)

```
