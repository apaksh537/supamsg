# SupaMsg

All your WhatsApps. One window. Manage multiple WhatsApp accounts, schedule messages, get unified notifications — all from your Mac.

## Features

**Core**
- Multi-account WhatsApp Web with isolated sessions
- Native macOS notifications with unread badges (per-account + dock)
- System tray with background running
- Global hotkey (Ctrl+Shift+W) to show/hide
- Collapsible sidebar, drag-to-reorder accounts
- Onboarding flow for first-time setup

**Power Features (Pro)**
- AI Assistant — smart replies, summarize, translate, draft, sentiment analysis (Claude API)
- Scheduled Messages — compose now, send later
- Message Templates — canned responses with variables ({name}, {date})
- Chat Export — save conversations to text/CSV
- Split Screen — view 2 accounts side-by-side (Cmd+D)
- Analytics Dashboard — message volume, peak hours, trends
- Stealth Mode — hide read receipts, typing, online status per account

**Business Features**
- Automations — rule engine with triggers and actions (auto-reply, templates, labels)
- Broadcast Campaigns — bulk personalized messages with {name} merge
- CRM Integration — HubSpot + Zoho (search, log conversations, sync)
- Contact Labels — tag contacts (VIP, Work, Family, custom)

**Keyboard Shortcuts**
| Shortcut | Action |
|---|---|
| Cmd+1-9 | Switch accounts |
| Cmd+K | Command palette |
| Cmd+J | AI Assistant |
| Cmd+D | Split screen |
| Cmd+T | Templates |
| Cmd+E | Export chat |
| Cmd+\ | Toggle sidebar |
| Ctrl+Shift+W | Show/hide app (global) |

## Quick Start

```bash
git clone https://github.com/apaksh-gupta/supamsg.git
cd supamsg
npm install
npm start
```

## Build for Distribution

```bash
# macOS .dmg and .zip
npm run build:mac

# Windows .exe installer
npm run build:win
```

The built app will be in the `dist/` folder.

## Stripe Payment Setup

1. Create a [Stripe account](https://stripe.com)
2. Create 2 Products in the [Stripe Dashboard](https://dashboard.stripe.com/products):
   - **Pro** — $9/month (or $79/year)
   - **Business** — $19/month (or $149/year)
3. Copy the Price IDs
4. Deploy the webhook server (see below)
5. Set up a Webhook in Stripe Dashboard → Developers → Webhooks:
   - URL: `https://your-server.com/webhook`
   - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`

## Deploy Webhook Server

### Option A: Vercel (Recommended)

```bash
cd server
# Set environment variables in Vercel dashboard
vercel --prod
```

### Option B: Any Node.js host (Railway, Fly.io, etc.)

```bash
cd server
cp .env.example .env
# Edit .env with your Stripe keys
node webhook.js
```

### Environment Variables

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (whsec_...) |
| `STRIPE_PRO_PRICE_IDS` | Comma-separated Stripe Price IDs for Pro tier |
| `STRIPE_BUSINESS_PRICE_IDS` | Comma-separated Stripe Price IDs for Business tier |
| `LICENSE_SECRET` | License key signing secret (must match app) |

## Deploy Landing Page

```bash
cd landing
vercel --prod
# Or connect to Netlify via GitHub
```

## Project Structure

```
supamsg/
├── main.js                     # Electron main process
├── index.html                  # App UI (sidebar + all feature panels)
├── preload.js                  # IPC bridge for renderer
├── onboarding.html             # First-launch walkthrough
├── features/
│   ├── ai-replies.js           # Claude API integration
│   ├── analytics.js            # Message tracking + stats
│   ├── automations.js          # Rule engine
│   ├── broadcast.js            # Campaign manager
│   ├── chat-export.js          # Export to text/CSV
│   ├── contact-labels.js       # Contact tagging
│   ├── crm-integration.js      # HubSpot + Zoho
│   ├── licensing.js            # License keys + feature gates
│   ├── scheduled-messages.js   # Send later
│   ├── split-screen.js         # Dual view
│   ├── stealth-mode.js         # Privacy controls
│   └── templates.js            # Canned responses
├── server/
│   ├── webhook.js              # Standalone webhook server
│   ├── api/index.js            # Vercel serverless function
│   ├── vercel.json             # Vercel config
│   └── .env.example            # Environment variables template
├── landing/
│   ├── index.html              # Marketing landing page
│   └── success.html            # Post-checkout success page
├── build/
│   ├── icon.svg                # Source icon
│   ├── icon.png                # 1024x1024 PNG
│   ├── icon.icns               # macOS icon
│   └── generate-icons.sh       # Icon conversion script
└── STRATEGY.md                 # Feature roadmap + monetization strategy
```

## Tech Stack

- **Electron** — desktop app framework
- **WhatsApp Web** — loaded in isolated BrowserViews per account
- **Claude API** (@anthropic-ai/sdk) — AI features
- **Stripe** — payments and subscriptions
- **Vanilla JS/HTML/CSS** — no frontend framework (fast, simple)

## License

Private. All rights reserved.
