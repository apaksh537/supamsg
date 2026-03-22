// Appointment booking system — shareable booking links via WhatsApp
// Manages available slots, bookings, and sends reminders

const path = require('path');
const fs = require('fs');

const DEFAULT_CONFIG = {
  businessName: 'My Business',
  slotDuration: 30,
  workingHours: { start: '09:00', end: '18:00' },
  workingDays: [1, 2, 3, 4, 5],
  bufferMinutes: 10,
};

let configPath;
let bookingsPath;
let config = { ...DEFAULT_CONFIG };
let bookings = [];
let reminderInterval;

function initAppointmentBooking({ app, ipcMain, getMainWindow, getViews, getActiveAccountId }) {
  configPath = path.join(app.getPath('userData'), 'booking-config.json');
  bookingsPath = path.join(app.getPath('userData'), 'bookings.json');
  loadConfig();
  loadBookings();

  // Check every hour for reminders (24h before appointment)
  reminderInterval = setInterval(() => checkReminders(getViews, getMainWindow, getActiveAccountId), 3600000);

  ipcMain.handle('get-booking-config', () => {
    return config;
  });

  ipcMain.on('save-booking-config', (_event, newConfig) => {
    config = { ...DEFAULT_CONFIG, ...newConfig };
    saveConfig();
  });

  ipcMain.handle('get-available-slots', (_event, { date }) => {
    return generateAvailableSlots(date);
  });

  ipcMain.handle('get-bookings', (_event, { startDate, endDate }) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    return bookings.filter((b) => {
      const bDate = new Date(b.date);
      return bDate >= start && bDate <= end;
    });
  });

  ipcMain.on('create-booking', (_event, { date, startTime, customerName, customerPhone, notes }) => {
    const endTime = addMinutes(startTime, config.slotDuration);
    const booking = {
      id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date,
      startTime,
      endTime,
      status: 'booked',
      customerName,
      customerPhone,
      notes: notes || '',
      reminderSent: false,
      createdAt: new Date().toISOString(),
    };
    bookings.push(booking);
    saveBookings();
    broadcastBookings(getMainWindow());
  });

  ipcMain.on('cancel-booking', (_event, { bookingId }) => {
    const booking = bookings.find((b) => b.id === bookingId);
    if (booking) {
      booking.status = 'cancelled';
      saveBookings();
      broadcastBookings(getMainWindow());
    }
  });

  ipcMain.on('send-booking-link', async (_event, { accountId, contactName }) => {
    try {
      const slotsMessage = generateSlotsMessage();
      await sendMessageToContact(accountId, contactName, slotsMessage, getViews, getActiveAccountId);
    } catch (e) {
      console.error('Failed to send booking link:', e);
    }
  });

  ipcMain.on('confirm-booking-in-chat', async (_event, { accountId, contactName, bookingId }) => {
    try {
      const booking = bookings.find((b) => b.id === bookingId);
      if (!booking) return;

      const dateObj = new Date(booking.date);
      const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
      const message = `Your appointment is confirmed!\\n\\n` +
        `Date: ${dateStr}\\n` +
        `Time: ${booking.startTime} - ${booking.endTime}\\n` +
        `Business: ${config.businessName}\\n\\n` +
        `See you then!`;

      await sendMessageToContact(accountId, contactName, message, getViews, getActiveAccountId);
    } catch (e) {
      console.error('Failed to send booking confirmation:', e);
    }
  });
}

function generateAvailableSlots(date) {
  const dateObj = new Date(date);
  const dayOfWeek = dateObj.getDay();

  // Check if this is a working day (Sunday=0, Monday=1, etc.)
  if (!config.workingDays.includes(dayOfWeek)) {
    return [];
  }

  const slots = [];
  const [startHour, startMin] = config.workingHours.start.split(':').map(Number);
  const [endHour, endMin] = config.workingHours.end.split(':').map(Number);
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  const slotStep = config.slotDuration + config.bufferMinutes;

  for (let mins = startMinutes; mins + config.slotDuration <= endMinutes; mins += slotStep) {
    const slotStart = formatTime(mins);
    const slotEnd = formatTime(mins + config.slotDuration);

    // Check if slot is already booked
    const isBooked = bookings.some((b) =>
      b.date === date &&
      b.startTime === slotStart &&
      b.status === 'booked'
    );

    slots.push({
      id: `slot-${date}-${slotStart}`,
      date,
      startTime: slotStart,
      endTime: slotEnd,
      status: isBooked ? 'booked' : 'available',
    });
  }

  return slots;
}

