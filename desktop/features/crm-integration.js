// CRM Integration: HubSpot & Zoho two-way sync
// Logs WhatsApp conversations as CRM activities, shows contact context

const path = require('path');
const fs = require('fs');
const https = require('https');

let crmPath;
let crmSettings = {
  hubspot: { enabled: false, apiKey: '', portalId: '' },
  zoho: { enabled: false, apiKey: '', orgId: '' },
};
let contactCache = {}; // "contactName:accountId" -> { crmId, company, dealStage, lastActivity, ... }

function initCrmIntegration({ app, ipcMain, getMainWindow }) {
  crmPath = path.join(app.getPath('userData'), 'crm.json');
  loadSettings();

  ipcMain.handle('get-crm-settings', () => crmSettings);
  ipcMain.handle('get-crm-contact', (_e, contactKey) => contactCache[contactKey] || null);
  ipcMain.handle('get-crm-contacts', () => contactCache);

  ipcMain.on('update-crm-settings', (_event, newSettings) => {
    crmSettings = { ...crmSettings, ...newSettings };
    saveSettings();
    getMainWindow()?.webContents.send('crm-settings-updated', crmSettings);
  });

  // Search CRM for a contact
  ipcMain.handle('crm-search-contact', async (_event, { name, phone }) => {
    const results = [];

    if (crmSettings.hubspot.enabled && crmSettings.hubspot.apiKey) {
      try {
        const hsResults = await hubspotSearchContact(name, phone);
        results.push(...hsResults.map((r) => ({ ...r, source: 'hubspot' })));
      } catch (e) {
        return { error: `HubSpot error: ${e.message}` };
      }
    }

    if (crmSettings.zoho.enabled && crmSettings.zoho.apiKey) {
      try {
        const zohoResults = await zohoSearchContact(name, phone);
        results.push(...zohoResults.map((r) => ({ ...r, source: 'zoho' })));
      } catch (e) {
        return { error: `Zoho error: ${e.message}` };
      }
    }

    return { results };
  });

  // Log a conversation to CRM
  ipcMain.handle('crm-log-conversation', async (_event, { contactKey, messages, summary }) => {
    const cached = contactCache[contactKey];
    if (!cached) return { error: 'Contact not linked to CRM' };

    if (cached.source === 'hubspot' && crmSettings.hubspot.enabled) {
      return await hubspotLogActivity(cached.crmId, messages, summary);
    }
    if (cached.source === 'zoho' && crmSettings.zoho.enabled) {
      return await zohoLogActivity(cached.crmId, messages, summary);
    }

    return { error: 'CRM not configured for this contact' };
  });

  // Link a WhatsApp contact to a CRM contact
  ipcMain.on('crm-link-contact', (_event, { contactKey, crmContact }) => {
    contactCache[contactKey] = crmContact;
    saveSettings();
    getMainWindow()?.webContents.send('crm-contact-linked', { contactKey, crmContact });
  });

  ipcMain.on('crm-unlink-contact', (_event, contactKey) => {
    delete contactCache[contactKey];
    saveSettings();
  });
}

// ── HubSpot API ──────────────────────────────────────────────

function hubspotSearchContact(name, phone) {
  return new Promise((resolve, reject) => {
    const searchBody = JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: 'firstname', operator: 'CONTAINS_TOKEN', value: name.split(' ')[0] },
          ],
        },
        ...(phone
          ? [{ filters: [{ propertyName: 'phone', operator: 'CONTAINS_TOKEN', value: phone }] }]
          : []),
      ],
      properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'lifecyclestage'],
      limit: 5,
    });

    const req = https.request(
      {
        hostname: 'api.hubapi.com',
        path: '/crm/v3/objects/contacts/search',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${crmSettings.hubspot.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(searchBody),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.results) {
              resolve(
                parsed.results.map((r) => ({
                  crmId: r.id,
                  name: `${r.properties.firstname || ''} ${r.properties.lastname || ''}`.trim(),
                  email: r.properties.email,
                  phone: r.properties.phone,
                  company: r.properties.company,
                  stage: r.properties.lifecyclestage,
                }))
              );
            } else {
              resolve([]);
            }
          } catch (e) {
            reject(new Error('Invalid HubSpot response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(searchBody);
    req.end();
  });
}

function hubspotLogActivity(contactId, messages, summary) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: `WhatsApp Conversation Summary:\n${summary}\n\n---\nMessages:\n${messages
          .map((m) => `[${m.time}] ${m.sender}: ${m.text}`)
          .join('\n')}`,
      },
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
        },
      ],
    });

    const req = https.request(
      {
        hostname: 'api.hubapi.com',
        path: '/crm/v3/objects/notes',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${crmSettings.hubspot.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ success: res.statusCode < 300, statusCode: res.statusCode });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Zoho CRM API ─────────────────────────────────────────────

function zohoSearchContact(name, phone) {
  return new Promise((resolve, reject) => {
    const searchTerm = encodeURIComponent(phone || name);
    const req = https.request(
      {
        hostname: 'www.zohoapis.com',
        path: `/crm/v2/contacts/search?criteria=(Full_Name:equals:${searchTerm})`,
        method: 'GET',
        headers: {
          Authorization: `Zoho-oauthtoken ${crmSettings.zoho.apiKey}`,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.data) {
              resolve(
                parsed.data.map((r) => ({
                  crmId: r.id,
                  name: r.Full_Name,
                  email: r.Email,
                  phone: r.Phone,
                  company: r.Company,
                  stage: r.Lead_Status,
                }))
              );
            } else {
              resolve([]);
            }
          } catch (e) {
            reject(new Error('Invalid Zoho response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function zohoLogActivity(contactId, messages, summary) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      data: [
        {
          Note_Title: 'WhatsApp Conversation',
          Note_Content: `Summary: ${summary}\n\nMessages:\n${messages
            .map((m) => `[${m.time}] ${m.sender}: ${m.text}`)
            .join('\n')}`,
          Parent_Id: contactId,
          se_module: 'Contacts',
        },
      ],
    });

    const req = https.request(
      {
        hostname: 'www.zohoapis.com',
        path: '/crm/v2/Notes',
        method: 'POST',
        headers: {
          Authorization: `Zoho-oauthtoken ${crmSettings.zoho.apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          resolve({ success: res.statusCode < 300, statusCode: res.statusCode });
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Persistence ──────────────────────────────────────────────

function loadSettings() {
  try {
    if (fs.existsSync(crmPath)) {
      const data = JSON.parse(fs.readFileSync(crmPath, 'utf8'));
      crmSettings = data.settings || crmSettings;
      contactCache = data.contacts || {};
    }
  } catch (e) {}
}

function saveSettings() {
  fs.writeFileSync(
    crmPath,
    JSON.stringify({ settings: crmSettings, contacts: contactCache }, null, 2)
  );
}

module.exports = { initCrmIntegration };
