# Ghostchat

A native macOS wrapper for [Snapchat Web](https://web.snapchat.com), built with Electron. Real dock icon, real title bar, real macOS notifications, camera/mic that actually work — the genuine Snapchat Web experience in an app that feels like it belongs on your Mac instead of a browser tab.

**This is an unofficial, independent project.** It is not made by, affiliated with, or endorsed by Snap Inc. It's a thin native shell around Snapchat's own website — every account, message, and Snap is served by Snapchat's real servers. Ghostchat doesn't intercept, store, or transmit your credentials or content anywhere; it just gives their web app a proper window.

## Features

- Native dock icon, app name, and title bar (no more digging through browser tabs)
- Working camera/microphone for Snaps and calls, with correct macOS entitlements
- Real native notifications for messages and calls
- Persistent login across restarts
- Strips web-page cruft (ad-manager popups, "download the app" nags, marketing banners) so it reads like an app, not a website
- Universal binary — works on Apple Silicon and Intel Macs

## Install

Download the latest `.dmg` from the [Releases](../../releases) page, open it, and drag Ghostchat to Applications.

## Build from source

```bash
git clone <this-repo>
cd SnapchatDesktop
npm install
npm run dist   # builds a signed universal .app + .dmg into dist/
```

Requires Node.js and Xcode Command Line Tools (for `codesign`/`iconutil`).

## Why this exists

Snapchat has never shipped a native Mac app. This wraps their actual web client in a proper Electron shell so it behaves like one — real permissions, real notifications, real window chrome — without needing an Android emulator or a spare browser tab pinned forever.
