const { app, BrowserWindow, session, shell, Menu, screen, nativeImage } = require('electron');
const path = require('path');

const APP_NAME = 'Ghostchat';
const ICON_PNG = path.join(__dirname, 'build-assets', 'icon-512.png');
const ICON_ICNS = path.join(__dirname, 'build-assets', 'icon.icns');

app.setName(APP_NAME);

const SNAPCHAT_URL = 'https://web.snapchat.com';
// Electron is genuinely Chromium; strip the "Electron/x.x.x" token so
// Snapchat's UA sniffing recognizes it as a real Chrome build.
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const ALLOWED_HOSTS = [
  'snapchat.com',
  'accounts.google.com',
  'appleid.apple.com',
];

// Hides Snapchat Web's marketing chrome (download nudges, ads link, parent
// banner) so the wrapped page reads like a native app instead of a website.
// Purely cosmetic/client-side — nothing sent to Snapchat is altered.
const CHROME_CLEANUP_JS = `
(() => {
  if (window.__snapCleanupInstalled) return;
  window.__snapCleanupInstalled = true;

  const textOf = (el) => (el.textContent || '').trim();

  function hideExactButtonOrLink(label) {
    document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
      if (textOf(el) === label) el.style.setProperty('display', 'none', 'important');
    });
  }

  function hideContaining(substr, ancestorLevels) {
    const matches = Array.from(document.querySelectorAll('body *')).filter((el) => textOf(el).includes(substr));
    // Keep only the most specific (deepest) matching elements, so we hide the
    // small wrapper rather than a giant ancestor that also happens to contain it.
    const minimal = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
    minimal.forEach((el) => {
      let target = el;
      for (let i = 0; i < ancestorLevels && target.parentElement && target.parentElement !== document.body; i++) {
        target = target.parentElement;
      }
      target.style.setProperty('display', 'none', 'important');
    });
  }

  function findNearbyCloseButton(startEl, maxHops) {
    let node = startEl;
    for (let i = 0; i < maxHops && node; i++, node = node.parentElement) {
      const btns = Array.from(node.querySelectorAll('button, [role="button"]'));
      const candidate = btns.find((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.width <= 48 && r.height <= 48;
      });
      if (candidate) return candidate;
    }
    return null;
  }

  // Prefer actually clicking the site's own close button (so it cleans up any
  // scroll-lock/backdrop state it set) and only fall back to hard-hiding.
  function dismiss(substr, opts) {
    opts = opts || {};
    const matches = Array.from(document.querySelectorAll('body *')).filter((el) => textOf(el).includes(substr));
    const minimal = matches.filter((el) => !matches.some((other) => other !== el && el.contains(other)));
    minimal.forEach((el) => {
      const closeBtn = findNearbyCloseButton(el, opts.maxHops || 6);
      if (closeBtn) {
        closeBtn.click();
        document.body.style.removeProperty('overflow');
        document.documentElement.style.removeProperty('overflow');
        return;
      }
      let target = el;
      const levels = opts.ancestorLevels || 0;
      for (let i = 0; i < levels && target.parentElement && target.parentElement !== document.body; i++) {
        target = target.parentElement;
      }
      target.style.setProperty('display', 'none', 'important');
    });
  }

  function cleanup() {
    try {
      hideExactButtonOrLink('Download');
      hideExactButtonOrLink('Snapchat Ads');
      hideContaining('Looking for the app', 0);
      dismiss('Are you a parent', { ancestorLevels: 2 });
      dismiss('Keep up with your friends', { ancestorLevels: 3, maxHops: 8 });
      dismiss('Looking for Ads Manager', { ancestorLevels: 6, maxHops: 10 });
    } catch (e) {
      console.log('[cleanup] error:', e && e.message);
    }
  }

  cleanup();
  try {
    new MutationObserver(() => cleanup()).observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.log('[cleanup] observer error:', e && e.message);
  }
})();
`;

// Proactively resolves Notification.permission instead of waiting on
// Snapchat's own banner click, then reloads once on the first real grant so
// Snapchat's init code (which likely only subscribes to push inside its own
// "Enable" button's click handler) re-runs seeing "granted" from page load
// and actually completes the push subscription.
const NOTIF_PROBE_JS = `
(() => {
  if (!window.Notification) return;
  if (Notification.permission === 'granted') return;
  Notification.requestPermission().then((result) => {
    if (result === 'granted' && !window.__snapNotifReloaded) {
      window.__snapNotifReloaded = true;
      setTimeout(() => location.reload(), 50);
    }
  }).catch(() => {});
})();
`;

