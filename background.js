// Bakgrundsskriptet pratar med VÅR EGEN server (Render), inte DeepL direkt.
// DeepL:s API stödjer inte CORS/preflight-förfrågningar från webbläsare, så
// ett direktanrop därifrån kan aldrig fungera – oavsett behörigheter.
// Vår egen server pratar redan med DeepL problemfritt (server-till-server)
// och svarar korrekt på CORS, så anrop härifrån till den fungerar utan krångel.

async function translateText(text, proxyUrl) {
  if (!proxyUrl) {
    throw new Error('Ingen server-URL konfigurerad. Öppna tilläggets inställningar (högerklicka ikonen → Alternativ).');
  }

  const endpoint = proxyUrl.replace(/\/+$/, '') + '/api/translate';

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `Servern svarade med status ${resp.status}`);
  }

  return data.translated;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'translate') {
    translateText(msg.text, msg.proxyUrl)
      .then((translated) => sendResponse({ ok: true, translated }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // svar skickas asynkront
  }
});
