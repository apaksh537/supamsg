# SupaMsg Notification Hub — iOS Companion App

Companion iPhone app for SupaMsg desktop. Receives push notifications from all WhatsApp accounts and allows quick reply directly from your phone.

## Features

- **Unified Inbox**: See messages from all WhatsApp accounts in one place
- **Quick Reply**: Reply to messages without opening the desktop app
- **Per-Account Notifications**: Enable/disable notifications for each account independently
- **Do Not Disturb**: Schedule quiet hours
- **Notification Actions**: Reply or mark as read directly from notifications
- **Account Management**: Color-coded accounts with connection status
- **Template Replies**: Save and use quick reply templates

## Setup

### Prerequisites
- Xcode 15+
- iOS 17+ device (push notifications require a physical device)
- Apple Developer account (for push notification entitlements)
- SupaMsg desktop app running on the same network

### Creating the Xcode Project

Since `.xcodeproj` files are complex binary/XML structures, create the project in Xcode:

1. Open Xcode and select **File > New > Project**
2. Choose **iOS > App**
3. Configure:
   - Product Name: `SupaMsg`
   - Organization Identifier: `com.supamsg`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **None**
4. Save to this directory (`supamsg-ios/`)
5. Delete the auto-generated `ContentView.swift` and `SupaMsgApp.swift`
6. Drag the existing `SupaMsg/` folder into the Xcode project navigator
7. Ensure all `.swift` files are added to the SupaMsg target

### Capabilities to Enable

In the Xcode project settings under **Signing & Capabilities**:

- **Push Notifications** — required for remote notifications
- **Background Modes** — enable "Remote notifications"

### Build & Run

1. Select your physical iPhone as the build target
2. Build and run (Cmd+R)
3. Accept the notification permission prompt
4. Go to **Accounts > Pair with Desktop** and enter your desktop IP + pairing code

## How Pairing Works

```
iPhone App                        Desktop App (Electron)
    |                                    |
    |--- WebSocket connect ------------->| (ws://desktop-ip:8765)
    |--- { type: "pair", code: "..." }-->|
    |<-- { type: "pair_ack" } ----------|
    |                                    |
    |<-- { type: "message", ... } ------|  (incoming WhatsApp messages)
    |--- { type: "reply", ... } ------->|  (quick replies)
    |                                    |
```

1. The desktop app runs a WebSocket server on port 8765 (via `features/mobile-relay.js`)
2. The iPhone app connects and sends a pairing handshake with a 6-digit code
3. Once paired, the desktop broadcasts all incoming WhatsApp notifications
4. Quick replies from the iPhone are injected into WhatsApp Web via `executeJavaScript`

## Architecture

```
SupaMsg/
├── SupaMsgApp.swift          # App entry point, push registration
├── Views/
│   ├── ContentView.swift     # Tab bar (Inbox, Accounts, Settings) + theme
│   ├── InboxView.swift       # Unified inbox with grouped messages
│   ├── AccountsView.swift    # Account list + pairing sheet
│   ├── SettingsView.swift    # Preferences, DND, license
│   └── QuickReplyView.swift  # Reply UI with templates
├── Models/
│   ├── Message.swift         # Message data model
│   └── Account.swift         # Account data model
└── Services/
    ├── NotificationService.swift  # Push notification handling
    ├── PairingService.swift       # WebSocket client + pairing logic
    └── MessageStore.swift         # Local storage + state management
```

### Desktop Relay

The desktop-side relay lives at `whatsapp-hub/features/mobile-relay.js`:

```js
const { initMobileRelay } = require('./features/mobile-relay');

// In your Electron main process setup:
const relay = initMobileRelay({
  ipcMain,
  getMainWindow: () => mainWindow,
  getViews: () => views,
  getAccounts: () => accounts
});

// When a new message arrives:
relay.broadcastNotification({
  accountId: 'acc_123',
  accountName: 'Business',
  contactName: 'John Doe',
  text: 'Hey, are you available?'
});
```

## Theme

The app uses a dark theme matching the SupaMsg desktop:

| Token | Color | Usage |
|-------|-------|-------|
| `smBackground` | `#1a1a2e` | Main background |
| `smSurface` | `#16213e` | Cards, list rows |
| `smSurfaceLight` | `#1f3460` | Borders, dividers |
| `smAccent` | `#25D366` | WhatsApp green, CTAs |
| `smText` | `#FFFFFF` | Primary text |
| `smTextSecondary` | `#8892b0` | Secondary text |
