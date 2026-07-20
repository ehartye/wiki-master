// Client runtime for the wiki-master triage surface.
// Injected by server.cjs before </body>. Keep dependency-free.

(function () {
  var THEME_KEY = 'wm-triage-theme';

  // ===== Theme =====
  var saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  window.wmToggleTheme = function () {
    var el = document.documentElement;
    var current = el.getAttribute('data-theme');
    if (!current) {
      // No explicit override yet — flip away from whatever the OS is giving us.
      var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      current = prefersDark ? 'dark' : 'light';
    }
    var next = current === 'dark' ? 'light' : 'dark';
    el.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
  };

  // ===== Disposition =====
  // Delegated: buttons carry data-url / data-kind / data-act, so untrusted URLs
  // never reach an inline handler.
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    var bulk = ev.target.closest('.bulk-act');
    if (bulk) return armOrRunBulk(bulk);
    var btn = ev.target.closest('.act');
    if (!btn || !btn.dataset || !btn.dataset.act) return;
    dispose(btn, btn.dataset.url, btn.dataset.kind, btn.dataset.act);
  });

  // Two-step arm rather than confirm(). A modal dialog would block the page and,
  // under browser automation, wedge the whole session — and a bulk apply over
  // dozens of rows is worth one deliberate second click.
  var armed = null;
  var armTimer = null;

  function disarm() {
    if (!armed) return;
    armed.classList.remove('armed');
    armed.textContent = armed.dataset.bulkLabel + ' all ' + armed.dataset.bulkCount;
    armed = null;
    clearTimeout(armTimer);
  }

  function armOrRunBulk(btn) {
    if (armed !== btn) {
      disarm();
      armed = btn;
      btn.classList.add('armed');
      btn.textContent = 'confirm × ' + btn.dataset.bulkCount;
      armTimer = setTimeout(disarm, 5000);
      setStatus('click again to apply "' + btn.dataset.bulkAct + '" to ' + btn.dataset.bulkCount + ' item(s)');
      return;
    }
    var target = btn;
    disarm();
    runBulk(target);
  }

  function runBulk(btn) {
    var group = document.querySelector('[data-group="' + btn.dataset.bulkGroup + '"]');
    if (!group) return;
    var rows = [].slice.call(group.querySelectorAll('.issue')).filter(function (r) {
      return !r.classList.contains('done');
    });
    var items = [];
    rows.forEach(function (r) {
      var a = r.querySelector('.act[data-url]');
      if (a) items.push({ url: a.dataset.url, kind: a.dataset.kind, disposition: btn.dataset.bulkAct });
    });
    if (!items.length) {
      setStatus('nothing left to apply in that group');
      return;
    }

    rows.forEach(function (r) { r.classList.add('done'); });
    setStatus('recording ' + items.length + '…');

    fetch('/disposition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        setStatus('recorded ' + (j.count || items.length) + ' × ' + btn.dataset.bulkAct);
      })
      .catch(function (err) {
        rows.forEach(function (r) { r.classList.remove('done'); });
        setStatus('FAILED to record bulk (' + err.message + ') — nothing saved', true);
      });
  }

  // Optimistic: the row updates immediately, then reverts if the POST fails.
  // A disposition that silently failed to persist would be the worst outcome
  // here — the user believes it is handled and it is not.
  function dispose(btn, url, kind, disposition) {
    var row = btn.closest('.issue');
    var group = btn.closest('.actions');
    var prior = group.querySelector('.act.chosen');

    if (prior) prior.classList.remove('chosen');
    btn.classList.add('chosen');
    if (row) row.classList.add('done');

    fetch('/disposition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, kind: kind, disposition: disposition })
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        setStatus('recorded: ' + disposition + ' → ' + shortUrl(url));
      })
      .catch(function (err) {
        btn.classList.remove('chosen');
        if (prior) prior.classList.add('chosen');
        if (row) row.classList.remove('done');
        setStatus('FAILED to record (' + err.message + ') — not saved', true);
      });
  }

  function shortUrl(u) {
    try { return new URL(u).hostname; } catch (e) { return u.slice(0, 40); }
  }

  function setStatus(text, isError) {
    var el = document.getElementById('wm-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? 'var(--error)' : '';
  }

  // ===== Live reload =====
  var dot = document.getElementById('wm-conn');
  function connect() {
    var ws;
    try {
      ws = new WebSocket('ws://' + location.host);
    } catch (e) {
      return;
    }
    ws.onopen = function () {
      if (dot) dot.classList.remove('off');
      setStatus('connected');
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'reload') location.reload();
    };
    ws.onclose = function () {
      if (dot) dot.classList.add('off');
      setStatus('disconnected — retrying');
      setTimeout(connect, 2000);
    };
    ws.onerror = function () { try { ws.close(); } catch (e) { /* ignore */ } };
  }
  connect();
})();
