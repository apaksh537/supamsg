const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  // Accounts
  switchAccount: (id) => ipcRenderer.send('switch-account', id),
  addAccount: (name) => ipcRenderer.send('add-account', name),
  renameAccount: (id, name) => ipcRenderer.send('rename-account', { id, name }),
  removeAccount: (id) => ipcRenderer.send('remove-account', id),
  reloadAccount: (id) => ipcRenderer.send('reload-account', id),
  reorderAccounts: (ids) => ipcRenderer.send('reorder-accounts', ids),

  // Panels (child BrowserWindows)
  openPanel: (name) => ipcRenderer.send('open-panel', name),
  closePanel: (name) => ipcRenderer.send('close-panel', name),

  // Settings
  updateSettings: (s) => ipcRenderer.send('update-settings', s),
  toggleSidebar: () => ipcRenderer.send('toggle-sidebar'),
  setUiMode: (mode) => ipcRenderer.send('set-ui-mode', mode),

  // Split screen
  toggleSplitScreen: (opts) => ipcRenderer.send('toggle-split-screen', opts),
  setSplitAccount: (side, accountId) => ipcRenderer.send('set-split-account', { side, accountId }),

  // Scheduled messages
  getSchedules: () => ipcRenderer.invoke('get-schedules-async'),
  addSchedule: (s) => ipcRenderer.send('add-schedule', s),
  cancelSchedule: (id) => ipcRenderer.send('cancel-schedule', id),

  // Templates
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  saveTemplate: (t) => ipcRenderer.send('save-template', t),
  deleteTemplate: (id) => ipcRenderer.send('delete-template', id),
  insertTemplate: (templateId, variables) => ipcRenderer.send('insert-template', { templateId, variables }),

  // Chat export
  exportChat: (opts) => ipcRenderer.invoke('export-chat', opts),

  // Contact labels
  getLabels: () => ipcRenderer.invoke('get-labels'),
  createLabel: (name, color) => ipcRenderer.send('create-label', { name, color }),
  updateLabel: (id, name, color) => ipcRenderer.send('update-label', { id, name, color }),
  deleteLabel: (id) => ipcRenderer.send('delete-label', id),
  assignLabel: (contactKey, labelId) => ipcRenderer.send('assign-label', { contactKey, labelId }),
  removeLabelFromContact: (contactKey, labelId) => ipcRenderer.send('remove-label-from-contact', { contactKey, labelId }),

  // Analytics
  getAnalytics: () => ipcRenderer.invoke('get-analytics'),
  getAnalyticsSummary: (accountId) => ipcRenderer.invoke('get-analytics-summary', accountId),

  // AI Replies
  aiSuggestReplies: (messages) => ipcRenderer.invoke('ai-suggest-replies', { messages }),
  aiSummarize: (messages) => ipcRenderer.invoke('ai-summarize', { messages }),
  aiTranslate: (text, targetLanguage) => ipcRenderer.invoke('ai-translate', { text, targetLanguage }),
  aiDraftReply: (messages, instruction) => ipcRenderer.invoke('ai-draft-reply', { messages, instruction }),
  aiAnalyzeSentiment: (messages) => ipcRenderer.invoke('ai-analyze-sentiment', { messages }),
  aiGetChatMessages: () => ipcRenderer.invoke('ai-get-chat-messages'),

  // Automations
  getAutomations: () => ipcRenderer.invoke('get-automations'),
  saveAutomation: (rule) => ipcRenderer.send('save-automation', rule),
  deleteAutomation: (id) => ipcRenderer.send('delete-automation', id),
  toggleAutomation: (id) => ipcRenderer.send('toggle-automation', id),

  // Broadcast / Campaigns
  getCampaigns: () => ipcRenderer.invoke('get-campaigns'),
  saveCampaign: (c) => ipcRenderer.send('save-campaign', c),
  deleteCampaign: (id) => ipcRenderer.send('delete-campaign', id),
  startCampaign: (id) => ipcRenderer.send('start-campaign', id),
  pauseCampaign: (id) => ipcRenderer.send('pause-campaign', id),
  resumeCampaign: (id) => ipcRenderer.send('resume-campaign', id),

  // Stealth Mode
  getStealthSettings: () => ipcRenderer.invoke('get-stealth-settings'),
  updateStealth: (accountId, settings) => ipcRenderer.send('update-stealth', { accountId, settings }),

  // CRM Integration
  getCrmSettings: () => ipcRenderer.invoke('get-crm-settings'),
  updateCrmSettings: (s) => ipcRenderer.send('update-crm-settings', s),
  crmSearchContact: (name, phone) => ipcRenderer.invoke('crm-search-contact', { name, phone }),
  crmLogConversation: (contactKey, messages, summary) => ipcRenderer.invoke('crm-log-conversation', { contactKey, messages, summary }),
  crmLinkContact: (contactKey, crmContact) => ipcRenderer.send('crm-link-contact', { contactKey, crmContact }),

  // Panels
  openPanel: (name) => ipcRenderer.send('open-panel', name),
  closePanel: (name) => ipcRenderer.send('close-panel', name),

  // Pairing
  generatePairingQR: () => ipcRenderer.invoke('generate-pairing-qr'),

  // Dialogs (native)
  showInputDialog: (opts) => ipcRenderer.invoke('show-input-dialog', opts),
  showConfirmDialog: (opts) => ipcRenderer.invoke('show-confirm-dialog', opts),
  hideViews: () => ipcRenderer.send('hide-views'),
  showViews: () => ipcRenderer.send('show-views'),

  // Licensing (Lemon Squeezy)
  getLicense: () => ipcRenderer.invoke('get-license'),
  checkFeature: (name) => ipcRenderer.invoke('check-feature', name),
  getTiers: () => ipcRenderer.invoke('get-tiers'),
  activateLicense: (licenseKey, email) => ipcRenderer.invoke('activate-license', { licenseKey, email }),
  deactivateLicense: () => ipcRenderer.invoke('deactivate-license'),
  validateLicense: () => ipcRenderer.invoke('validate-license'),
  getCheckoutUrl: (tier, annual) => ipcRenderer.invoke('get-checkout-url', { tier, annual }),
  getCustomerPortalUrl: () => ipcRenderer.invoke('get-customer-portal-url'),

  // Event listeners
  onLoadAccounts: (cb) => ipcRenderer.on('load-accounts', (_e, d) => cb(d)),
  onAccountSwitched: (cb) => ipcRenderer.on('account-switched', (_e, d) => cb(d)),
  onSettingsUpdated: (cb) => ipcRenderer.on('settings-updated', (_e, d) => cb(d)),
  onUnreadCounts: (cb) => ipcRenderer.on('unread-counts', (_e, d) => cb(d)),
  onSplitScreenChanged: (cb) => ipcRenderer.on('split-screen-changed', (_e, d) => cb(d)),
  onSchedulesUpdated: (cb) => ipcRenderer.on('schedules-updated', (_e, d) => cb(d)),
  onTemplatesUpdated: (cb) => ipcRenderer.on('templates-updated', (_e, d) => cb(d)),
  onLabelsUpdated: (cb) => ipcRenderer.on('labels-updated', (_e, d) => cb(d)),
  onCampaignProgress: (cb) => ipcRenderer.on('campaign-progress', (_e, d) => cb(d)),
  onAutomationsUpdated: (cb) => ipcRenderer.on('automations-updated', (_e, d) => cb(d)),
  onLicenseUpdated: (cb) => ipcRenderer.on('license-updated', (_e, d) => cb(d)),
  onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_e, d) => cb(d)),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_e, d) => cb(d)),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  installUpdate: () => ipcRenderer.send('install-update'),
});