function generateSlotsMessage() {
  const today = new Date();
  const lines = [`Hi! Here are my available slots:\n`];

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    const slots = generateAvailableSlots(dateStr);
    const available = slots.filter((s) => s.status === 'available');

    if (available.length > 0) {
      const dayLabel = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
      const times = available.map((s) => s.startTime).join(', ');
      lines.push(`📅 ${dayLabel}: ${times}`);
    }
  }

  lines.push(`\nReply with your preferred slot!`);
  return lines.join('\n');
}

async function checkReminders(getViews, getMainWindow, getActiveAccountId) {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 3600000);
  let changed = false;

  for (const booking of bookings) {
    if (booking.status !== 'booked' || booking.reminderSent) continue;

    const bookingDateTime = new Date(`${booking.date}T${booking.startTime}:00`);
    if (bookingDateTime <= in24h && bookingDateTime > now) {
      // Send reminder if customer phone is available
      if (booking.customerPhone) {
        const dateObj = new Date(booking.date);
        const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
        const message = `Reminder: You have an appointment tomorrow!\\n\\n` +
          `Date: ${dateStr}\\nTime: ${booking.startTime}\\nBusiness: ${config.businessName}`;

        try {
          await sendMessageToContact(null, booking.customerPhone, message, getViews, getActiveAccountId);
        } catch (e) {
          console.error('Failed to send reminder:', e);
        }
      }
      booking.reminderSent = true;
      changed = true;
    }
  }

  if (changed) {
    saveBookings();
  }
}

async function sendMessageToContact(accountId, contactName, message, getViews, getActiveAccountId) {
  const views = getViews();
  const activeId = accountId || getActiveAccountId();
  const view = views[activeId];
  if (!view || view.webContents.isDestroyed()) return;

  const contact = contactName.replace(/'/g, "\\'");
  const msg = message.replace(/'/g, "\\'").replace(/\n/g, '\\n');

  await view.webContents.executeJavaScript(`
    (async () => {
      const searchBox = document.querySelector('div[contenteditable="true"][data-tab="3"]');
      if (!searchBox) throw new Error('Search box not found');
      searchBox.focus();
      document.execCommand('insertText', false, '${contact}');
      await new Promise(r => setTimeout(r, 1500));
      const contacts = document.querySelectorAll('span[title]');
      let found = false;
      for (const c of contacts) {
        if (c.title && c.title.toLowerCase().includes('${contact}'.toLowerCase())) {
          c.click();
          found = true;
          break;
        }
      }
      if (!found) throw new Error('Contact not found');
      await new Promise(r => setTimeout(r, 1000));
      const msgBox = document.querySelector('div[contenteditable="true"][data-tab="10"]');
      if (!msgBox) throw new Error('Message box not found');
      msgBox.focus();
      document.execCommand('insertText', false, '${msg}');
      await new Promise(r => setTimeout(r, 300));
      const sendBtn = document.querySelector('span[data-icon="send"]');
      if (sendBtn) sendBtn.click();
    })();
  `);
}

function addMinutes(timeStr, minutes) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return formatTime(total);
}

function formatTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch (e) {
    config = { ...DEFAULT_CONFIG };
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save booking config:', e);
  }
}

function loadBookings() {
  try {
    if (fs.existsSync(bookingsPath)) {
      bookings = JSON.parse(fs.readFileSync(bookingsPath, 'utf8'));
    }
  } catch (e) {
    bookings = [];
  }
}

function saveBookings() {
  try {
    fs.writeFileSync(bookingsPath, JSON.stringify(bookings, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save bookings:', e);
  }
}

function broadcastBookings(mainWindow) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bookings-updated', bookings);
  }
}

module.exports = { initAppointmentBooking };
