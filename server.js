require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { LRUCache } = require('lru-cache');

const app = express();

const PORT = process.env.PORT || 3000;

const RAW_SOURCE_URL = (process.env.SOURCE_URL || '').trim();
let SOURCE_URL = '';
if (RAW_SOURCE_URL) {
  try {
    const parsed = new URL(RAW_SOURCE_URL);
    SOURCE_URL = `${parsed.protocol}//${parsed.host}`; // bara domänen – ALDRIG sökvägen
    if (parsed.pathname && parsed.pathname !== '/') {
      console.warn(
        `OBS: SOURCE_URL innehöll en sökväg ("${parsed.pathname}") som ignorerades. ` +
        `Proxyn speglar hela domänen (${SOURCE_URL}) – besök själva undersidan på ` +
        `din lokala adress istället, t.ex. http://localhost:${PORT}${parsed.pathname}`
      );
    }
  } catch (e) {
    console.error(`SOURCE_URL ("${RAW_SOURCE_URL}") är inte en giltig URL.`);
    process.exit(1);
  }
}

const DEEPL_API_KEY = process.env.DEEPL_API_KEY || '';
const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate';
const DEEPL_PRO_URL = 'https://api.deepl.com/v2/translate';
// Bästa gissning utifrån ":fx"-suffixet – men vi litar inte blint på den,
// se automatisk fallback i callDeepl() nedan.
let DEEPL_API_URL = DEEPL_API_KEY.trim().endsWith(':fx') ? DEEPL_FREE_URL : DEEPL_PRO_URL;
const SOURCE_LANG = process.env.SOURCE_LANG || 'SV';
const TARGET_LANG = process.env.TARGET_LANG || 'IT';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10);

if (!SOURCE_URL) {
  console.error('SOURCE_URL saknas i .env – peka den mot din svenska sida, t.ex. https://mittbrollop.se');
  process.exit(1);
}
if (!DEEPL_API_KEY) {
  console.error('DEEPL_API_KEY saknas i .env');
  process.exit(1);
}

// Cache: samma text behöver bara översättas en gång. Ny/ändrad text på källsidan
// upptäcks automatiskt nästa gång sidan hämtas (vi cachar inga hela sidor, bara textsträngar).
const translationCache = new LRUCache({
  max: 8000,
  ttl: 1000 * 60 * 60 * 24 * 7, // 7 dagar, sen översätts texten om (skydd mot att cachen blir stendöd)
});

// Element vars textinnehåll ALDRIG ska översättas
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'code', 'pre']);
// Attribut som innehåller synlig/läsbar text värd att översätta
const TRANSLATABLE_ATTRS = ['alt', 'title', 'placeholder', 'aria-label'];

// Anropar DeepL. Om vi gissat fel server (Free vs Pro) baserat på
// ":fx"-suffixet provar vi automatiskt den andra – och kommer ihåg rätt val
// till nästa gång, så vi bara behöver gissa fel en enda gång.
async function callDeepl(params) {
  async function attempt(url) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      },
      body: params,
    });
  }

  let resp = await attempt(DEEPL_API_URL);

  if (resp.status === 403) {
    const bodyText = await resp.text().catch(() => '');
    if (bodyText.includes('Wrong endpoint')) {
      const otherUrl = DEEPL_API_URL === DEEPL_FREE_URL ? DEEPL_PRO_URL : DEEPL_FREE_URL;
      console.warn(`Fel DeepL-server gissad (${DEEPL_API_URL}), provar ${otherUrl} istället...`);
      const retryResp = await attempt(otherUrl);
      if (retryResp.ok) {
        DEEPL_API_URL = otherUrl; // kom ihåg rätt val till nästa anrop
        console.warn(`Rätt DeepL-server var ${otherUrl} – använder den från och med nu.`);
      }
      return retryResp;
    }
    // 403 av annan anledning (t.ex. fel nyckel) – returnera ursprungssvaret som det är
    return { ok: false, status: 403, text: async () => bodyText, json: async () => JSON.parse(bodyText) };
  }

  return resp;
}

async function translateBatch(texts) {
  const toTranslate = [];
  const results = new Map();

  for (const t of texts) {
    const key = t.trim();
    if (!key) continue;
    const cached = translationCache.get(key);
    if (cached !== undefined) {
      results.set(t, cached);
    } else {
      toTranslate.push(t);
    }
  }

  // DeepL tar max ~50 textsegment per anrop – dela upp i batchar
  const chunkSize = 50;
  for (let i = 0; i < toTranslate.length; i += chunkSize) {
    const chunk = toTranslate.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;

    const params = new URLSearchParams();
    params.append('source_lang', SOURCE_LANG);
    params.append('target_lang', TARGET_LANG);
    params.append('preserve_formatting', '1');
    chunk.forEach(t => params.append('text', t));

    const resp = await callDeepl(params);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`DeepL-fel ${resp.status}: ${errText}`);
    }

    const data = await resp.json();
    data.translations.forEach((tr, idx) => {
      const original = chunk[idx];
      results.set(original, tr.text);
      translationCache.set(original.trim(), tr.text);
    });
  }

  return results;
}

