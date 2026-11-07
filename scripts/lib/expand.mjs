// What a tab group is, for two DOMs: linkedom in Node, which reads and flattens served HTML, and the page itself.
// Everything is inside one function, using nothing from its module, so that the browser can be handed the same rules.
export function tabDomRules() {
  const tokens = (value) => String(value ?? '').split(/\s+/).filter(Boolean);

  const hasText = (node) => [...node.childNodes].some((child) => (child.nodeType === 3
    ? child.textContent.trim() !== ''
    : child.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(child.tagName) && hasText(child)));
  const isEmptyPanel = (panel) => !hasText(panel) && !panel.querySelector('img, picture, video, audio, iframe, object, embed');

  // In document order. A panel belongs to the last tab list before it at its own nesting depth, so an inner group
  // doesn't take its parent's panels, and two groups in one container keep theirs apart.
  const tabGroups = (root) => {
    const groups = [];
    const current = new Map();
    for (const node of root.querySelectorAll('[role="tablist"], [role="tabpanel"]')) {
      const depth = node.parentElement?.closest('[role="tabpanel"]') ?? null;
      if (node.getAttribute('role') === 'tablist') {
        const group = { tablist: node, tabs: [...node.querySelectorAll('[role="tab"]')], panels: [] };
        groups.push(group);
        current.set(depth, group);
      } else current.get(depth)?.panels.push(node);
    }
    return groups;
  };

  // A tab's panel through its aria-controls, then a panel's aria-labelledby, then its position in the group, which is
  // only evidence when the group has one panel per tab. getElementById and token comparison, not selectors: ids are
  // often framework-generated (`r:1:`), and linkedom has no CSS.escape. `absent` is a tab naming a panel the HTML lacks.
  const panelOfTab = (tab, document, group) => {
    const named = tokens(tab.getAttribute('aria-controls'));
    for (const id of named) {
      const panel = document.getElementById(id);
      if (panel) return { panel };
    }
    const own = tab.getAttribute('id');
    if (own) {
      for (const panel of document.querySelectorAll('[role="tabpanel"]')) {
        if (tokens(panel.getAttribute('aria-labelledby')).includes(own)) return { panel };
      }
    }
    if (named.length) return { absent: true };
    if (group && group.tabs.length === group.panels.length) return { panel: group.panels[group.tabs.indexOf(tab)] };
    return {};
  };

  const labelOfTab = (tab) => tab.textContent.replace(/\s+/g, ' ').trim() || tab.getAttribute('aria-label') || '';

  // Identity of a panel in its group. Two panels can read alike and differ only in where their links go, as download
  // tabs do, so destinations count.
  const panelKey = (panel) => {
    const words = (node) => [...node.childNodes].map((child) => (child.nodeType === 3 ? child.textContent
      : child.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE)$/.test(child.tagName) ? words(child) : '')).join(' ');
    const targets = [...panel.querySelectorAll('a[href], img[src]')].map((node) => node.getAttribute('href') ?? node.getAttribute('src'));
    return `${words(panel).replace(/\s+/g, ' ').trim()}\n${targets.join('\n')}`;
  };

  // One below the heading a tab list sits under, and below its parent panel's label. A heading in a neighboring
  // panel isn't one it sits under.
  const labelLevel = (tablist, root, parentLevel = 0) => {
    let last = 1;
    for (const node of root.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="tablist"]')) {
      if (node === tablist) break;
      if (node.getAttribute('role') === 'tablist') continue;
      const owner = node.closest('[role="tabpanel"]');
      if (!owner || owner.contains(tablist)) last = Number(node.tagName[1]);
    }
    return Math.min(6, Math.max(last, parentLevel) + 1);
  };

  // A plain section takes the panel's children, so its role, hiding and wrapper-like attributes go with the panel.
  // A panel already opening with a heading of the label's text (trimmed, whitespace-collapsed, case-insensitive) needs
  // no second one. Only the first element child counts, and only when it is a heading.
  const squash = (text) => text.replace(/\s+/g, ' ').trim().toLowerCase();
  const sameText = (a, b) => squash(a) === squash(b);
  const opensWithLabel = (panel, label) => {
    const first = panel.firstElementChild;
    return !!first && /^H[1-6]$/.test(first.tagName) && sameText(first.textContent, label);
  };
  const sectionFromPanel = (document, panel, label, level) => {
    const section = document.createElement('section');
    if (label && !opensWithLabel(panel, label)) {
      const heading = document.createElement(`h${level}`);
      heading.textContent = label;
      section.append(heading);
    }
    section.append(...panel.childNodes);
    return section;
  };

  // Defuddle deletes on a case-insensitive `tabs-` match in these attributes (its partial selectors and
  // TEST_ATTRIBUTES), so any wrapper above a panel, or block inside one, takes the panel's content with it. A table or a
  // list has to stay what it is, so it loses the attribute and not its element.
  const WRAPPER_ATTRIBUTES = ['class', 'id', 'data-component', 'data-test', 'data-testid', 'data-test-id', 'data-qa', 'data-cy'];
  const matchesWrapper = (node, name) => /tabs-/i.test(node.getAttribute(name) ?? '');
  const unwrap = (node) => {
    if (/^(DIV|SECTION|ARTICLE|SPAN)$/.test(node.tagName)) { node.replaceWith(...node.childNodes); return; }
    for (const name of WRAPPER_ATTRIBUTES) if (matchesWrapper(node, name)) node.removeAttribute(name);
  };
  const isWrapper = (node) => WRAPPER_ATTRIBUTES.some((name) => matchesWrapper(node, name));
  const applyWrapperRule = (section, root) => {
    for (let node = section.parentElement; node && node !== root && root.contains(node);) {
      const parent = node.parentElement;
      if (isWrapper(node)) unwrap(node);
      node = parent;
    }
    for (const node of [...section.querySelectorAll('*')]) if (isWrapper(node)) unwrap(node);
  };

  // An API introduction may be a sibling of its article, or of several sections. Never narrow the capture or audit to
  // only the introduction's nearest section.
  const contentRoot = (document) => {
    const description = document.querySelector('.class-description');
    const main = document.querySelector('main, [role="main"]');
    if (main) return main;
    const article = document.querySelector('article');
    return description ? (article?.contains(description) ? article : document.body) : (article ?? document.body);
  };

  return { contentRoot, isEmptyPanel, tabGroups, panelOfTab, labelOfTab, panelKey, labelLevel, sectionFromPanel, applyWrapperRule };
}

