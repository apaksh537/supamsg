# SupaMsg — Full Product Audit Report

**Date**: 2026-03-22
**Auditor**: Claude (AI-assisted)
**Scope**: Desktop app (Electron), Android app, iOS app, Landing page, Payment integration, Security

---

## CRITICAL ISSUES (Must Fix Before Launch)

### C1. Lemon Squeezy API Token Exposed in Git History
**Severity**: CRITICAL
**Location**: Chat history / git commits
**Issue**: The LS API token was shared in conversation and may have been committed. Anyone with repo access can make API calls on your behalf.
**Fix**: Revoke the token immediately in Lemon Squeezy dashboard → Settings → API → regenerate. Never commit API tokens.

### C2. No Data Encryption
**Severity**: CRITICAL
**Location**: All JSON files in `~/Library/Application Support/supamsg/`
**Issue**: Passwords, API keys, license keys, WhatsApp session data — all stored as plain JSON. Anyone with file access can read them.
**Fix**: Encrypt sensitive fields using Electron's `safeStorage` API (uses macOS Keychain / Windows DPAPI).
**Files affected**: settings.json, license.json, payment-config.json, twilio-config.json, api-config.json, business-api-accounts.json, crm.json

### C3. WhatsApp Web DOM Selectors Will Break
**Severity**: CRITICAL
**Location**: All features using `executeJavaScript()` — scheduling, broadcast, templates, chatbot, AI agent, export, etc.
**Issue**: WhatsApp Web uses obfuscated class names that change with every update. Selectors like `[data-testid="conversation-compose-box-input"]` can break any time WhatsApp pushes an update.
**Impact**: ~15 feature modules rely on DOM injection. When WhatsApp updates, these features silently fail.
**Fix**:
1. Abstract all DOM selectors into a single `whatsapp-selectors.js` file
2. Add a selector health-check on startup
3. Build a fallback mechanism (try multiple selectors)
4. Monitor WhatsApp Web versions and push selector updates via auto-updater

### C4. Mobile Relay Has No Authentication Security
**Severity**: CRITICAL
**Location**: `features/mobile-relay.js`
**Issue**: WebSocket server on port 8765 with only a 6-digit pairing code. No TLS, no token rotation. Anyone on the same WiFi network can attempt to connect.
**Fix**: Use wss:// (TLS), longer pairing codes, token-based auth after initial pairing, rate limit pairing attempts.

### C5. No Rate Limiting on External APIs
**Severity**: HIGH
**Location**: webhook-api.js (port 3377), zapier-integration.js (port 3378)
**Issue**: HTTP servers have no rate limiting. Vulnerable to DoS and abuse.
**Fix**: Add rate limiting (max 100 requests/minute per IP), request body size limits.

---

## HIGH PRIORITY BUGS

### H1. BrowserView Click Issues
**Severity**: HIGH
**Location**: `main.js`, `index.html`
**Issue**: We already encountered this — `-webkit-app-region: drag` was blocking clicks. There may be remaining edge cases where panels opened via toolbar don't properly hide/show BrowserViews.
**Status**: Partially fixed. Needs thorough manual testing.

### H2. Onboarding Window May Block on First Launch
**Severity**: HIGH
**Location**: `main.js` line ~598
**Issue**: `showOnboarding()` uses `ipcMain.once('finish-onboarding')`. If the user closes the onboarding window via the X button instead of clicking "Let's Go", the promise never resolves and the main app never opens.
**Fix**: Add `onboardingWindow.on('closed', resolve)` as a fallback.

### H3. Multiple HTTP Servers on Fixed Ports
**Severity**: HIGH
**Location**: webhook-api.js (3377), zapier-integration.js (3378), mobile-relay.js (8765)
**Issue**: If ports are already in use, the app crashes silently. No conflict detection.
**Fix**: Try ports, fallback to random port, expose chosen port to user.

### H4. Memory Leak from BrowserViews
**Severity**: HIGH
**Location**: `main.js` `createViewForAccount()`
**Issue**: Each WhatsApp Web instance uses 200-500MB RAM. 10 accounts = 2-5GB. No limit enforced. App will slow/crash on machines with limited RAM.
**Fix**:
1. Enforce max accounts based on available RAM
2. Unload inactive views (keep session, destroy WebContents, reload on switch)
3. Show memory usage in settings

### H5. No Error Boundaries
**Severity**: HIGH
**Location**: All 44 feature modules
**Issue**: If ANY feature module throws during initialization, the entire app crashes. No try-catch around `initFeatureName()` calls.
**Fix**: Wrap every init call in try-catch:
```js
try { initConversationKanban(featureCtx); } catch(e) { console.error('Failed to init kanban:', e); }
```

### H6. Template Injection / XSS in Account Names
**Severity**: HIGH
**Location**: `index.html` renderAccounts()
**Issue**: Account names are inserted via innerHTML without sanitization. A name containing `<script>` or `<img onerror=...>` could execute arbitrary code.
**Fix**: Use textContent or sanitize HTML.

