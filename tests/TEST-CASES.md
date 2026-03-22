# SupaMsg Test Cases

## 1. Account Management

### TC-1.1: Add Account
- Open app
- Click "+ Add Account" in nav panel
- Expected: Input dialog appears asking for account name
- Enter "Personal"
- Expected: New WhatsApp Web BrowserView loads with QR code
- Expected: Account appears in nav panel with colored avatar "PE"
- Expected: Account is active (green left border)

### TC-1.2: Switch Account
- Have 2+ accounts
- Click inactive account in nav panel
- Expected: Active account changes (green border moves)
- Expected: WhatsApp Web view switches to the other account
- Expected: Both views have IDENTICAL dimensions
- Expected: No visual glitching during switch

### TC-1.3: Rename Account
- Double-click account name in nav panel
- Expected: Input dialog with current name pre-filled
- Enter new name "Work Phone"
- Expected: Name updates immediately in nav panel

### TC-1.4: Remove Account
- Right-click account → Remove
- Expected: Confirmation dialog
- Click Yes
- Expected: Account removed from panel
- Expected: WhatsApp session cleared
- Expected: If it was active, another account becomes active

### TC-1.5: Reorder Accounts (Drag)
- Drag account up/down in panel
- Expected: Account moves to new position
- Expected: Order persists after restart

### TC-1.6: Account Persistence
- Add 3 accounts, connect WhatsApp on each
- Close app completely
- Reopen app
- Expected: All 3 accounts still there
- Expected: All WhatsApp sessions still connected (no re-scan needed)

## 2. Navigation & UI

### TC-2.1: Nav Panel Renders Correctly
- Expected: 200px width, #FAFAFA background
- Expected: "SupaMsg v2" title at top
- Expected: ACCOUNTS section with uppercase label
- Expected: TOOLS section with tool items
- Expected: Footer with plan info

### TC-2.2: Tool Buttons Open Panels
- Click "Schedule" in nav panel
- Expected: Child window opens with "Schedule Message" title
- Expected: Window is centered on screen
- Expected: WhatsApp Web is still visible behind it (not hidden)
- Close window
- Expected: Window closes cleanly

Repeat for: Templates, AI, Broadcast, Dashboard, Settings

### TC-2.3: Settings Panel
- Click Settings
- Expected: Settings window opens
- Expected: Plan card visible at top
- Expected: Account list shows all accounts
- Expected: Notification toggles work (click toggle, state changes)
- Expected: API key input accepts text
- Expected: Pairing code displays

### TC-2.4: Keyboard Shortcuts
- Cmd+1: switches to first account
- Cmd+2: switches to second account
- Cmd+K: opens command palette (if implemented)

### TC-2.5: Context Menu
- Right-click account avatar
- Expected: Menu appears with Rename, Reload, Remove options
- Click Rename: dialog appears
- Click Reload: WhatsApp Web reloads
- Click Remove: confirmation dialog

## 3. WhatsApp Web Integration

### TC-3.1: WhatsApp Web Loads
- Add account
- Expected: WhatsApp Web loads with QR code
- Scan QR code with phone
- Expected: WhatsApp chats appear
- Expected: Can click on chats
- Expected: Can send messages

### TC-3.2: View Dimensions Consistent
- Switch between 2 connected accounts
- Expected: Both have identical width and height
- Expected: WhatsApp sidebar width is the same
- Expected: No zoom/DPR differences

### TC-3.3: Notifications
- Receive message on connected WhatsApp
- Expected: macOS notification appears
- Expected: Unread badge updates on account avatar
- Expected: Dock badge shows total unread

### TC-3.4: WhatsApp Web Scrolling
- Open a chat with many messages
- Scroll up
- Expected: Scrolling works normally
- Expected: Content extends to full window height (no cutoff)

### TC-3.5: WhatsApp Settings
- Click three dots menu in WhatsApp Web
- Click Settings
- Expected: Settings page renders fully
- Expected: Can scroll within WhatsApp settings
- Expected: No content cut off at bottom