export const MAX_EXPAND_CLICKS = 200;
export const MAX_EXPAND_MS = 60000;
// A panel that has its content is settled once the page stops changing for this long. One that is still empty, or
// still shows the last tab's content, may be waiting on the network, so it gets the longer wait.
const QUIET_MS = 50;
const SETTLE_MS = 3000;
// The page's own main thread can hang, where the page-side deadline can't fire.
const HANG_MARGIN_MS = 5000;

// Runs in the page, through page.evaluate, so it uses nothing from this module; `rules` is tabDomRules' result, as a
// handle from the same page. It opens everything first and only changes the DOM's structure at the end: a framework
// re-rendering after a later click would trip over a node moved under it. Panels are copied while open because a closing
// or replaced panel loses its content, which is also why nothing here reads innerText.
export async function expandInPage({ rules, maxClicks, maxMs, quietMs, settleMs }) {
  const { contentRoot, isEmptyPanel, tabGroups, panelOfTab, labelOfTab, panelKey, labelLevel, sectionFromPanel, applyWrapperRule } = rules;
  const deadline = Date.now() + maxMs;
  const OFF_LIMITS = 'nav, header, footer, form';
  const root = contentRoot(document);
  const counts = { tabs: 0, panels: 0, details: 0, truncated: false };
  let clicks = 0;

  const mayClick = () => {
    if (clicks < maxClicks && Date.now() < deadline) { clicks++; return true; }
    counts.truncated = true;
    return false;
  };
  // Some component libraries activate a tab on mouse down and ignore click, so this is the whole gesture.
  const press = (node) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      const Event = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true, button: 0 }));
    }
    node.click();
  };
  const settled = (ready) => new Promise((resolve) => {
    const started = Date.now();
    let changed = started;
    const observer = new MutationObserver(() => { changed = Date.now(); });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    const check = () => {
      const now = Date.now();
      const done = (now - changed >= quietMs && ready()) || now - started >= settleMs;
      // Out of time while waiting is a limit hit even when no click follows to notice it.
      if (done || now >= deadline) { if (!done) counts.truncated = true; observer.disconnect(); resolve(); } else setTimeout(check, 10);
    };
    setTimeout(check, 10);
  });
  const reveal = (node) => {
    node.removeAttribute('hidden');
    node.removeAttribute('aria-hidden');
    node.removeAttribute('inert');
    node.classList.remove('hidden', 'invisible');
    if (node.style) { node.style.removeProperty('display'); node.style.removeProperty('visibility'); }
  };

  const openDetails = (scope) => {
    for (const details of scope.querySelectorAll('details:not([open])')) {
      if (details.closest(OFF_LIMITS)) continue;
      details.open = true;
      counts.details++;
    }
  };
  // Pressing one can bring in another, and an accordion closes or unmounts the last, so what each showed is kept.
  const opened = new Map();
  const pressToggles = async (scope, skipPanels) => {
    for (;;) {
      const toggle = [...scope.querySelectorAll('[aria-expanded="false"][aria-controls]')].find((node) => !opened.has(node)
        && node.getAttribute('role') !== 'tab' && !node.closest(OFF_LIMITS) && !(skipPanels && node.closest('[role="tabpanel"]')));
      if (!toggle || !mayClick()) return;
      const target = () => document.getElementById(toggle.getAttribute('aria-controls').split(/\s+/)[0]);
      opened.set(toggle, null);
      press(toggle);
      await settled(() => target() && !isEmptyPanel(target()));
      if (target() && !isEmptyPanel(target())) opened.set(toggle, target().cloneNode(true));
    }
  };

  const disabled = (tab) => tab.hasAttribute('disabled') || tab.getAttribute('aria-disabled') === 'true';
  const expandGroup = async (tablist, scope, parentLevel) => {
    const level = labelLevel(tablist, root, parentLevel);
    const result = { tablist, sections: [], copied: new Set(), pressed: new Set() };
    const group = () => tabGroups(scope).find((candidate) => candidate.tablist === tablist);
    const seen = new Set();
    let last = null;
    for (const tab of group()?.tabs ?? []) {
      if (disabled(tab) || tab.closest(OFF_LIMITS)) continue;
      if (!tablist.isConnected) { counts.truncated = true; break; }
      if (!mayClick()) break;
      counts.tabs++;
      result.pressed.add(tab);
      // A tab with no link to a panel shows whichever one is visible. When tabs share one panel, the last tab's
      // content is still there until the new one arrives.
      const shown = () => {
        const current = group();
        const { panel } = panelOfTab(tab, document, current);
        return panel ?? current?.panels.find((candidate) => !candidate.hidden && getComputedStyle(candidate).display !== 'none');
      };
      const isStale = (panel) => last && panel === last.panel && panelKey(panel) === last.key;
      press(tab);
      await settled(() => { const panel = shown(); return panel && !isEmptyPanel(panel) && !isStale(panel); });
      const panel = shown();
      if (!panel || isEmptyPanel(panel)) continue;
      last = { panel, key: panelKey(panel) };
      result.copied.add(panel);

      openDetails(panel);
      await pressToggles(panel, false);
      const nested = [];
      for (const inner of panel.querySelectorAll('[role="tablist"]')) {
        if (inner.parentElement.closest('[role="tabpanel"]') === panel && !inner.closest(OFF_LIMITS)) nested.push(await expandGroup(inner, panel, level));
      }
      const copy = panel.cloneNode(true);
      const STRUCTURE = '[role="tablist"], [role="tabpanel"], [role="tab"]';
      const live = [...panel.querySelectorAll(STRUCTURE)], copied = [...copy.querySelectorAll(STRUCTURE)];
      const copyOf = (node) => copied[live.indexOf(node)];
      for (const inner of nested) {
        const list = copyOf(inner.tablist);
        list?.before(...inner.sections);
        for (const node of [...inner.copied, ...inner.pressed]) copyOf(node)?.remove();
        if (list && !list.querySelector('[role="tab"]')) list.remove();
      }
      const key = panelKey(copy);
      if (seen.has(key)) continue;
      seen.add(key);
      result.sections.push(sectionFromPanel(document, copy, labelOfTab(tab), level));
      counts.panels++;
    }
    return result;
  };

  openDetails(document);
  await settled(() => true);
  const results = [];
  const done = new Set();
  for (;;) {
    const next = tabGroups(document.body).map((group) => group.tablist)
      .find((tablist) => !done.has(tablist) && !tablist.parentElement.closest('[role="tabpanel"]') && !tablist.closest(OFF_LIMITS));
    if (!next) break;
    done.add(next);
    results.push(await expandGroup(next, document.body, 0));
  }
  await pressToggles(document, true);

  for (const { tablist, sections, copied, pressed } of results) {
    tablist.before(...sections);
    for (const node of [...copied, ...pressed]) node.remove();
    if (!tablist.querySelector('[role="tab"]')) tablist.remove();
    for (const section of sections) applyWrapperRule(section, root);
  }
  for (const [toggle, copy] of opened) {
    const target = document.getElementById(toggle.getAttribute('aria-controls').split(/\s+/)[0]);
    if (target && !isEmptyPanel(target)) reveal(target);
    else if (copy) { reveal(copy); toggle.after(copy); }
  }
  return counts;
}