---

## MEDIUM PRIORITY ISSUES

### M1. No Offline Handling
**Issue**: App doesn't handle network disconnection gracefully. WhatsApp Web shows its own "Phone not connected" but the app's features (AI, payments, license validation) will fail silently.
**Fix**: Add network status detection, show banner, queue operations for retry.

### M2. No Loading States
**Issue**: AI operations (suggest replies, summarize, translate) have no loading indicators. User clicks button, nothing happens for 3-5 seconds, then result appears.
**Fix**: Add spinners/skeleton states for all async operations.

### M3. No Input Validation
**Issue**: Most form inputs accept any value. Price fields accept negative numbers, email fields accept garbage, phone fields have no format validation.
**Fix**: Add validation before sending to IPC handlers.

### M4. Scheduled Messages Don't Retry
**Issue**: If a scheduled message fails (contact not found, send button changed), it's marked as "failed" permanently. No retry mechanism.
**Fix**: Add retry count (max 3), exponential backoff.

### M5. Analytics Data Grows Unbounded
**Issue**: analytics.json grows indefinitely. After a year of heavy use, it could be several MB, slowing down reads.
**Fix**: Already has 90-day pruning for daily data but hourly aggregates never prune.

### M6. Broadcast Has No Opt-Out Mechanism
**Issue**: Broadcast campaigns send to all listed contacts with no way for recipients to opt out. This could get phone numbers banned by WhatsApp.
**Fix**: Add opt-out tracking, honor "STOP" replies, add warning in UI.

### M7. Team Inbox Is Local-Only
**Issue**: team-inbox.js stores everything locally. It doesn't actually enable multiple people to use the same account — it's just a data model for assignments. True team features need a backend server.
**Fix**: Document this limitation clearly. Build backend for v2.

### M8. Cross-Messenger Support Incomplete
**Issue**: cross-messenger.js creates BrowserViews for Telegram/Instagram but doesn't handle their specific notification formats, login flows, or message extraction.
**Fix**: Each messenger needs its own notification interception and DOM scraping logic.

### M9. No Undo for Destructive Actions
**Issue**: Deleting accounts, labels, templates, automations — no undo, no confirmation for some.
**Fix**: Add confirmation dialogs for all destructive actions, implement undo stack.

### M10. Auto-Translate Can Be Expensive
**Issue**: Every incoming message from a contact with a language preference triggers a Claude API call. At 100 messages/day, that's 100 API calls = ~$1-2/day.
**Fix**: Add daily limit, batch translations, cache aggressively.

---

## DESIGN ISSUES

### D1. Single 1500+ Line HTML File
**Issue**: All UI is in one `index.html` file (~1500 lines). Unmaintainable, no component reuse, hard to update.
**Fix**: Split into components or at minimum separate CSS/JS files. Consider migrating to React/Vue for the renderer.

### D2. Inconsistent Spacing & Typography
**Issue**: Padding, margins, font sizes vary across panels. No design system or CSS variables for spacing.
**Fix**: Create a design token system (CSS variables for spacing-xs through spacing-xl, font sizes, colors).

### D3. No Dark/Light Mode Toggle
**Issue**: App is dark mode only. Some users prefer light mode. No way to switch.
**Fix**: Add theme toggle in settings, define both color palettes.