function isVisibleTextNode(node) {
  const text = node.data;
  if (!text || !text.trim()) return false;
  const parentTag = (node.parent && node.parent.tagName || '').toLowerCase();
  return !SKIP_TAGS.has(parentTag);
}

async function translateHtml(html, baseUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });

  const textsToTranslate = new Set();

  // 1. Vanliga textnoder
  $('*').contents().each((_, node) => {
    if (node.type === 'text' && isVisibleTextNode(node)) {
      textsToTranslate.add(node.data);
    }
  });

  // 2. Relevanta attribut
  TRANSLATABLE_ATTRS.forEach(attr => {
    $(`[${attr}]`).each((_, el) => {
      const val = $(el).attr(attr);
      if (val && val.trim()) textsToTranslate.add(val);
    });
  });

  // 3. Meta-taggar för SEO/delning
  $('meta[name="description"], meta[property="og:title"], meta[property="og:description"], title').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'meta') {
      const val = $(el).attr('content');
      if (val && val.trim()) textsToTranslate.add(val);
    } else if (tag === 'title') {
      const val = $(el).text();
      if (val && val.trim()) textsToTranslate.add(val);
    }
  });

  const translations = await translateBatch([...textsToTranslate]);

  // Sätt tillbaka översatt text
  $('*').contents().each((_, node) => {
    if (node.type === 'text' && isVisibleTextNode(node)) {
      const original = node.data;
      const translated = translations.get(original);
      if (translated !== undefined) $(node).replaceWith(translated);
    }
  });

  TRANSLATABLE_ATTRS.forEach(attr => {
    $(`[${attr}]`).each((_, el) => {
      const val = $(el).attr(attr);
      const translated = translations.get(val);
      if (translated !== undefined) $(el).attr(attr, translated);
    });
  });

  $('meta[name="description"], meta[property="og:title"], meta[property="og:description"]').each((_, el) => {
    const val = $(el).attr('content');
    const translated = translations.get(val);
    if (translated !== undefined) $(el).attr('content', translated);
  });

  $('title').each((_, el) => {
    const val = $(el).text();
    const translated = translations.get(val);
    if (translated !== undefined) $(el).text(translated);
  });

  $('html').attr('lang', 'it');

  // Gör om absoluta länkar till källdomänen så navigering stannar kvar på vår proxy
  const sourceHost = new URL(baseUrl).host;
  $('a[href], link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.host === sourceHost) {
        $(el).attr('href', abs.pathname + abs.search + abs.hash);
      }
    } catch (_) { /* relativa/ogiltiga länkar lämnas orörda */ }
  });

  return $.html();
}

// Skript som injiceras i sidan. Hämtar samma URL i bakgrunden en gång per sekund
// och skriver bara in text som faktiskt ändrats – ingen full omladdning, inget blink.
function buildLiveSyncScript() {
  return `
<script>
(function () {
  var updating = false;

  function syncNode(oldNode, newNode) {
    var oldChildren = oldNode.childNodes;
    var newChildren = newNode.childNodes;

    if (oldChildren.length !== newChildren.length) {
      // Strukturen ändrades (t.ex. ett helt nytt textblock tillkom) – ersätt subträdet
      oldNode.innerHTML = newNode.innerHTML;
      return;
    }

    for (var i = 0; i < oldChildren.length; i++) {
      var o = oldChildren[i];
      var n = newChildren[i];

      if (o.nodeType === 3 && n.nodeType === 3) {
        if (o.data !== n.data) o.data = n.data;
      } else if (o.nodeType === 1 && n.nodeType === 1) {
        if (o.tagName !== n.tagName) {
          o.replaceWith(n.cloneNode(true));
        } else {
          syncNode(o, n);
        }
      }
    }
  }

  async function poll() {
    if (updating || document.hidden) return;
    updating = true;
    try {
      var resp = await fetch(window.location.href, { cache: 'no-store' });
      if (resp.ok) {
        var html = await resp.text();
        var newDoc = new DOMParser().parseFromString(html, 'text/html');
        syncNode(document.body, newDoc.body);
      }
    } catch (e) {
      console.warn('Live-synk misslyckades:', e);
    } finally {
      updating = false;
    }
  }

  setInterval(poll, ${POLL_INTERVAL_MS});
})();
</script>`;
}