// Keeps a click in the page it was made in. A popup's first request escapes the context's route, so nothing may open
// one: window.open does nothing, and every target (a link's, an area's, a form's, a submit button's, a base element's)
// is the page's own, where the route aborts a navigation. Runs in the page, so it uses nothing from this module.
export function holdTargets() {
  if (window.__wikiMasterHeld) return;
  window.__wikiMasterHeld = true;
  window.open = () => null;
  const hold = () => {
    for (const node of document.querySelectorAll('[target], [formtarget]')) {
      if (node.hasAttribute('target')) node.setAttribute('target', '_self');
      if (node.hasAttribute('formtarget')) node.setAttribute('formtarget', '_self');
    }
  };
  document.addEventListener('click', hold, true);
  document.addEventListener('submit', hold, true);
  // submit() fires no event, so it is held before it runs.
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function held() { hold(); return submit.call(this); };
}

// Blocks what a click could change on the server or leave the page for, then opens everything. On the context, not the
// page, so a popup's requests are covered too. `render` blocks service workers for the same reason: a page's requests
// through one don't reach this route.
export async function expandPage(page, { maxClicks = MAX_EXPAND_CLICKS, maxMs = MAX_EXPAND_MS } = {}) {
  const context = page.context();
  await context.route('**/*', (route) => {
    const request = route.request();
    let topLevel = false;
    try { topLevel = request.isNavigationRequest() && !request.frame().parentFrame(); } catch { /* no frame to leave */ }
    // 'aborted', because any other error makes Chrome commit its error page, which is a navigation.
    return (request.method() !== 'GET' || topLevel ? route.abort('aborted') : route.continue()).catch(() => {});
  });
  // A window opened anyway is a backstop, closed as it appears. Frames to come get the hold as they load.
  context.on('page', (popup) => { popup.close().catch(() => {}); });
  await context.addInitScript(holdTargets);
  for (const frame of page.frames()) await frame.evaluate(holdTargets).catch(() => {});
  const rules = await page.evaluateHandle(tabDomRules);
  let timer;
  const hang = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`expansion did not finish within ${maxMs + HANG_MARGIN_MS} ms`)), maxMs + HANG_MARGIN_MS); });
  try {
    return await Promise.race([page.evaluate(expandInPage, { rules, maxClicks, maxMs, quietMs: QUIET_MS, settleMs: SETTLE_MS }), hang]);
  } finally { clearTimeout(timer); }
}

