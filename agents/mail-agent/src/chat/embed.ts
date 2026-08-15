/**
 * Insluitbare productiewidget.
 *
 * Twee endpoints op de agent-Worker:
 *
 *   GET /widget.js   het loader-script dat de klant op z'n site zet
 *   GET /widget      de iframe-inhoud (de eigenlijke chat)
 *
 * Plaatsing is één regel op de pagina van de klant:
 *
 *   <script src="https://<agent-worker>/widget.js"
 *           data-accent="#0f766e" data-title="Klantenservice"></script>
 *
 * ## Waarom een iframe
 *
 * De CSS van de klantsite kan de widget dan niet breken en andersom. Dat
 * scheelt bij elke nieuwe klant een middag uitzoeken waarom de knop achter een
 * sticky header valt. De prijs is dat insluiting niet met de origin-check op de
 * socket te bewaken is — de iframe komt van de Worker, dus die socket heeft
 * altijd de Worker als `Origin`. Daarvoor staat `frame-ancestors` op het
 * iframe-antwoord: de browser weigert dan te renderen op een site die niet in
 * `CHAT_ALLOWED_ORIGINS` staat, en dat kan een site niet omzeilen.
 *
 * ## Geen build-stap
 *
 * Beide bestanden zijn statisch — er wordt niets van de server in de HTML of JS
 * geïnterpoleerd. Instellingen komen via `data-`attributen en query-parameters
 * en worden in de browser gelezen. Dat houdt de widget vrij van injectie en
 * cachebaar aan de rand.
 */

import { frameAncestors } from '@factumai/agent-core';
import type { Env } from '../env.js';

// ---------------------------------------------------------------------------
// Loader — draait op de pagina van de klant
// ---------------------------------------------------------------------------

const LOADER = String.raw`(function () {
  var script = document.currentScript;
  if (!script) return;

  var base = new URL(script.src).origin;
  var accent = script.getAttribute('data-accent') || '#3b82f6';
  var title = script.getAttribute('data-title') || 'Chat';
  var greeting = script.getAttribute('data-greeting') || '';
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right';

  // Sessie vasthouden over paginanavigatie heen: een bezoeker die doorklikt
  // naar een productpagina hoort niet opnieuw te beginnen. localStorage en niet
  // een cookie, want de widget hoort niets mee te sturen naar de klantsite.
  var KEY = 'aios-chat-session';
  var session;
  try {
    session = localStorage.getItem(KEY);
    if (!session) {
      session = 'w-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem(KEY, session);
    }
  } catch (e) {
    // Privémodus of storage geblokkeerd: dan per paginalading een nieuwe sessie.
    session = 'w-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  var src = base + '/widget'
    + '?session=' + encodeURIComponent(session)
    + '&accent=' + encodeURIComponent(accent)
    + '&title=' + encodeURIComponent(title)
    + (greeting ? '&greeting=' + encodeURIComponent(greeting) : '');

  var open = false;

  var frame = document.createElement('iframe');
  frame.src = src;
  frame.title = title;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = [
    'position:fixed', side + ':20px', 'bottom:92px',
    'width:380px', 'height:560px', 'max-width:calc(100vw - 40px)',
    'max-height:calc(100vh - 120px)', 'border:0', 'border-radius:14px',
    'box-shadow:0 12px 40px rgba(0,0,0,.18)', 'z-index:2147483646',
    'display:none', 'background:#fff', 'color-scheme:light'
  ].join(';');

  var button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', title);
  button.setAttribute('aria-expanded', 'false');
  button.style.cssText = [
    'position:fixed', side + ':20px', 'bottom:20px',
    'width:56px', 'height:56px', 'border:0', 'border-radius:50%',
    'background:' + accent, 'color:#fff', 'cursor:pointer',
    'box-shadow:0 6px 20px rgba(0,0,0,.22)', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:0', 'font:inherit'
  ].join(';');
  button.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>'
    + '</svg>';

  function setOpen(next) {
    open = next;
    frame.style.display = open ? 'block' : 'none';
    frame.setAttribute('aria-hidden', open ? 'false' : 'true');
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      try { frame.contentWindow.postMessage({ type: 'aios-focus' }, base); } catch (e) {}
    }
  }

  button.addEventListener('click', function () { setOpen(!open); });

  // Escape sluit het paneel — verwachting bij elk overlay-element.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) setOpen(false);
  });

  // De iframe mag zichzelf sluiten. Alleen berichten van ónze origin, anders
  // kan elke andere ingesloten partij de widget aansturen.
  window.addEventListener('message', function (e) {
    if (e.origin !== base || !e.data) return;
    if (e.data.type === 'aios-close') setOpen(false);
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(button);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();`;

