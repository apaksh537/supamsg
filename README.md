# SupaMsg

All your WhatsApps. One window. Manage multiple WhatsApp accounts across all your devices.

## Project Structure

```
supamsg/
├── desktop/          # macOS + Windows Electron app
├── android/          # Android app (Kotlin + Material3)
├── ios/              # iPhone Notification Hub (SwiftUI)
├── landing/          # Marketing website (supamsg.com)
└── docs/             # Strategy, launch posts, documentation
```

## Platforms

| Platform | Tech | Status |
|---|---|---|
| **macOS** | Electron | Shipped (.dmg) |
| **Windows** | Electron | Shipped (.exe) |
| **Android** | Kotlin + WebView | Built, needs testing |
| **iPhone** | SwiftUI + WebSocket | In progress |
| **Web** | Landing page | Live at supamsg.com |

## Quick Start

### Desktop (macOS/Windows)
```bash
cd desktop
npm install
npm start           # development
npm run build:mac   # build .dmg
npm run build:win   # build .exe
```

### Android
```bash
cd android
# Open in Android Studio → Build → Run
```

### iOS
```bash
cd ios
# Open SupaMsg.xcodeproj in Xcode → Build → Run
```

## Features

- Multi-account WhatsApp Web (isolated sessions)
- AI Assistant (Claude API) — smart replies, summarize, translate
- Scheduled messages & message templates
- Broadcast campaigns & automations
- Chat export, contact labels, analytics
- Stealth mode (hide read receipts, typing, online)
- CRM integration (HubSpot + Zoho)
- Split screen, command palette, system tray
- iPhone notification hub with quick reply

## Monetization

Powered by Lemon Squeezy:
- **Free**: 3 accounts, basic features
- **Pro**: $9/mo or $79/year — unlimited accounts, AI, scheduling, export, analytics
- **Business**: $19/mo or $149/year — automations, broadcast, CRM, unlimited AI

## Links

- Website: [supamsg.com](https://supamsg.com)
- Store: [supamsg.lemonsqueezy.com](https://supamsg.lemonsqueezy.com)