// How many tables and fenced code blocks a clipping's Markdown holds, to compare with its page. A table Defuddle couldn't
// express in Markdown stays as HTML.
export function markdownCounts(markdown) {
  const counts = { tables: 0, code: 0 };
  let fence = null;
  for (const line of String(markdown).split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      continue;
    }
    if (marker) { fence = marker; counts.code++; continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line)) counts.tables++;
    counts.tables += (line.match(/<table\b/gi) ?? []).length;
  }
  return counts;
}

export function formatCoverage({ tabs, panels, details, tables, code, truncated }) {
  return `tabs=${tabs} panels=${panels} details=${details} tables=${tables} code=${code} truncated=${truncated}`;
}

// What an expanded clipping is short of, as fidelity warnings. Its counts are of the page's content region.
export function coverageWarnings(coverage, markdown) {
  const found = markdownCounts(markdown);
  const warnings = [];
  if (coverage.truncated) warnings.push({ kind: 'expand-coverage', label: 'expansion stopped at its click or time limit, or its tab list went away, so some content was not opened' });
  if (found.tables < coverage.tables) warnings.push({ kind: 'expand-coverage', label: `${found.tables} of ${coverage.tables} tables reached the text` });
  if (found.code < coverage.code) warnings.push({ kind: 'expand-coverage', label: `${found.code} of ${coverage.code} code blocks reached the text` });
  return warnings;
}
