# SupaMsg — Complete Product Rebuild Plan

## Why Rebuild

The current prototype proved the concept works — multi-WhatsApp accounts, AI features, scheduling, templates, etc. But the codebase is a single HTML file with 2500+ lines of tangled CSS/JS, BrowserView management that breaks on every change, and a UX that confuses users. Patching won't fix it. Clean architecture will.

## What Changes

| Aspect | Current (Prototype) | Rebuilt (v2) |
|---|---|---|
| **UI Framework** | Vanilla HTML/CSS in one file | React + Tailwind CSS |
| **State Management** | Global variables + IPC chaos | Zustand (simple, lightweight) |
| **Component System** | None — inline HTML strings | Reusable React components |
| **Styling** | 1000+ lines of inline CSS | Tailwind + design tokens |
| **BrowserView Management** | Broken — views render over panels | Dedicated window management with proper z-ordering |
| **Navigation** | Hidden settings, confusing strip | Tab-based navigation that works |
| **Panels/Dialogs** | Panel overlays hidden behind views | Child BrowserWindows for panels (guaranteed to render on top) |
| **Mobile** | Untested code | React Native (shared design language with desktop) |

## Architecture Decision: How to Fix the BrowserView Problem

The #1 recurring bug: **panels render behind BrowserViews because BrowserViews are native layers that always sit on top of renderer HTML.**

### Solution: Two-Window Architecture

