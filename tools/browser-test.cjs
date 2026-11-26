const { chromium } = require('playwright');

function launchBrowser() {
  return chromium.launch({ executablePath: process.env.TEST_CHROMIUM_PATH || undefined });
}

async function localContext(browser, baseUrl, options = {}) {
  const origin = new URL(baseUrl).origin;
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  // Page-level routes can fulfill simulated APIs before this context guard.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  return context;
}

module.exports = { launchBrowser, localContext };
