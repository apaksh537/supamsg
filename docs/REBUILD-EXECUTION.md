# SupaMsg v2 — Detailed Rebuild Execution Plan

## Day-by-Day Build Schedule

### Week 1: Desktop Core (React + Electron)

**Day 1: Project Setup**
- Create `desktop-v2/` directory in monorepo
- Initialize: Vite + React + TypeScript + Tailwind CSS
- Configure Electron main process (copy working main.js as base)
- Set up Zustand store for state management
- Define Tailwind config with all design tokens (colors, spacing, radius, shadows)
- Create folder structure:
  ```
  desktop-v2/
  ├── src/
  │   ├── main/              # Electron main process
  │   │   ├── main.ts        # App lifecycle, BrowserView management
  │   │   ├── window-manager.ts  # Child window spawning
  │   │   ├── view-manager.ts    # BrowserView create/switch/resize
  │   │   └── features/      # All 44 feature modules (copied as-is)
  │   ├── renderer/           # React app (main window sidebar)
  │   │   ├── App.tsx
  │   │   ├── components/
  │   │   │   ├── AccountStrip.tsx
  │   │   │   ├── AccountAvatar.tsx
  │   │   │   └── ToolButton.tsx
  │   │   └── stores/
  │   │       └── appStore.ts
  │   ├── panels/             # Each panel is a separate React entry point
  │   │   ├── schedule/
  │   │   ├── templates/
  │   │   ├── ai-helper/
  │   │   ├── broadcast/
  │   │   ├── dashboard/
  │   │   ├── settings/
  │   │   ├── upgrade/
  │   │   └── add-account/
  │   └── shared/             # Shared components + design tokens
  │       ├── ui/             # Button, Input, Card, Toggle, etc.
  │       ├── theme.ts
  │       └── ipc.ts          # IPC helpers
  ├── electron-builder.yml
  ├── vite.config.ts
  ├── tailwind.config.ts
  └── package.json
  ```

**Day 2: Core Components**
- Build shared UI components (matching design system):
  - `<Button>` — primary, secondary, danger variants
  - `<Input>` — text, password, search variants
  - `<Toggle>` — on/off switch
  - `<Card>` — with title, content, actions
  - `<Avatar>` — colored circle with initials
  - `<Badge>` — unread count
  - `<Modal>` — for confirmations (not used for feature panels)
- Build AccountStrip component (the left sidebar)
- Build ToolButton component

**Day 3: Window Manager**
- Implement `window-manager.ts`:
  - `openPanel(panelName, { width, height })` — creates a child BrowserWindow
  - Each panel loads its own React entry point
  - Child windows are modal (parent: mainWindow)
  - Centered on screen, proper shadow/radius on macOS
  - Close button in title bar
  - IPC bridge between panel windows and main process
- Implement `view-manager.ts`:
  - `createView(accountId)` — creates BrowserView with isolated session
  - `switchToView(accountId)` — remove all, add one, set bounds, set zoom
  - `getViewBounds()` — single source of truth for bounds
  - `destroyView(accountId)` — cleanup
  - All views get `zoomFactor(1.0)` on creation

**Day 4: Wire Main Window**
- Main window loads React app (AccountStrip only)
- AccountStrip renders accounts from Zustand store
- Click account → IPC → main process → switchToView
- Click tool → IPC → main process → openPanel
- Right-click account → context menu (Electron Menu, not HTML)
- Onboarding flow as a panel window

**Day 5: Settings Panel**
- Build settings panel (React app, child window):
  - Plan card with upgrade button
  - Account list with rename/remove
  - Phone pairing with code display
  - Notification toggles
  - AI key input
  - General preferences
- All settings read/write via IPC to main process
- Test: open settings, change a toggle, close, verify persistence

### Week 2: Feature Panels + Polish

**Day 6: Schedule + Templates Panels**
- Schedule panel (child window):
  - Contact input, message textarea
  - Date picker (react-day-picker or custom)
  - Time selector
  - Submit → IPC → scheduled-messages.js
  - Upcoming list from IPC
- Templates panel (child window):
  - Grid of saved templates
  - Create/edit/delete
  - Search/filter
  - Tap to copy

**Day 7: AI + Broadcast Panels**
- AI panel (child window):
  - 3 action cards
  - Results display
  - Translation with language picker
  - All calls via IPC → ai-replies.js