// Snapchat Web already runs a dark theme (verified live: body/html
// rgb(18,18,18), row text rgb(222,222,222)) — so this only touches shape,
// spacing and type, never color pairs, which keeps contrast/readability
// intact while making it read much more like the mobile app: pill-shaped
// buttons/inputs, rounded-not-square row highlights, a mobile-scale rounded
// font. Nothing here removes functionality — every element keeps its handlers.
const MOBILE_STYLE_CSS = `
:root {
  --gc-radius-row: 16px;
  --gc-radius-pill: 999px;
  --gc-radius-panel: 24px;
}

html, body {
  font-family: -apple-system, 'SF Pro Rounded', 'SF Pro Display', 'Segoe UI Rounded', system-ui, sans-serif !important;
}

/* Pill-shape only real form controls (button/input/textarea tags), NOT
   [role="button"] — that attribute is also used on large custom containers
   (e.g. a full snap-photo viewer), and a 999px radius on something that
   size turns the whole photo into a distorted stadium/circle shape. */
button, input, textarea {
  border-radius: var(--gc-radius-pill) !important;
}

/* Square icon-only buttons (e.g. the top-left avatar/menu button) read
   better as circles than pills at 1:1 aspect ratio. */
button[style*="width: 36px"], button[style*="height: 36px"] {
  border-radius: 50% !important;
}

/* Not forcing image/avatar rounding: Snapchat's own avatars are already
   circular, and a blanket rule risks distorting non-square images (photos,
   story thumbnails, the camera feed itself) into ellipses. */
`;

function isAllowedHost(hostname) {
  return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
}

function buildWindowBounds() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1200, width - 100);
  const h = Math.min(800, height - 100);
  return {
    width: w,
    height: h,
    x: Math.round((width - w) / 2),
    y: Math.round((height - h) / 2),
  };
}

function attachNavigationGuards(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const hostname = new URL(url).hostname;
      if (isAllowedHost(hostname)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 480,
            height: 680,
            webPreferences: { session: win.webContents.session },
          },
        };
      }
    } catch (_) {}
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const hostname = new URL(url).hostname;
      if (!isAllowedHost(hostname)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch (_) {}
  });
}

function createApp() {
  const bounds = buildWindowBounds();
  const snapSession = session.fromPartition('persist:snapchat-desktop');

  snapSession.setUserAgent(CHROME_UA);

  const allowedPermissions = ['media', 'mediaKeySystem', 'notifications', 'clipboard-read', 'fullscreen'];
  const isAllowedPermissionOrigin = (originOrUrl) => {
    try {
      return isAllowedHost(new URL(originOrUrl).hostname);
    } catch (_) {
      return false;
    }
  };
  snapSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = (details && details.requestingUrl) || webContents.getURL();
    callback(allowedPermissions.includes(permission) && isAllowedPermissionOrigin(origin));
  });
  // Request handler alone only covers active Notification.requestPermission()
  // calls; the check handler covers passive `Notification.permission` reads,
  // which is what Snapchat's own "enable notifications" banner logic uses —
  // without this, the banner never goes away no matter what we grant above.
  snapSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return allowedPermissions.includes(permission) && isAllowedPermissionOrigin(requestingOrigin);
  });

  const splash = new BrowserWindow({
    ...bounds,
    show: true,
    resizable: false,
    backgroundColor: '#0c0d10',
    webPreferences: { session: snapSession },
  });
  splash.loadFile('splash.html');

  // A real (non-overlay) title bar, deliberately not hiddenInset: Snapchat's
  // own page controls its top-left/top-right UI and we can't guarantee it
  // never sits under custom-positioned traffic lights. A genuine title bar
  // reserves OS chrome space that page content physically cannot render into.
  const main = new BrowserWindow({
    ...bounds,
    show: false,
    minWidth: 480,
    minHeight: 480,
    title: APP_NAME,
    icon: ICON_PNG,
    backgroundColor: '#0c0d10',
    webPreferences: {
      session: snapSession,
      contextIsolation: true,
      sandbox: true,
    },
  });

  attachNavigationGuards(main);

  // Chromium syncs the window title to the page's own <title> (e.g. "(13)
  // Snapchat") after every load, overwriting our initial title. Keep the
  // useful unread-count prefix but swap the branding text to stay consistent
  // with the dock icon/app name.
  main.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault();
    main.setTitle(title.replace(/Snapchat/gi, APP_NAME));
  });

  const swapIn = () => {
    if (main.isVisible()) return;
    main.show();
    setTimeout(() => {
      if (!splash.isDestroyed()) splash.close();
    }, 120);
  };

  main.webContents.once('did-finish-load', () => {
    setTimeout(swapIn, 350); // let the splash breathe briefly so it doesn't just flash
  });
  main.webContents.once('did-fail-load', swapIn);

  main.webContents.on('dom-ready', () => {
    main.webContents.insertCSS(MOBILE_STYLE_CSS).catch(() => {});
  });
  main.webContents.on('did-finish-load', () => {
    main.webContents.executeJavaScript(CHROME_CLEANUP_JS).catch(() => {});
    main.webContents.executeJavaScript(NOTIF_PROBE_JS).catch(() => {});
  });

  // Keep push/service-worker timers responsive while backgrounded (menu bar
  // only) so incoming-call/message notifications aren't delayed.
  main.webContents.setBackgroundThrottling(false);

  main.webContents.setUserAgent(CHROME_UA);
  main.loadURL(SNAPCHAT_URL);

  return main;
}

function buildMenu(getMainWindow) {
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => getMainWindow()?.webContents.reload(),
        },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(ICON_PNG));
  }

  let mainWindow = createApp();
  buildMenu(() => mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createApp();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