app.get('/usage', async (req, res) => {
  try {
    async function fetchUsage(baseUrl) {
      const usageUrl = baseUrl.replace('/v2/translate', '/v2/usage');
      return fetch(usageUrl, {
        headers: { 'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}` },
      });
    }

    let resp = await fetchUsage(DEEPL_API_URL);
    if (resp.status === 403) {
      const bodyText = await resp.text().catch(() => '');
      if (bodyText.includes('Wrong endpoint')) {
        const otherUrl = DEEPL_API_URL === DEEPL_FREE_URL ? DEEPL_PRO_URL : DEEPL_FREE_URL;
        resp = await fetchUsage(otherUrl);
        if (resp.ok) DEEPL_API_URL = otherUrl;
      }
    }

    const data = await resp.json();
    if (!resp.ok) {
      return res.status(resp.status).send(`<pre>DeepL-fel: ${JSON.stringify(data, null, 2)}</pre>`);
    }
    const used = data.character_count;
    const limit = data.character_limit;
    const percent = ((used / limit) * 100).toFixed(1);
    res.send(`
      <html><head><meta charset="utf-8"><title>DeepL-användning</title>
      <style>body{font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 20px}
      .bar{background:#eee;border-radius:8px;height:24px;overflow:hidden;margin:16px 0}
      .fill{background:${percent > 90 ? '#dc2626' : percent > 70 ? '#d97706' : '#16a34a'};height:100%}
      </style></head><body>
      <h2>DeepL-förbrukning</h2>
      <div class="bar"><div class="fill" style="width:${Math.min(percent, 100)}%"></div></div>
      <p><strong>${used.toLocaleString('sv-SE')}</strong> / ${limit.toLocaleString('sv-SE')} tecken använda (${percent}%)</p>
      <p style="color:#666;font-size:14px">Ladda om sidan för att se senaste siffran. Nyckel: ${DEEPL_API_KEY.slice(0, 8)}...</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`<pre>Fel: ${err.message}</pre>`);
  }
});

// Endpoint åt webbläsartillägget: den kan inte prata med DeepL direkt (DeepL
// stödjer inte CORS/preflight från webbläsare), så den pratar med oss istället.
// Vi pratar redan med DeepL problemfritt eftersom det sker server-till-server.
app.use(express.json({ limit: '1mb' }));

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
}

app.options('/api/translate', (req, res) => {
  setCorsHeaders(res);
  res.sendStatus(204);
});

app.post('/api/translate', async (req, res) => {
  setCorsHeaders(res);
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ ok: false, error: 'Fältet "text" saknas eller är ogiltigt.' });
    }
    const translations = await translateBatch([text]);
    const translated = translations.get(text);
    res.json({ ok: true, translated });
  } catch (err) {
    console.error('Fel i /api/translate:', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.use(async (req, res) => {
  const targetUrl = SOURCE_URL + req.originalUrl;

  try {
    const upstream = await fetch(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (kompatibel oversattningsproxy)' },
      redirect: 'manual',
    });

    // Följ redirects men peka om dem mot vår egen proxy istället för källdomänen
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get('location');
      if (location) {
        const abs = new URL(location, targetUrl);
        const isSameHost = abs.host === new URL(SOURCE_URL).host;
        res.redirect(upstream.status, isSameHost ? abs.pathname + abs.search : location);
        return;
      }
    }

    const contentType = upstream.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const html = await upstream.text();
      let translated = await translateHtml(html, SOURCE_URL);
      translated = translated.includes('</body>')
        ? translated.replace('</body>', `${buildLiveSyncScript()}</body>`)
        : translated + buildLiveSyncScript();
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-store'); // alltid färskt – realtid mot källsidan
      res.status(upstream.status).send(translated);
    } else {
      // CSS, JS, bilder, typsnitt osv – skickas igenom oförändrade
      res.status(upstream.status);
      res.set('Content-Type', contentType);
      const cacheControl = upstream.headers.get('cache-control');
      if (cacheControl) res.set('Cache-Control', cacheControl);
      const buffer = await upstream.buffer();
      res.send(buffer);
    }
  } catch (err) {
    console.error('Fel vid proxyhämtning:', err.message);
    res.status(502).send('Kunde inte hämta eller översätta källsidan just nu.');
  }
});

app.listen(PORT, () => {
  console.log(`Italiensk översättningsproxy körs på port ${PORT}`);
  console.log(`Käll-sida: ${SOURCE_URL} (${SOURCE_LANG} → ${TARGET_LANG})`);
});