export function widgetLoaderResponse(): Response {
  return new Response(LOADER, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      // Kort cachen: een klant die de kleur aanpast wil dat dezelfde dag zien,
      // maar elke paginalading opnieuw ophalen is zonde.
      'cache-control': 'public, max-age=300',
    },
  });
}

// ---------------------------------------------------------------------------
// Iframe — de eigenlijke chat
// ---------------------------------------------------------------------------

const FRAME = String.raw`<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat</title>
<style>
  :root {
    --accent: #3b82f6;
    --surface: #fff; --muted: #f8fafc; --line: #e2e8f0;
    --ink: #0f172a; --ink-soft: #64748b; --alert: #b91c1c;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink); background: var(--surface);
    display: flex; flex-direction: column;
  }
  header {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 14px; background: var(--accent); color: #fff; flex: none;
  }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; flex: 1; }
  header .state { font-size: 12px; opacity: .85; }
  header button {
    border: 0; background: transparent; color: inherit; cursor: pointer;
    font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px;
  }
  header button:hover { background: rgba(255,255,255,.18); }
  #log {
    flex: 1; overflow-y: auto; padding: 14px;
    display: flex; flex-direction: column; gap: 10px; background: var(--muted);
  }
  .msg {
    max-width: 85%; padding: 9px 12px; border-radius: 12px;
    white-space: pre-wrap; word-break: break-word;
  }
  .msg.in { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
  .msg.out { align-self: flex-start; background: var(--surface); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
  .meta { align-self: center; font-size: 12px; color: var(--ink-soft); font-style: italic; text-align: center; }
  .notice {
    align-self: stretch; font-size: 13px; color: var(--alert);
    background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px;
  }
  form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--line); flex: none; }
  input, button.send {
    font: inherit; border: 1px solid var(--line); border-radius: 9px; padding: 9px 11px;
  }
  input { flex: 1; min-width: 0; }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button.send { background: var(--accent); color: #fff; border-color: transparent; cursor: pointer; }
  button.send[disabled] { opacity: .5; cursor: default; }
  /* Bewust géén identificatieveld in de widget. Zie de toelichting bij het
     formulier hieronder. */
</style>
</head>
<body>
  <header>
    <h1 id="title">Chat</h1>
    <span class="state" id="state"></span>
    <button type="button" id="close" aria-label="Sluiten">&times;</button>
  </header>

  <div id="log" role="log" aria-live="polite"></div>

  <!-- Geen e-mailveld. Een identificatievraag vóór de eerste vraag is een
       drempel voor een gesprek dat 'm meestal niet nodig heeft: een vraag over
       een prijs of een koppeling gaat niemand aan. Moet de agent iets opzoeken
       dat aan een persoon hangt, dan vraagt hij er zelf om en typt de bezoeker
       het in zijn antwoord; de sessie onthoudt het daarna. -->
  <form id="form">
    <input id="input" placeholder="Typ je vraag…" autocomplete="off" aria-label="Bericht">
    <button type="submit" class="send" id="send" disabled>Stuur</button>
  </form>

<script>
(function () {
  var params = new URLSearchParams(location.search);
  var session = params.get('session') || ('w-' + Math.random().toString(36).slice(2, 10));
  var accent = params.get('accent');
  var title = params.get('title');
  var greeting = params.get('greeting');

  if (accent && /^#[0-9a-fA-F]{3,8}$/.test(accent)) {
    document.documentElement.style.setProperty('--accent', accent);
  }
  if (title) {
    document.getElementById('title').textContent = title;
    document.title = title;
  }

  var log = document.getElementById('log');
  var stateEl = document.getElementById('state');
  var form = document.getElementById('form');
  var input = document.getElementById('input');
  var send = document.getElementById('send');

  var ws = null;
  var attempt = 0;
  var closedByUs = false;
  var greeted = false;

  function add(text, cls) {
    var el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function setState(text) { stateEl.textContent = text; }

  // Een wachtregel per beurt: pending is het element zelf, zodat de tekst
  // wordt bijgewerkt in plaats van dat er een regel bij komt.
  var pending = null;
  function setPending(text) {
    if (!pending) pending = add(text, 'meta');
    else pending.textContent = text;
    log.scrollTop = log.scrollHeight;
  }
  function clearPending() {
    if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
    pending = null;
  }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/chat/' + encodeURIComponent(session) + '/ws');

    ws.onopen = function () {
      attempt = 0;
      setState('');
      send.disabled = false;
    };

    ws.onclose = function () {
      send.disabled = true;
      if (closedByUs) return;
      // Opnieuw proberen met oplopende wachttijd: een haperend netwerk of een
      // uitrol mag geen gesprek kosten. Gemaximeerd op 30s, want daarna is het
      // geen hapering meer en helpt vaker proberen niet.
      attempt++;
      var wait = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
      setState('verbinden…');
      setTimeout(connect, wait);
    };

    ws.onerror = function () { try { ws.close(); } catch (e) {} };

    ws.onmessage = function (event) {
      var data;
      try { data = JSON.parse(event.data); } catch (e) { return; }

      if (data.type === 'history' && Array.isArray(data.messages)) {
        // Bij een herverbinding staat het verloop er al; opnieuw tekenen zou
        // alles verdubbelen. Alleen vullen als het log nog leeg is.
        if (!log.children.length) {
          data.messages.forEach(function (m) {
            add(m.body, 'msg ' + (m.direction === 'inbound' ? 'in' : 'out'));
          });
        }
        if (!greeted && greeting && !log.children.length) {
          add(greeting, 'msg out');
        }
        greeted = true;
        return;
      }
      // Voortgang vervangt zichzelf in plaats van te stapelen: drie regels
      // onder elkaar leest als drie gebeurtenissen, terwijl het één wachtende
      // beurt is.
      if (data.type === 'status') { setPending(data.body); return; }
      if (data.type === 'message') { clearPending(); add(data.body, 'msg out'); return; }
      if (data.type === 'notice') { clearPending(); add(data.body, 'notice'); return; }
    };
  }

  form.onsubmit = function (e) {
    e.preventDefault();
    var body = input.value.trim();
    if (!body || !ws || ws.readyState !== WebSocket.OPEN) return;
    // Alleen de tekst. Staat er een adres in, dan haalt de server het er zelf
    // uit (extractEmail) — de bezoeker hoeft niets in een apart veld te zetten.
    ws.send(JSON.stringify({ body: body }));
    add(body, 'msg in');
    input.value = '';
    setPending('de agent kijkt ernaar…');
  };

  document.getElementById('close').onclick = function () {
    try { parent.postMessage({ type: 'aios-close' }, '*'); } catch (e) {}
  };

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'aios-focus') input.focus();
  });

  window.addEventListener('beforeunload', function () { closedByUs = true; });

  connect();
})();
</script>
</body>
</html>`;

export function widgetFrameResponse(env: Env): Response {
  return new Response(FRAME, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Hét slot op insluiting: de browser weigert te renderen op een site die
      // hier niet in staat. Zie de kop van dit bestand waarom de origin-check
      // op de socket dat niet kan.
      'content-security-policy': `frame-ancestors ${frameAncestors(env.CHAT_ALLOWED_ORIGINS)}`,
      'cache-control': 'public, max-age=300',
    },
  });
}
