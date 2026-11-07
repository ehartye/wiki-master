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
  const sectionFromPanel = (document, panel, label, level) => {
    const section = document.createElement('section');
    if (label) {
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
    for (let node = section.parentElement; node && node !== root;) {
      const parent = node.parentElement;
      if (isWrapper(node)) unwrap(node);
      node = parent;
    }
    for (const node of [...section.querySelectorAll('*')]) if (isWrapper(node)) unwrap(node);
  };

  return { isEmptyPanel, tabGroups, panelOfTab, labelOfTab, panelKey, labelLevel, sectionFromPanel, applyWrapperRule };
}
