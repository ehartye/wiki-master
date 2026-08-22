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

  // ===== Topic filter =====
  // Topic filters ACROSS the kind groups rather than replacing them: kind
  // decides which actions a row offers, so those groups stay. '*' means no
  // filter; '' is the unattributed bucket, which is a real selection and not
  // the same as "all".
  var activeTopic = '*';

  function applyFilter() {
    var rows = document.querySelectorAll('.issue');
    for (var i = 0; i < rows.length; i++) {
      var key = rows[i].getAttribute('data-topic-key') || '';
      var show = activeTopic === '*' || key === activeTopic;
      rows[i].classList.toggle('is-hidden', !show);
    }
    // A group whose every row is filtered out is noise — and worse, its bulk
    // bar would offer actions over nothing.
    var groups = document.querySelectorAll('.group');
    for (var g = 0; g < groups.length; g++) {
      groups[g].classList.toggle('is-hidden', visibleRows(groups[g]).length === 0);
    }
    refreshCounts();
  }

  // The invariant this whole function exists to protect: a bulk button must
  // never claim more rows than it will actually act on. group() already
  // guarantees that for a truncated list; a filter is a SECOND way to show
  // fewer rows than exist, so the counts are recomputed from what is on
  // screen rather than trusted from render time.
  function refreshCounts() {
    var groups = document.querySelectorAll('.group');
    for (var g = 0; g < groups.length; g++) {
      var n = visibleRows(groups[g]).length;
      var header = groups[g].querySelector('h3 .count');
      if (header) header.textContent = n;
      var btns = groups[g].querySelectorAll('.bulk-act');
      for (var b = 0; b < btns.length; b++) {
        var btn = btns[b];
        if (btn === armed) continue; // mid-confirm; disarm() will restore it
        btn.dataset.bulkCount = n;
        btn.textContent = btn.dataset.bulkLabel + ' all ' + n;
        btn.disabled = n === 0;
      }
    }
  }

  // The one definition of "a row this action would touch", shared by the
  // labels and by the code that acts. Two definitions here is how a button
  // comes to lie about its own count.
  function visibleRows(scope) {
    return [].slice.call(scope.querySelectorAll('.issue')).filter(function (r) {
      return !r.classList.contains('done') && !r.classList.contains('is-hidden');
    });
  }

  function selectTopic(key) {
    activeTopic = key;
    var chips = document.querySelectorAll('.topic-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('is-on', chips[i].getAttribute('data-topic-filter') === key);
    }
    disarm();
    applyFilter();
    setStatus(key === '*' ? 'showing all topics' : 'filtered to ' + (key || 'unattributed'));
  }

  // ===== Disposition =====
  // Delegated: buttons carry data-url / data-kind / data-act, so untrusted URLs
  // never reach an inline handler.
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest) return;
    var chip = ev.target.closest('.topic-chip');
    if (chip) return selectTopic(chip.getAttribute('data-topic-filter'));
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
    // visibleRows, not every row in the group: under a topic filter the hidden
    // rows belong to a different research run, and sweeping them up is exactly
    // the mistake the recomputed label promises not to make.
    var rows = visibleRows(group);
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
    refreshCounts();
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
        refreshCounts();
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
    refreshCounts();

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
        refreshCounts();
        setStatus('FAILED to record (' + err.message + ') — not saved', true);
      });
  }

  // "Browse" for a source you fetched by hand. The browser will not disclose the
  // picked file's path, so the bytes are POSTed to the local server, which saves
  // them outside the vault and records that path in the disposition — no filename
  // or title matching, and it works wherever the file happens to live.
  document.addEventListener('change', function (ev) {
    var input = ev.target;
    if (!input || input.type !== 'file' || !input.dataset || !input.dataset.url) return;
    var file = input.files && input.files[0];
    if (!file) return;
    upload(input, file);
  });

  function upload(input, file) {
    var row = input.closest('.issue');
    var label = input.closest('.browse');
    if (row) row.classList.add('done');
    setStatus('uploading ' + file.name + '…');

    fetch('/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-wm-url': input.dataset.url,
        'x-wm-kind': input.dataset.kind,
        'x-wm-filename': file.name
      },
      body: file
    })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function () {
        if (label) label.classList.add('chosen');
        setStatus('saved ' + file.name + ' → run apply-reclips to clip it');
      })
      .catch(function (err) {
        if (row) row.classList.remove('done');
        setStatus('FAILED to upload (' + err.message + ') — not saved', true);
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
      // Follow the page's own protocol. Behind an HTTPS front — a tunnel, a
      // reverse proxy, `tailscale serve` — a hardcoded ws:// is blocked as
      // mixed content, and live reload dies with no error the user can see.
      var scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
      ws = new WebSocket(scheme + location.host);
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
