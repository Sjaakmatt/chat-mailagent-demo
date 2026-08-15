/**
 * Testwidget voor het chat-kanaal.
 *
 * Eén zelfstandige pagina die de agent-Worker serveert op `GET /chat`. Genoeg
 * om de hele keten in een browser te doorlopen: bericht typen → Signal →
 * domeingrens → router → specialist → beleidslaag → antwoord terug over de
 * websocket.
 *
 * Dit is een **testwidget**, geen productiewidget. Er zit geen styling van de
 * klant in, geen herverbindingslogica voor slechte netwerken, en hij hoort niet
 * op de site van een klant. Voor productie komt er een insluitbare widget op
 * het eigen domein van de klant; die leest z'n merkkleuren uit dezelfde tokens
 * als de cockpit.
 *
 * Bewust inline en zonder build-stap: een testwidget die zelf een bundler nodig
 * heeft, gebruikt niemand.
 */

const PAGE = String.raw`<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Chat — testwidget</title>
<style>
  :root {
    --brand: #334155; --accent: #3b82f6; --alert: #ef4444;
    --surface: #fff; --muted: #f8fafc; --line: #e2e8f0; --ink: #0f172a; --ink-soft: #64748b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--muted); color: var(--ink);
    display: flex; justify-content: center; padding: 24px;
  }
  .app { width: 100%; max-width: 640px; display: flex; flex-direction: column; gap: 12px; }
  header { display: flex; align-items: baseline; gap: 10px; }
  h1 { font-size: 17px; margin: 0; }
  .status { font-size: 12px; color: var(--ink-soft); }
  .status.on { color: #15803d; }
  .status.off { color: var(--alert); }
  .setup {
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  }
  .setup label { font-size: 13px; color: var(--ink-soft); }
  input {
    font: inherit; padding: 8px 10px; border: 1px solid var(--line);
    border-radius: 8px; background: var(--surface); min-width: 0;
  }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  #log {
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px; height: 60vh; overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px;
  }
  .msg { max-width: 82%; padding: 8px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
  .msg.in { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
  .msg.out { align-self: flex-start; background: var(--muted); border: 1px solid var(--line); border-bottom-left-radius: 4px; }
  .meta { align-self: center; font-size: 12px; color: var(--ink-soft); font-style: italic; }
  /* Mededelingen die geen gespreksinhoud zijn (limiet bereikt, vertraging). */
  .notice {
    align-self: stretch; font-size: 13px; color: #b91c1c;
    background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px;
  }
  form { display: flex; gap: 8px; }
  form input { flex: 1; }
  button {
    font: inherit; font-weight: 500; padding: 8px 16px; border: 0; border-radius: 8px;
    background: var(--brand); color: #fff; cursor: pointer;
  }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .hint { font-size: 12px; color: var(--ink-soft); }
  code { background: var(--muted); padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
<div class="app">
  <header>
    <h1>Chat — testwidget</h1>
    <span class="status" id="status">verbinden…</span>
  </header>

  <div class="setup">
    <span class="hint">Nodig voor <code>systeem</code>-antwoorden en tickets.</span>
  </div>

  <div id="log" role="log" aria-live="polite"></div>

  <form id="form">
    <input id="input" placeholder="Typ een bericht…" autocomplete="off" autofocus>
    <button type="submit" id="send">Stuur</button>
  </form>

  <p class="hint">
    Sessie <code id="sid"></code>. Herladen met dezelfde <code>?session=</code> hervat het gesprek.
  </p>
</div>

<script>
(function () {
  var params = new URLSearchParams(location.search);
  var session = params.get('session');
  if (!session) {
    session = 'test-' + Math.random().toString(36).slice(2, 10);
    history.replaceState(null, '', location.pathname + '?session=' + session);
  }
  document.getElementById('sid').textContent = session;

  var log = document.getElementById('log');
  var statusEl = document.getElementById('status');
  var form = document.getElementById('form');
  var input = document.getElementById('input');
  var send = document.getElementById('send');

  function add(text, cls) {
    var el = document.createElement('div');
    el.className = cls;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    // Teruggeven zodat de wachtregel bijgewerkt kan worden in plaats van
    // dat er telkens een nieuwe onder komt.
    return el;
  }

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'status ' + (cls || '');
  }

  var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  var ws = new WebSocket(proto + '//' + location.host + '/chat/' + encodeURIComponent(session) + '/ws');

  ws.onopen = function () {
    setStatus('verbonden', 'on');
    send.disabled = false;
  };

  ws.onclose = function () {
    setStatus('verbinding gesloten', 'off');
    send.disabled = true;
    add('De verbinding is gesloten. Herlaad om verder te gaan.', 'meta');
  };

  ws.onerror = function () { setStatus('fout', 'off'); };

  ws.onmessage = function (event) {
    var data;
    try { data = JSON.parse(event.data); } catch (e) { return; }

    if (data.type === 'history' && Array.isArray(data.messages)) {
      data.messages.forEach(function (m) {
        add(m.body, 'msg ' + (m.direction === 'inbound' ? 'in' : 'out'));
      });
      if (data.messages.length) add('— eerdere berichten —', 'meta');
      return;
    }
    // Voortgang vervangt zichzelf in plaats van te stapelen: drie regels onder
    // elkaar leest als drie gebeurtenissen, terwijl het één wachtende beurt is.
    if (data.type === 'status') { setPending(data.body); return; }
    if (data.type === 'message') { clearPending(); add(data.body, 'msg out'); return; }
    if (data.type === 'notice') { clearPending(); add(data.body, 'notice'); return; }
  };

  // Een wachtregel per beurt: pending is het element zelf, zodat de tekst
  // wordt bijgewerkt in plaats van dat er een regel bij komt.
  var pending = null;
  function setPending(text) {
    if (!pending) pending = add(text, 'meta');
    else pending.textContent = text;
  }
  function clearPending() {
    if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
    pending = null;
  }

  form.onsubmit = function (e) {
    e.preventDefault();
    var body = input.value.trim();
    if (!body || ws.readyState !== WebSocket.OPEN) return;
    // Zelfde gedrag als de productiewidget: alleen tekst. Een adres in het
    // bericht haalt de server er zelf uit.
    ws.send(JSON.stringify({ body: body }));
    add(body, 'msg in');
    input.value = '';
    // Zichtbaar maken dat er iets loopt. De lus stuurt daarna zelf fasen
    // ('routeren', 'opzoeken', 'schrijven') die deze regel vervangen.
    setPending('de agent kijkt ernaar…');
  };

  send.disabled = true;
})();
</script>
</body>
</html>`;

export function chatWidgetResponse(): Response {
  return new Response(PAGE, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Testwidget: niet cachen, zodat een aanpassing meteen zichtbaar is.
      'cache-control': 'no-store',
    },
  });
}
