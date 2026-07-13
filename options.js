function load() {
  chrome.storage.sync.get(['proxyUrl', 'debounceMs'], (cfg) => {
    document.getElementById('proxyUrl').value = cfg.proxyUrl || '';
    document.getElementById('debounceMs').value = cfg.debounceMs || 600;
  });
}

document.getElementById('save').addEventListener('click', () => {
  const data = {
    proxyUrl: document.getElementById('proxyUrl').value.trim(),
    debounceMs: parseInt(document.getElementById('debounceMs').value, 10) || 600,
  };
  chrome.storage.sync.set(data, () => {
    const saved = document.getElementById('saved');
    saved.style.display = 'inline';
    setTimeout(() => (saved.style.display = 'none'), 2000);
  });
});

load();