```
┌─────────────────────────────────────────────────┐
│ MAIN WINDOW (frameless, full screen)            │
│                                                 │
│ ┌──────┬──────────────────────────────────────┐ │
│ │ NAV  │                                      │ │
│ │ STRIP│     BrowserView (WhatsApp Web)       │ │
│ │      │     (one per account)                │ │
│ │ acct │                                      │ │
│ │ acct │                                      │ │
│ │      │                                      │ │
│ │ tools│                                      │ │
│ │      │                                      │ │
│ └──────┴──────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘

When user clicks a tool (Schedule, AI, Settings, etc.):

┌─────────────────────────────────────────────────┐
│ MAIN WINDOW (dimmed)                            │
│                                                 │
│   ┌───────────────────────────────────────┐     │
│   │ PANEL WINDOW (child, modal, on top)   │     │
│   │                                       │     │
│   │  Schedule / AI / Settings / etc.      │     │
│   │  (React app, guaranteed on top)       │     │
│   │                                       │     │
│   │                         [Close]       │     │
│   └───────────────────────────────────────┘     │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Panels are separate BrowserWindows** — they're child windows that are modal and always render on top of BrowserViews. This completely eliminates the "panel behind view" problem. No more hideViews/showViews hacks.

## Design System

### Universal Principles (All Platforms)
1. **Familiar first** — looks like the messaging apps users already know
2. **Everything labeled** — no icon-only buttons anywhere
3. **Max 4 actions visible** at any level — progressive disclosure for advanced features
4. **One thing per screen** — no multi-panel layouts on mobile, clean focus
5. **Consistent spacing** — 8px grid everywhere
6. **Two themes** — Light (default) and Dark (user toggle)

### Color System
```
Primary:       #25D366 (WhatsApp green)
Primary Dark:  #075E54
Background:    #FFFFFF (light) / #0d0d1a (dark)
Surface:       #F5F5F5 (light) / #16213e (dark)
Text Primary:  #111B21 (light) / #E0E0E0 (dark)
Text Secondary:#667781 (light) / #7A7A9E (dark)
Border:        #E8E8E8 (light) / #0f3460 (dark)
Error:         #FF3B30
Warning:       #FFB74D
```

### Typography
```
Title:      20px / 700 weight
Heading:    16px / 600 weight
Body:       14px / 400 weight
Caption:    12px / 500 weight
```

### Spacing
```
xs: 4px   sm: 8px   md: 12px   lg: 16px   xl: 24px   xxl: 32px
```

### Border Radius
```
Small: 8px (buttons, inputs)
Medium: 12px (cards)
Large: 16px (modals, sheets)
Round: 50% (avatars)
```

## Screen-by-Screen Design

### DESKTOP (Mac + Windows)

#### Screen 1: Main View
```
┌──────┬────────────────────────────────────────┐
│  ZA  │                                        │
│ Zara │     WhatsApp Web (full area)            │
│      │                                        │
│  AR  │     ← This is the BrowserView          │
│ Aria │        User's actual WhatsApp           │
│      │                                        │
│ ──── │                                        │
│  +   │                                        │
│ Add  │                                        │
│      │                                        │
│ ──── │                                        │
│  📅  │                                        │
│  ✨  │                                        │
│  📋  │                                        │
│  📊  │                                        │
│  ⚙  │                                        │
└──────┘────────────────────────────────────────┘
```

Left strip (80px):
- Top: Account avatars (click to switch, right-click to rename/delete)
- Middle: + Add Account
- Bottom: Tool icons WITH labels (Schedule, AI, Templates, Stats, Settings)
- Each tool opens a CHILD WINDOW (not an overlay)

#### Screen 2: Tool Panel (Child Window)
Opens as a separate window, always on top:
- Clean header: Tool name + close button
- Content area: The actual tool UI
- No interference with WhatsApp Web behind it

#### Screen 3: Settings (Child Window)
Card-based layout:
- My Plan (green banner, tap to upgrade)
- My Accounts (list with rename/delete)
- Connect Phone (pairing for mobile app)
- Notifications (simple toggles)
- AI Setup (API key input)
- About

#### Screen 4: Schedule Message
Simple form:
- Who: contact name
- What: message text
- When: visual date + time picker
- [Schedule] button
- List of upcoming scheduled messages below

#### Screen 5: AI Helper
Chat-like interface:
- 3 big buttons: Suggest Reply, Summarize, Translate
- Results appear as cards
- Copy button on each result

#### Screen 6: Templates
Grid of saved quick replies:
- Tap to copy/insert
- + Create new
- Edit/delete on hover

### ANDROID APP

#### Approach: React Native (Shared Design with Desktop)
- Same design system, same colors, same components
- Bottom tab navigation: Accounts, Inbox, Tools, Settings
- Each account is a WebView loading WhatsApp Web
- Swipe to switch between accounts

#### Android Screens:
1. **Home** — Tab bar with accounts as tabs, WebView fills screen
2. **Inbox** — Notification aggregation (messages from all accounts)
3. **Tools** — Grid of feature cards (Schedule, Replies, AI, Export)
4. **Settings** — Same card-based layout as desktop

### iOS APP

#### Approach: SwiftUI (Native iOS feel)
- Same design system but with iOS-native components
- Tab bar: Inbox, Accounts, Settings
- Pairs with desktop app via WebSocket

#### iOS Screens:
1. **Inbox** — Unified message feed from all accounts
2. **Accounts** — Paired accounts with status
3. **Quick Reply** — Reply directly from the app
4. **Settings** — Pairing, notifications, plan

### WEB (supamsg.com/app)
- React web app (same components as desktop renderer)
- Progressive Web App for Chromebook/Linux
- Limited functionality (WhatsApp Web in iframe, may be blocked by CSP)

## Execution Plan

### Phase 1: Desktop Rebuild (2 weeks)

**Week 1: Core Architecture**
- Day 1-2: Set up React + Tailwind + Electron boilerplate
  - Vite for build (fast HMR)
  - Zustand for state
  - React Router for navigation
  - Design tokens in Tailwind config
- Day 3-4: Build core components
  - AccountStrip (left sidebar)
  - BrowserViewManager (handles all view logic in main process)
  - ChildWindowManager (spawns panel windows)
  - Layout shell
- Day 5: Wire up WhatsApp Web BrowserViews
  - Account switching (tested, working)
  - Zoom factor consistency
  - Session persistence

**Week 2: Features + Polish**
- Day 6-7: Build panel windows for each tool
  - Settings panel (child window)
  - Schedule panel
  - Templates panel
  - AI panel
- Day 8-9: Wire all 44 feature modules
  - IPC bridge from React to main process
  - Each feature module stays as-is (they work)
  - Only the UI changes
- Day 10: Testing + bug fixes
  - Test every button click
  - Test account switching
  - Test panel open/close
  - Test upgrade flow

### Phase 2: Android Rebuild (1 week)

- Day 1-2: React Native project setup with shared design system
- Day 3-4: WebView management + account switching
- Day 5: Build remaining screens (Tools, Settings)
- Day 6-7: Testing on real device

### Phase 3: iOS Polish (3-4 days)

- Fix existing SwiftUI app
- Match design system
- Test pairing with desktop
- Submit to App Store

### Phase 4: Testing + Launch (3-4 days)

- End-to-end testing on all platforms
- Build signed installers (macOS .dmg, Windows .exe, Android .apk)
- Update landing page with real screenshots
- Launch

## What We Keep (Don't Rebuild)

These are GOOD and stay exactly as they are:
- All 44 feature modules in `features/*.js` (main process logic)
- `main.js` core: app lifecycle, tray, notifications, session management
- `preload.js` IPC bridge
- Lemon Squeezy integration
- Auto-updater
- Mobile relay (WebSocket server)
- Landing page + legal pages
- All documentation

## What We Replace

- `index.html` (2500 lines) → React app with proper components
- BrowserView panel hacks → Child window architecture
- CSS chaos → Tailwind with design tokens
- Global state variables → Zustand store

## Estimated Timeline

| Phase | Duration | Output |
|---|---|---|
| Desktop rebuild | 2 weeks | Working Mac + Windows app with all features |
| Android rebuild | 1 week | Working Android app on Play Store |
| iOS polish | 3-4 days | Working iOS app on App Store |
| Testing + launch | 3-4 days | All platforms tested and published |
| **Total** | **4 weeks** | **Complete product on all platforms** |

## Decision Needed

Before starting, you need to decide:

1. **Do we rebuild now or launch the prototype first?**
   - Option A: Rebuild first (4 weeks), launch polished product
   - Option B: Launch prototype now, rebuild in parallel, push updates

2. **React Native for Android or keep native Kotlin?**
   - React Native: shared components with desktop, faster development
   - Native Kotlin: better performance, already built

3. **Pricing: keep all features free during beta?**
   - Yes: faster adoption, get feedback
   - No: validate willingness to pay early

My recommendation: **Option B** — launch the prototype NOW with the core feature (multi-WhatsApp) working, collect user feedback, rebuild in parallel. The prototype is good enough for the core use case. The advanced features can come in v2.
