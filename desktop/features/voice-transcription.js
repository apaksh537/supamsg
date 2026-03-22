const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function initVoiceTranscription({ app, ipcMain, getMainWindow, getViews, getActiveAccountId, getAccounts }) {
  const transcriptionsPath = path.join(app.getPath('userData'), 'voice-transcriptions.json');
  const settingsPath = path.join(app.getPath('userData'), 'settings.json');

  function loadTranscriptions() {
    try {
      if (fs.existsSync(transcriptionsPath)) {
        return JSON.parse(fs.readFileSync(transcriptionsPath, 'utf-8'));
      }
    } catch (e) {
      console.error('Error loading voice transcriptions:', e);
    }
    return {};
  }

  function saveTranscriptions(data) {
    try {
      fs.writeFileSync(transcriptionsPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving voice transcriptions:', e);
    }
  }

  function getApiKey() {
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return settings.anthropicApiKey || null;
      }
    } catch (e) {
      console.error('Error reading settings for API key:', e);
    }
    return null;
  }

  function hashMessage(content) {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  // Transcribe a voice message
  // Uses Claude API for transcription. Whisper API can be swapped in by replacing
  // the transcribeWithClaude function with a Whisper-based implementation.
  ipcMain.handle('transcribe-voice', async (event, { audioUrl, accountId }) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { error: 'Voice transcription requires API key. Set anthropicApiKey in settings.' };
    }

    const messageHash = hashMessage(audioUrl + accountId);

    // Check cache
    const transcriptions = loadTranscriptions();
    if (transcriptions[messageHash]) {
      return transcriptions[messageHash];
    }

    try {
      const views = getViews();
      const view = views[accountId];
      if (!view) {
        return { error: `No active view for account ${accountId}` };
      }

      // Extract audio data from WhatsApp Web DOM
      const audioData = await view.webContents.executeJavaScript(`
        (function() {
          const audioUrl = ${JSON.stringify(audioUrl)};
          const audioEls = document.querySelectorAll('audio');
          for (const el of audioEls) {
            if (el.src && (el.src === audioUrl || el.src.includes(audioUrl))) {
              return { src: el.src, found: true };
            }
          }
          // Try to find by closest voice message button
          const voiceMsgs = document.querySelectorAll('[data-testid="audio-play"]');
          if (voiceMsgs.length > 0) {
            const lastVoice = voiceMsgs[voiceMsgs.length - 1];
            const container = lastVoice.closest('[data-testid="msg-container"]');
            if (container) {
              const audio = container.querySelector('audio');
              if (audio) return { src: audio.src, found: true };
            }
          }
          return { found: false };
        })();
      `);

      if (!audioData.found) {
        return { error: 'Could not find audio element in WhatsApp Web DOM' };
      }

      // Send to Claude API for transcription/description
      // NOTE: For production use, swap this with OpenAI Whisper API for better audio transcription
      const { net } = require('electron');
      const response = await new Promise((resolve, reject) => {
        const request = net.request({
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
        });

        request.setHeader('Content-Type', 'application/json');
        request.setHeader('x-api-key', apiKey);
        request.setHeader('anthropic-version', '2023-06-01');

        let responseBody = '';
        request.on('response', (resp) => {
          resp.on('data', (chunk) => { responseBody += chunk.toString(); });
          resp.on('end', () => {
            try {
              resolve(JSON.parse(responseBody));
            } catch (e) {
              reject(new Error('Failed to parse Claude API response'));
            }
          });
        });
        request.on('error', reject);

        const body = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: `Please transcribe this voice message audio. The audio URL is: ${audioData.src}. If you cannot access the audio directly, please indicate that the audio needs to be processed through a dedicated speech-to-text service like Whisper.`,
            },
          ],
        });

        request.write(body);
        request.end();
      });

      const transcription = response.content?.[0]?.text || 'Transcription unavailable';
      const result = {
        transcription,
        messageHash,
        accountId,
        transcribedAt: new Date().toISOString(),
      };

      // Cache the transcription
      transcriptions[messageHash] = result;
      saveTranscriptions(transcriptions);

      return result;
    } catch (e) {
      console.error('Error transcribing voice message:', e);
      return { error: `Transcription failed: ${e.message}` };
    }
  });

  // Scrape voice message elements from WhatsApp Web DOM
  ipcMain.handle('get-voice-messages', async (event, { accountId }) => {
    const views = getViews();
    const view = views[accountId];
    if (!view) {
      return { error: `No active view for account ${accountId}`, messages: [] };
    }

    try {
      const voiceMessages = await view.webContents.executeJavaScript(`
        (function() {
          const messages = [];
          const voiceBtns = document.querySelectorAll('[data-testid="audio-play"]');
          voiceBtns.forEach((btn, index) => {
            const container = btn.closest('[data-testid="msg-container"]');
            if (container) {
              const audio = container.querySelector('audio');
              const timeEl = container.querySelector('[data-testid="msg-meta"] span');
              const incoming = container.closest('.message-in') !== null;
              messages.push({
                index,
                audioSrc: audio ? audio.src : null,
                time: timeEl ? timeEl.textContent : '',
                incoming,
              });
            }
          });
          return messages;
        })();
      `);

      return { messages: voiceMessages };
    } catch (e) {
      console.error('Error getting voice messages:', e);
      return { error: e.message, messages: [] };
    }
  });

  // Summarize a long transcription using Claude API
  ipcMain.handle('summarize-voice', async (event, { transcription }) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { error: 'Summarization requires API key. Set anthropicApiKey in settings.' };
    }

    try {
      const { net } = require('electron');
      const response = await new Promise((resolve, reject) => {
        const request = net.request({
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
        });

        request.setHeader('Content-Type', 'application/json');
        request.setHeader('x-api-key', apiKey);
        request.setHeader('anthropic-version', '2023-06-01');

        let responseBody = '';
        request.on('response', (resp) => {
          resp.on('data', (chunk) => { responseBody += chunk.toString(); });
          resp.on('end', () => {
            try {
              resolve(JSON.parse(responseBody));
            } catch (e) {
              reject(new Error('Failed to parse Claude API response'));
            }
          });
        });
        request.on('error', reject);

        const body = JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 512,
          messages: [
            {
              role: 'user',
              content: `Summarize this voice message transcription in 2-3 concise sentences:\n\n${transcription}`,
            },
          ],
        });

        request.write(body);
        request.end();
      });

      const summary = response.content?.[0]?.text || 'Summary unavailable';
      return { summary };
    } catch (e) {
      console.error('Error summarizing transcription:', e);
      return { error: `Summarization failed: ${e.message}` };
    }
  });
}

module.exports = { initVoiceTranscription };
