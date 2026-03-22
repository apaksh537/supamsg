# SupaMsg - Multi-WhatsApp Account Android App

Run multiple WhatsApp Web sessions simultaneously on Android, each with isolated cookie stores and cache directories.

## Features

- Multiple WhatsApp Web sessions in separate tabs
- Isolated cookie/cache per account (sessions are independent)
- Material Design 3 dark theme
- Add, rename, and remove accounts
- File upload and camera support
- Desktop user agent for WhatsApp Web compatibility

## Setup

1. Open the project in **Android Studio Hedgehog (2023.1.1)** or newer
2. Sync Gradle files
3. Connect an Android device or start an emulator (API 24+)
4. Run the app

## Build

```bash
./gradlew assembleDebug
```

The APK will be at `app/build/outputs/apk/debug/app-debug.apk`.

## Install

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

## Usage

- The app starts with 2 default accounts (Personal and Work)
- Each tab loads WhatsApp Web independently -- scan QR codes separately for each account
- Tap the **+** button to add more accounts
- Double-tap a tab to rename, reload, or remove it
- Back button navigates within the current WebView

## Requirements

- Android 7.0 (API 24) or higher
- Internet connection
- Camera permission (optional, for QR scanning via file upload)
