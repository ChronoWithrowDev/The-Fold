# Windows Desktop Build

This project is a playable browser prototype, not a release-certified native game. This environment can build the web project, but cannot compile or launch-test a Windows executable. The desktop wrapper and packaging script are provided for a Windows machine.

## Requirements

- Windows 10/11, x64.
- Node.js 22 LTS or newer and npm.
- A WebGL 2-capable graphics driver with hardware acceleration enabled.
- Internet access for the first dependency and Electron runtime download. The packaged game itself does not require internet access.

## Package

From the project root:

1. Run `npm install`.
2. Run `npm run build`.
3. Run `node desktop/package-windows.mjs`.

The script creates an isolated `desktop/.staging` workspace, copies the complete production build, generates a Windows icon, installs Electron and electron-builder there, and uses electron-builder's supported x64 NSIS and portable targets. The root web package and Vite configuration are not modified.

Expected artifacts:

- `release/The-Fold-Setup-0.1.0.exe`: per-user installer with an install-directory chooser.
- `release/The-Fold-Portable-0.1.0.exe`: standalone portable launcher.
- `release/win-unpacked/`: unpacked application for troubleshooting.

These paths are expected outputs, not artifacts that have been produced or tested in the current environment. Code signing is not configured. Windows may show a SmartScreen warning for an unsigned development build. Configure a trusted signing identity before public distribution; do not ask users to bypass OS security settings.

## Offline Assets

The web build inlines JavaScript, CSS, and the locally bundled fonts into `dist/index.html`. The generated title artwork and SVG icon are copied into `dist` as local assets. Three.js geometry, surface textures, music, and effects are generated at runtime. No CDN, development server, or external browser is required by the packaged application. Optional narration uses the system's installed speech voices; availability varies by computer.

## Saves

The wrapper sets Electron's user-data directory to `%APPDATA%\The Fold - Walsenburg`. Saves and settings are stored in Chromium's persistent local storage within this writable directory, not beside the executable or under Program Files. The portable and installed builds use the same profile. Only one instance can write to the profile at a time.

The browser version uses local storage for its current origin and does not share the desktop profile. Clearing browser site data removes that browser's progress. Settings and saves are schema-validated on load; missing or invalid saves fall back to a new journey. The app has no cloud save or account system.

## Required Windows Verification

1. Launch the portable executable without a browser, editor, or Vite server running.
2. Install through NSIS and launch from the Start menu.
3. Confirm the title artwork, local fonts, original audio, mouse capture, and F11 fullscreen work offline.
4. Complete all seven story sites in order, including the mountain field lab and its gravity-shifting observatory, then test free exploration after the ending.
5. Test wall-to-wall, floor-to-wall, wall-to-floor, and ceiling portals, approaching from several angles and at running speed.
6. Carry and throw cores through both endpoints. Repeat traversal and move a portal while close to it. Check for lost or duplicated bodies.
7. Test door anti-crush behavior, switch deactivation, water recovery, and R checkpoint resets.
8. Save and exit mid-puzzle, relaunch, and verify completed connections and settings. A mid-air player save deliberately returns to the current checkpoint rather than resuming without its launch velocity.
9. Compare performance and portal alignment at each graphics quality and render scale, including ultrawide and high-DPI displays.
10. Verify reduced motion, subtitles, narration availability, keyboard-only alternatives, and disconnected or unavailable audio devices.

Run `npm audit` for both the web project and desktop staging workspace, review all dependency advisories, and update affected packages before public distribution. Do not call the game release-ready until the above checks have been completed on actual target machines.