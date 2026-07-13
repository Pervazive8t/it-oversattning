const toggleBtn = document.getElementById('toggle');
const statusEl = document.getElementById('status');

function render(cfg) {
  const enabled = !!cfg.enabled;
  toggleBtn.textContent = enabled ? 'Aktiverad – klicka för att stänga av' : 'Aktivera';
  toggleBtn.className = enabled ? 'on' : 'off';

  if (!cfg.proxyUrl) {
    statusEl.textContent = '⚠️ Ingen server-URL angiven än. Öppna inställningarna nedan.';
  } else {
    statusEl.textContent = `Server: ${cfg.proxyUrl}`;
  }
}

chrome.storage.sync.get(['enabled', 'proxyUrl'], render);

toggleBtn.addEventListener('click', () => {
  chrome.storage.sync.get(['enabled'], (cfg) => {
    chrome.storage.sync.set({ enabled: !cfg.enabled }, () => {
      chrome.storage.sync.get(['enabled', 'proxyUrl'], render);
    });
  });
});

document.getElementById('openOptions').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