- Broadcast panel (child window):
  - Campaign list with status
  - Create form
  - Progress tracking

**Day 8: Dashboard + Upgrade Panels**
- Dashboard panel (child window):
  - Stat cards
  - Simple charts (recharts library or CSS-only)
  - Top contacts table
- Upgrade panel (child window):
  - Monthly/annual toggle
  - Plan comparison cards
  - Checkout button → Lemon Squeezy URL
  - License key input

**Day 9: Integration Testing**
- Test every panel opens and closes cleanly
- Test all IPC calls work between panels and main process
- Test account switching doesn't break panel state
- Test window resizing
- Test all 44 feature modules still initialize
- Fix any bugs found

**Day 10: Build + Package**
- Configure electron-builder for v2
- Build macOS .dmg (signed if Apple Dev cert available)
- Build Windows .exe
- Test both installers
- Verify auto-updater works with new build

### Week 3: Android App (React Native)

**Day 11-12: Project Setup + Core**
- Create `android-v2/` with React Native + TypeScript
- Shared design tokens (same colors, spacing as desktop)
- Build core components:
  - AccountTabs (horizontal, top of screen)
  - WebView per account (isolated)
  - Bottom TabNavigator (Chat, Tools, Settings)
- Account switching via tab press

**Day 13-14: Screens**
- Tools screen (grid of feature cards)
- Settings screen (card-based, same design as desktop)
- Schedule screen
- AI Helper screen
- Add Account flow

**Day 15: Testing + Build**
- Test on real Android device
- Build signed APK
- Test all screens work
- Performance testing (memory with multiple WebViews)

### Week 4: iOS + Final Launch

**Day 16-17: iOS Polish**
- Fix existing SwiftUI app to match new design system
- Match colors, typography, spacing
- Test pairing with desktop v2
- Test notification flow

**Day 18: Cross-Platform Testing**
- Mac app: full test
- Windows app: full test
- Android app: full test
- iOS app: test on simulator + real device
- Mobile pairing: test desktop ↔ iOS connection

**Day 19: Launch Prep**
- Take real screenshots on all platforms
- Record demo video (60 seconds)
- Update landing page with new screenshots
- Update LAUNCH-POSTS.md with v2 messaging
- Code-sign all builds

**Day 20: Launch**
- Upload builds to supamsg.com
- Submit Android to Play Store
- Submit iOS to App Store
- Post on ProductHunt, Reddit, HN, X, IndieHackers
- Monitor for bugs, fix immediately

## Quality Checklist (Every Screen Must Pass)

### Functionality
- [ ] Every button does something when clicked
- [ ] Every toggle saves and persists
- [ ] Every input accepts text and validates
- [ ] Every panel opens AND closes properly
- [ ] Account switching works with consistent dimensions
- [ ] WhatsApp Web loads and stays connected
- [ ] Notifications work across all accounts

### Design Consistency
- [ ] Colors match design tokens exactly
- [ ] Font sizes are only 12/14/16/20px
- [ ] Spacing uses only 8/12/16/24/32px
- [ ] Border radius uses only 8/12/16px
- [ ] All buttons have text labels
- [ ] Maximum 4 actions visible per screen
- [ ] Cards have consistent shadow and border

### UX
- [ ] New user can add account in under 30 seconds
- [ ] Every feature is findable within 2 clicks
- [ ] No screen is confusing — purpose is obvious
- [ ] Error states are clear and actionable
- [ ] Loading states exist for async operations
- [ ] Empty states guide the user to take action

### Performance
- [ ] App launches in under 3 seconds
- [ ] Account switching is instant (< 100ms)
- [ ] Panel windows open in under 500ms
- [ ] Memory stays under 1.5GB with 5 accounts
- [ ] No memory leaks from opening/closing panels

## Files to Keep (Copy to v2)
```
features/*.js         — All 44 modules (unchanged)
preload.js            — IPC bridge (unchanged)
preload-whatsapp.js   — WhatsApp notification intercept (unchanged)
preload-onboarding.js — Onboarding IPC (unchanged)
build/                — Icons (unchanged)
```

## Files to Delete (Replaced by v2)
```
index.html            — Replaced by React renderer
onboarding.html       — Replaced by panel window
```
