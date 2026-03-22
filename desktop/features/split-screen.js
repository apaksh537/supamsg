// Split-screen: show two WhatsApp accounts side-by-side
// Main process module

let splitMode = false;
let splitLeftId = null;
let splitRightId = null;

function initSplitScreen({ ipcMain, getMainWindow, getViews, getAccounts, getSidebarWidth }) {

  ipcMain.on('toggle-split-screen', (_event, { leftId, rightId } = {}) => {
    const mainWindow = getMainWindow();
    const views = getViews();
    const accounts = getAccounts();
    if (!mainWindow) return;

    if (splitMode) {
      // Exit split mode
      splitMode = false;
      // Remove both views
      if (splitLeftId && views[splitLeftId]) mainWindow.removeBrowserView(views[splitLeftId]);
      if (splitRightId && views[splitRightId]) mainWindow.removeBrowserView(views[splitRightId]);
      splitLeftId = null;
      splitRightId = null;
      mainWindow.webContents.send('split-screen-changed', { active: false });
      return { active: false };
    }

    // Enter split mode
    if (accounts.length < 2) return;

    const left = leftId || accounts[0]?.id;
    const right = rightId || accounts[1]?.id;

    if (!views[left] || !views[right] || left === right) return;

    // Remove any existing views first
    for (const v of Object.values(views)) {
      try { mainWindow.removeBrowserView(v); } catch (e) {}
    }

    splitMode = true;
    splitLeftId = left;
    splitRightId = right;

    mainWindow.addBrowserView(views[left]);
    mainWindow.addBrowserView(views[right]);

    resizeSplitViews(mainWindow, views, getSidebarWidth());
    mainWindow.webContents.send('split-screen-changed', { active: true, leftId: left, rightId: right });
    return { active: true, leftId: left, rightId: right };
  });

  ipcMain.on('set-split-account', (_event, { side, accountId }) => {
    const mainWindow = getMainWindow();
    const views = getViews();
    if (!splitMode || !mainWindow) return;

    const oldId = side === 'left' ? splitLeftId : splitRightId;
    if (oldId && views[oldId]) mainWindow.removeBrowserView(views[oldId]);

    if (side === 'left') splitLeftId = accountId;
    else splitRightId = accountId;

    if (views[accountId]) {
      mainWindow.addBrowserView(views[accountId]);
      resizeSplitViews(mainWindow, views, getSidebarWidth());
    }

    mainWindow.webContents.send('split-screen-changed', {
      active: true, leftId: splitLeftId, rightId: splitRightId,
    });
  });

  return {
    isSplit: () => splitMode,
    getSplitIds: () => ({ leftId: splitLeftId, rightId: splitRightId }),
    resizeSplit: (mainWindow, views, sidebarWidth) => {
      if (splitMode) resizeSplitViews(mainWindow, views, sidebarWidth);
    },
    exitSplit: () => {
      splitMode = false;
      splitLeftId = null;
      splitRightId = null;
    },
  };
}

function resizeSplitViews(mainWindow, views, sidebarWidth) {
  const bounds = mainWindow.getBounds();
  const contentWidth = bounds.width - sidebarWidth;
  const halfWidth = Math.floor(contentWidth / 2);

  if (splitLeftId && views[splitLeftId]) {
    views[splitLeftId].setBounds({
      x: sidebarWidth,
      y: 0,
      width: halfWidth,
      height: bounds.height,
    });
    views[splitLeftId].setAutoResize({ width: false, height: true });
  }

  if (splitRightId && views[splitRightId]) {
    views[splitRightId].setBounds({
      x: sidebarWidth + halfWidth,
      y: 0,
      width: contentWidth - halfWidth,
      height: bounds.height,
    });
    views[splitRightId].setAutoResize({ width: false, height: true });
  }
}

module.exports = { initSplitScreen };
