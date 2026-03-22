// Centralized WhatsApp Web DOM selectors
// When WhatsApp updates their DOM, only this file needs to change

const SELECTORS = {
  // Chat search
  searchBox: [
    '[data-testid="chat-list-search"]',
    '[contenteditable="true"][data-tab="3"]',
    'div[role="textbox"][title="Search"]',
  ],

  // Message input
  messageInput: [
    '[data-testid="conversation-compose-box-input"]',
    'footer [contenteditable="true"]',
    'div[role="textbox"][title="Type a message"]',
  ],

  // Send button
  sendButton: [
    '[data-testid="send"]',
    'footer button[aria-label="Send"]',
    'span[data-icon="send"]',
  ],

  // Message containers
  messageContainer: [
    '[data-testid="msg-container"]',
    '.message-in, .message-out',
  ],

  // Message text
  messageText: [
    '[data-testid="msg-text"]',
    '.selectable-text',
  ],

  // Chat title/header
  chatTitle: [
    '[data-testid="conversation-info-header-chat-title"]',
    'header span[title]',
  ],

  // Search results
  searchResult: [
    '[data-testid="cell-frame-container"]',
    'div[data-testid="chatlist-panel-body"] div[role="listitem"]',
  ],

  // Message time
  messageTime: [
    '[data-testid="msg-meta"] span',
    '.msg-time',
  ],

  // Double check (sent + read)
  readReceipt: [
    '[data-testid="msg-dblcheck-ack"]',
    '[data-icon="msg-dblcheck-ack"]',
  ],

  // Single check (sent)
  sentCheck: [
    '[data-testid="msg-dblcheck"]',
    '[data-testid="msg-check"]',
  ],

  // Message author (in groups)
  messageAuthor: [
    '[data-testid="msg-author"]',
  ],

  // Status tab
  statusTab: [
    '[data-testid="status-v3-tab"]',
    'div[data-tab="5"]',
  ],

  // Context menu (right-click on message)
  contextMenuDelete: [
    '[data-testid="mi-msg-delete"]',
    'div[aria-label="Delete"]',
  ],

  deleteForEveryone: [
    'div[data-animate-modal-body] button',
  ],
};

// Returns a JS string that tries each selector in order and returns the first match
function selectorQuery(key, method = 'querySelector') {
  const selectors = SELECTORS[key];
  if (!selectors) return 'null';

  const attempts = selectors.map(s => `document.${method}('${s}')`).join(' || ');
  return attempts;
}

// Returns a JS string for querySelectorAll (returns first non-empty result)
function selectorQueryAll(key) {
  const selectors = SELECTORS[key];
  if (!selectors) return '[]';

  return selectors.map(s => {
    return `(function() { var r = document.querySelectorAll('${s}'); return r.length ? r : null; })()`;
  }).join(' || ') + ' || []';
}

// Health check: returns which selectors are found on the current page
function generateHealthCheckScript() {
  let script = '(function() { const results = {};\n';
  for (const [key, selectors] of Object.entries(SELECTORS)) {
    script += `results['${key}'] = {\n`;
    for (const sel of selectors) {
      script += `  '${sel}': !!document.querySelector('${sel}'),\n`;
    }
    script += '};\n';
  }
  script += 'return results; })();';
  return script;
}

module.exports = { SELECTORS, selectorQuery, selectorQueryAll, generateHealthCheckScript };