### D4. Toolbar Icons Are Unicode Characters
**Issue**: Toolbar uses Unicode symbols (&#9998;, &#9889;, etc.) which render differently across platforms and look unprofessional.
**Fix**: Use SVG icons (Lucide, Heroicons, or custom).

### D5. Panel Overlays Have No Animation
**Issue**: Panels appear/disappear instantly. Feels jarring.
**Fix**: Add CSS transitions (slide-up, fade-in) for panel open/close.

### D6. No Empty States Design
**Issue**: Empty states ("No templates yet") are plain text. Missing illustrations or helpful onboarding CTAs.
**Fix**: Add illustrations, "Getting started" links in empty states.

### D7. Mobile Apps Have No UI Yet
**Issue**: Android and iOS apps are code-complete but have no equivalent of the desktop toolbar. Android is pure WebView, iOS is SwiftUI views but never built/tested.
**Fix**: Android needs a bottom nav with features. iOS needs Xcode project setup and testing.

### D8. Landing Page Is Generic
**Issue**: Landing page was auto-generated with placeholder content. App preview screenshot is a mock, not real. Testimonials are fake.
**Fix**: Replace with real screenshots, remove fake testimonials, add real demo video.

### D9. Upgrade Panel Pricing Cards Look Cramped
**Issue**: Three pricing cards side by side with lots of text. Hard to scan on smaller screens.
**Fix**: Make cards taller, add more visual hierarchy, use icons for feature lists.

### D10. No Onboarding for Power Features
**Issue**: 44 features but no feature discovery. New users won't know about AI, automations, Kanban, etc.
**Fix**: Add feature tooltips, first-use tutorials, "What's new" panel after updates.

---

## UNTESTED FEATURES (Never Executed)

These features compile but have NEVER been run with real data:

| Feature | Risk Level | Why It Might Fail |
|---|---|---|
| Conversation Kanban | Low | Pure data storage, should work |
| Smart Notifications | Low | Keyword matching, should work |
| Quick Actions | Medium | Cross-account search injects JS into multiple views |
| Voice Transcription | High | Needs Claude API + audio extraction from DOM |
| Message Recall | High | DOM manipulation to find and delete specific messages |
| Collaborative Notes | Low | Pure data storage |
| Timezone Scheduler | Medium | Timezone conversion + DOM injection |
| Sentiment Alerts | Low | Keyword matching |
| Payment Collection | High | External API calls (Razorpay/Stripe) |
| Product Catalog | Medium | DOM injection for sending products |
| Appointment Booking | Medium | Complex date/time logic |
| Status Manager | High | WhatsApp Status tab has different DOM than chat |
| Chatbot Builder | High | State machine + DOM injection for every response |
| Chat Backup | Medium | File system operations, could hit permission issues |
| Webhook API | High | HTTP server + auth + DOM scraping for messages |
| AI Insights | High | Large Claude API calls, complex prompts |
| E-commerce Tracking | Medium | Template messages via DOM injection |
| AI Agent Mode | Very High | Autonomous conversation loop — could send wrong messages |
| Zapier Integration | High | HTTP server + event queuing |
| White-Label | Medium | CSS injection, text replacement |
| Cross-Messenger | High | Telegram/Instagram have different DOMs |
| Screen Mirror | High | Requires scrcpy + adb installed |
| Virtual Numbers | High | Twilio API integration |
| SMS Bridge | High | Twilio API + fallback logic |
| Team Inbox | Low | Pure data storage (no real multi-user) |
| Advanced Analytics | Medium | Reads from analytics data, math calculations |
| Auto-Translate | High | Claude API for every message |
| Custom Dashboard | Medium | Depends on data from other modules |
| WhatsApp Business API | Very High | Meta API integration, webhook verification |
| Conversation Search | High | JS injection across multiple BrowserViews |

---

## CROSS-PLATFORM SYNC ISSUE

### Current State
- Mac, Windows, Android, iPhone are completely independent
- No shared backend, no user accounts, no cloud database
- Connecting WhatsApp on Mac does NOT show on Android
- Settings, templates, labels — nothing syncs

### What's Needed
1. **User accounts** — signup/login system
2. **Cloud database** — store settings, templates, labels, notes
3. **Session tokens** — can't sync WhatsApp sessions (each device must scan QR independently — this is a WhatsApp limitation)
4. **Real-time sync** — WebSocket or Firebase for live data sync

### Reality Check
WhatsApp sessions fundamentally cannot be synced between devices — each device is a separate "linked device" and WhatsApp limits to 4 companions. The app can sync non-WhatsApp data (templates, labels, settings) but users will always need to scan QR codes on each device.

---

## PRIVACY & SECURITY SUMMARY

| Area | Status | Risk |
|---|---|---|
| WhatsApp messages | Stored by WhatsApp Web, not by us | Low |
| User settings & API keys | Plain text JSON files | HIGH — encrypt with safeStorage |
| License keys | Plain text | Medium |
| Mobile relay | Unencrypted WebSocket | HIGH — add TLS |
| Webhook API | API key auth but no TLS | Medium |
| Analytics data | Local only, no PII | Low |
| Backup files | Contain all settings including keys | HIGH — encrypt backups |
| Git repo | API token was shared in chat | CRITICAL — revoke token |

---

## RECOMMENDED PRIORITY ORDER

### Before Launch (This Week)
1. Revoke Lemon Squeezy API token, regenerate
2. Wrap all feature inits in try-catch (H5)
3. Fix onboarding close handler (H2)
4. Add error boundaries to prevent crashes
5. Test core flow: add account → open chat → send message → switch accounts
6. Test upgrade flow: click upgrade → checkout → enter license key
7. Replace fake testimonials on landing page
8. Add WhatsApp anti-spam warning in broadcast UI

### Week 1 After Launch
9. Abstract DOM selectors into single file (C3)
10. Encrypt sensitive data with safeStorage (C2)
11. Add rate limiting to HTTP servers (C5)
12. Fix memory management for many accounts (H4)
13. Add loading states for async operations (M2)
14. Sanitize HTML inputs (H6)

### Week 2-3
15. Add proper SVG icons to toolbar (D4)
16. Split index.html into components (D1)
17. Add TLS to mobile relay (C4)
18. Test all 30 new features individually
19. Build real app screenshots for landing page
20. Record demo video
