async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] && tabs[0].id;
}

async function syncState() {
  const status = document.getElementById('status');
  const toggleBtn = document.getElementById('toggle-btn');
  const tabId = await getActiveTabId();

  if (!tabId) {
    status.textContent = 'Status: no active tab';
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'LINGONOTE_GET_STATE' });
    const enabled = response && response.enabled !== false;
    status.textContent = `Status: ${enabled ? 'enabled' : 'disabled'}`;
    toggleBtn.textContent = enabled ? 'Disable on this page' : 'Enable on this page';
  } catch (error) {
    status.textContent = 'Status: page not ready';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  const toggleBtn = document.getElementById('toggle-btn');

  toggleBtn.addEventListener('click', async () => {
    const tabId = await getActiveTabId();
    if (!tabId) {
      status.textContent = 'Status: no active tab';
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'LINGONOTE_TOGGLE' });
      const enabled = response && response.enabled !== false;
      status.textContent = `Status: ${enabled ? 'enabled' : 'disabled'}`;
      toggleBtn.textContent = enabled ? 'Disable on this page' : 'Enable on this page';
    } catch (error) {
      status.textContent = 'Status: toggle failed';
    }
  });

  await syncState();
});