## 4. Feature Panels

### TC-4.1: Schedule Panel
- Open Schedule panel
- Fill all fields (account, contact, message, date, time)
- Click Schedule
- Expected: IPC call sent to scheduled-messages module
- Expected: Confirmation shown

### TC-4.2: Templates Panel
- Open Templates panel
- Expected: Default templates shown
- Click a template
- Expected: Text copied or inserted
- Create new template
- Expected: Template added to list

### TC-4.3: AI Panel
- Open AI panel
- Click "Suggest Replies"
- Expected: Loading state shown
- Expected: Results appear (or "API key needed" message)

### TC-4.4: Broadcast Panel
- Open Broadcast panel
- Create new campaign
- Expected: Campaign appears in list with "Draft" status

### TC-4.5: Dashboard Panel
- Open Dashboard panel
- Expected: Stats displayed (even if all zeros for new install)

### TC-4.6: Settings Panel
- Open Settings
- Toggle "Show notifications" off then on
- Expected: Toggle animates, setting persists
- Enter API key
- Click Save
- Expected: Confirmation shown

## 5. Licensing & Upgrade

### TC-5.1: Free Plan Default
- Fresh install
- Expected: Footer shows "Free Plan"
- Expected: All features accessible (unlocked for testing)

### TC-5.2: Upgrade Flow
- Click "Upgrade" in footer or settings
- Expected: Upgrade panel opens
- Expected: Pro and Business plans shown with prices
- Click Upgrade on Pro
- Expected: Lemon Squeezy checkout opens in browser

### TC-5.3: License Activation
- Open Settings → Enter License Key
- Enter valid key
- Expected: Plan updates to Pro/Business
- Expected: Footer updates

## 6. System Integration

### TC-6.1: System Tray
- Close app window
- Expected: App continues running in system tray
- Click tray icon
- Expected: Window reappears
- Right-click tray icon
- Expected: Menu with account list + quit option

### TC-6.2: Launch at Login
- Enable "Open at startup" in settings
- Restart Mac
- Expected: SupaMsg launches automatically

### TC-6.3: Auto-Updater
- App checks for updates on launch
- Expected: No crash if no updates available
- Expected: Update banner appears if update found

### TC-6.4: Global Shortcut
- Press Ctrl+Shift+W from any app
- Expected: SupaMsg window shows/hides

## 7. Performance

### TC-7.1: Memory Usage
- Open app with 2 accounts connected
- Expected: Memory under 1GB after 5 minutes
- Expected: No memory growth over 30 minutes of idle

### TC-7.2: Launch Speed
- Cold launch app
- Expected: Window appears within 3 seconds
- Expected: First account loads within 5 seconds

### TC-7.3: Switch Speed
- Switch between accounts
- Expected: Switch completes within 200ms
- Expected: No blank flash

## 8. Mobile Apps

### TC-8.1: iOS App Launch
- Build and run on simulator
- Expected: App opens to Inbox tab
- Expected: "Pair with Desktop" button visible

### TC-8.2: iOS Pairing
- Tap "Pair with Desktop"
- Expected: Pairing sheet opens
- Enter desktop IP + code
- Expected: Connection establishes (or timeout error)

### TC-8.3: Android App Launch
- Build and run on device/emulator
- Expected: App opens with account tabs
- Expected: WhatsApp Web loads in WebView

## 9. Edge Cases

### TC-9.1: No Internet
- Disconnect WiFi
- Expected: WhatsApp Web shows "connecting..." (not crash)
- Expected: App itself doesn't crash

### TC-9.2: Many Accounts
- Add 5 accounts
- Expected: Nav panel scrolls if needed
- Expected: App doesn't slow down significantly

### TC-9.3: Window Resize
- Resize window to minimum size
- Expected: Nav panel stays visible
- Expected: WhatsApp Web resizes proportionally
- Maximize window
- Expected: Everything scales correctly
