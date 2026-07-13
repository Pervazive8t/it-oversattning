(function () {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);
  const OVERLAY_ID = '__live_translate_overlay__';

  const state = {
    enabled: false,
    proxyUrl: '',
    debounceMs: 600,
  };

  const timers = new WeakMap(); // textnod -> pågående timeout
  const lastInput = new WeakMap(); // textnod -> senaste text vi redan skickat för översättning

  let observer = null;
  let overlayEl = null;

  const MAX_SEGMENTS = 4; // hur många senaste "meningar" som visas samtidigt
  let segments = [];

  function addSegment(text) {
    if (!text || !text.trim()) return;
    segments.push(text.trim());
    if (segments.length > MAX_SEGMENTS) {
      segments = segments.slice(segments.length - MAX_SEGMENTS);
    }
    renderOverlay();
  }

  // Egen ruta vi helt äger. Vi skriver ALDRIG i sidans egna element – därför
  // kan ramverk som React aldrig skriva över vår översättning.
  function ensureOverlay() {
    if (overlayEl && document.documentElement.contains(overlayEl)) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = OVERLAY_ID;
    overlayEl.setAttribute('data-no-translate', 'true');
    Object.assign(overlayEl.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      bottom: '0',
      padding: '24px 32px',
      background: 'rgba(0,0,0,0.8)',
      color: '#ffffff',
      fontSize: '32px',
      lineHeight: '1.35',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      zIndex: '2147483647',
      textAlign: 'center',
      pointerEvents: 'none',
      boxSizing: 'border-box',
      maxHeight: '40vh',
      overflow: 'hidden',
    });
    document.documentElement.appendChild(overlayEl);
    return overlayEl;
  }

  function renderOverlay() {
    const el = ensureOverlay();
    el.textContent = segments.join('  ·  ');
  }

  function isEligible(node) {
    if (!node || node.nodeType !== 3) return false;
    const text = node.data;
    if (!text || !text.trim()) return false;
    const parent = node.parentElement;
    if (!parent) return false;
    if (SKIP_TAGS.has(parent.tagName)) return false;
    if (parent.closest && parent.closest('[data-no-translate]')) return false;
    return true;
  }

  function scheduleTranslate(node) {
    if (!isEligible(node)) return;
    const text = node.data;
    if (lastInput.get(node) === text) return; // redan i kö/klar för exakt denna text

    if (timers.has(node)) clearTimeout(timers.get(node));
    const t = setTimeout(() => doTranslate(node), state.debounceMs);
    timers.set(node, t);
  }

  function computeNewPart(oldText, newText) {
    if (!oldText) return newText;
    if (newText.startsWith(oldText)) {
      // Texten har bara vuxit i slutet (typiskt för live-diktering) – skicka bara det nya
      return newText.slice(oldText.length);
    }
    // Texten byttes ut helt/oväntat – översätt allt på nytt
    return newText;
  }

  function doTranslate(node) {
    timers.delete(node);
    if (!isEligible(node)) return;
    const text = node.data;
    const previousInput = lastInput.get(node);
    if (previousInput === text) return;

    const newPart = computeNewPart(previousInput, text);
    lastInput.set(node, text);

    if (!newPart || !newPart.trim()) return; // inget nytt att översätta

    // Om tillägget laddats om medan den här sidan redan var öppen tappar det
    // gamla skript-instansen kontakten med tillägget. Sluta tyst istället för
    // att krascha – lösningen är ändå bara att ladda om sidan.
    if (!chrome.runtime || !chrome.runtime.id) {
      stop();
      return;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: 'translate',
          text: newPart,
          proxyUrl: state.proxyUrl,
        },
        (response) => {
          if (chrome.runtime.lastError) return;
          if (!response || !response.ok) {
            console.warn('[Live-översättning] misslyckades:', response && response.error);
            return;
          }
          // Läggs till som ett nytt "segment" i vår rullande overlay – rör
          // aldrig sidans egna element, så vi kan inte bli överskrivna om
          // sidan (t.ex. ett React-baserat gränssnitt) renderar om sig själv.
          addSegment(response.translated);
        }
      );
    } catch (e) {
      // "Extension context invalidated" e.dyl. – tillägget laddades om.
      // Sluta bevaka tyst; en sidladdning löser det.
      stop();
    }
  }

  function walkAndSchedule(root) {
    if (root.nodeType === 3) {
      scheduleTranslate(root);
      return;
    }
    if (root.nodeType !== 1) return;
    if (root.id === OVERLAY_ID) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) scheduleTranslate(n);
  }

  function handleMutations(mutations) {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        scheduleTranslate(m.target);
      } else if (m.type === 'childList') {
        m.addedNodes.forEach((added) => walkAndSchedule(added));
      }
    }
  }

  function start() {
    if (observer || !document.body) return;
    ensureOverlay();
    walkAndSchedule(document.body);
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function stop() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
      overlayEl = null;
    }
  }

  function loadSettingsAndApply() {
    chrome.storage.sync.get(
      ['enabled', 'proxyUrl', 'debounceMs'],
      (cfg) => {
        state.enabled = !!cfg.enabled;
        state.proxyUrl = cfg.proxyUrl || '';
        state.debounceMs = cfg.debounceMs || 600;
        if (state.enabled) start();
        else stop();
      }
    );
  }

  chrome.storage.onChanged.addListener(loadSettingsAndApply);

  if (document.body) loadSettingsAndApply();
  else document.addEventListener('DOMContentLoaded', loadSettingsAndApply);
})();
