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

  return { isEmptyPanel, tabGroups, panelOfTab };
}
