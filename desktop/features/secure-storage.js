// Encrypts/decrypts sensitive data using Electron's safeStorage API
// Falls back to plain text if safeStorage is unavailable
const { safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

function encryptValue(value) {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(String(value)).toString('base64');
  }
  return value; // fallback
}

function decryptValue(encrypted) {
  if (typeof encrypted !== 'string') return encrypted;
  if (safeStorage.isEncryptionAvailable() && encrypted.length > 50) {
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch (e) {
      return encrypted; // wasn't encrypted, return as-is
    }
  }
  return encrypted;
}

// Sensitive keys that should be encrypted
const SENSITIVE_KEYS = ['anthropicApiKey', 'apiKey', 'authToken', 'licenseKey',
  'hubspotApiKey', 'zohoApiKey', 'twilioSid', 'twilioAuth', 'stripeKey'];

function encryptSensitiveFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk.toLowerCase())) && typeof result[key] === 'string' && result[key]) {
      result[key] = encryptValue(result[key]);
      result[`_encrypted_${key}`] = true;
    }
  }
  return result;
}

function decryptSensitiveFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (result[`_encrypted_${key}`]) {
      result[key] = decryptValue(result[key]);
      delete result[`_encrypted_${key}`];
    }
  }
  return result;
}

module.exports = { encryptValue, decryptValue, encryptSensitiveFields, decryptSensitiveFields };
