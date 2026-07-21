// DOM metadata collection for a selected viewport region. Pure DOM APIs, no
// extension dependencies — usable from any web page.
//
// Component-name detection reads framework internals (React fibers, Vue
// instances, Angular debug hooks) off DOM nodes. Those are only visible in
// the JavaScript world where the framework runs: in an ordinary web app
// that's just "the page", but when called from a Chrome extension's isolated
// world the component fields will be missing (the extension solves this by
// running collection in a MAIN-world script).

const MAX_ELEMENTS = 40;
const MAX_STACK_PER_POINT = 6;
const MAX_TEXT = 140;
const MAX_ATTR_VALUE = 160;
const MAX_ATTRS = 15;
const MAX_SNIPPET = 4000;

// Attributes that carry semantic meaning an LLM can use to locate the code.
const INTERESTING_ATTRS = [
  'role', 'name', 'type', 'href', 'src', 'alt', 'title',
  'placeholder', 'for', 'value', 'disabled', 'contenteditable'
];

// Heuristic for build-generated class names (CSS-in-JS, CSS modules) that
// make brittle selectors: css-1q2w3e, sc-bdVaJa, Button_root__x7Kf2, a1b2c3d4…
const GENERATED_CLASS = /^(css|sc|jss|chakra|emotion)-|__[A-Za-z0-9_-]{5,}$|[0-9a-f]{8,}/i;

function truncate(value, max) {
  const s = String(value);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function round(n) {
  return Math.round(n * 10) / 10;
}

// --- selectors ---------------------------------------------------------------

function buildSelector(el) {
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
    if (node.id) {
      parts.unshift('#' + CSS.escape(node.id));
      break;
    }
    let part = node.localName;
    const stableClasses = [...node.classList].filter((c) => !GENERATED_CLASS.test(c)).slice(0, 2);
    if (stableClasses.length) part += '.' + stableClasses.map((c) => CSS.escape(c)).join('.');
    const parent = node.parentElement;
    if (parent) {
      const sameTag = [...parent.children].filter((s) => s.localName === node.localName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

// --- framework component detection --------------------------------------------

function componentInfo(el) {
  try {
    // React: DOM nodes carry a fiber reference under a per-render key.
    for (const key of Object.keys(el)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        const chain = [];
        let fiber = el[key];
        while (fiber && chain.length < 3) {
          const t = fiber.type;
          const name =
            typeof t === 'function' ? t.displayName || t.name
            : t && typeof t === 'object' ? t.displayName || (t.render && t.render.name)
            : null;
          if (name && !chain.includes(name)) chain.push(name);
          fiber = fiber.return;
        }
        if (chain.length) return { framework: 'react', name: chain[0], ownerChain: chain };
      }
    }
    // Vue 3
    const v3 = el.__vueParentComponent;
    if (v3) {
      const name = (v3.type && (v3.type.name || v3.type.__name)) || null;
      return { framework: 'vue', name };
    }
    // Vue 2
    const v2 = el.__vue__;
    if (v2 && v2.$options) {
      return { framework: 'vue', name: v2.$options.name || v2.$options._componentTag || null };
    }
    // Angular (dev mode exposes window.ng)
    if (window.ng && typeof window.ng.getComponent === 'function') {
      const cmp = window.ng.getComponent(el);
      if (cmp) return { framework: 'angular', name: cmp.constructor && cmp.constructor.name };
    }
  } catch {
    // Framework internals are undocumented; never let them break a capture.
  }
  return null;
}

export function detectFrameworks() {
  const found = [];
  try {
    const w = window;
    const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if ((hook && hook.renderers && hook.renderers.size > 0) ||
        document.querySelector('[data-reactroot], [data-reactid]')) found.push('react');
    if (w.__NEXT_DATA__) found.push('next.js');
    if (w.__NUXT__) found.push('nuxt');
    if (w.__VUE__ || w.Vue || document.querySelector('[data-v-app]')) found.push('vue');
    const ng = document.querySelector('[ng-version]');
    if (ng) found.push('angular@' + ng.getAttribute('ng-version'));
    if (document.querySelector('[class*="svelte-"]')) found.push('svelte');
    if (w.jQuery && w.jQuery.fn && w.jQuery.fn.jquery) found.push('jquery@' + w.jQuery.fn.jquery);
    if (w.Ember) found.push('ember');
  } catch {
    // Exotic pages define throwing global getters; a partial list is fine.
  }
  return found;
}

// --- element harvesting --------------------------------------------------------

// Grid sampling via elementsFromPoint catches whatever is actually painted
// (overlays, stacking contexts) but can miss small elements between sample
// points — so it is paired with a query for semantic/interactive elements
// that intersect the selection.
const SEMANTIC_SELECTOR =
  'a, button, input, select, textarea, label, img, svg, video, ' +
  'h1, h2, h3, h4, h5, h6, [role], [data-testid], [aria-label]';
const MAX_SEMANTIC = 30;
const MAX_SEMANTIC_SCAN = 3000;

function semanticElements(rect) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const found = [];
  const candidates = document.querySelectorAll(SEMANTIC_SELECTOR);
  for (let i = 0; i < candidates.length && i < MAX_SEMANTIC_SCAN; i++) {
    const el = candidates[i];
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= rect.x || r.left >= right || r.bottom <= rect.y || r.top >= bottom) continue;
    found.push(el);
    if (found.length >= MAX_SEMANTIC) break;
  }
  return found;
}

function samplePoints(rect) {
  const cols = Math.max(2, Math.min(7, Math.ceil(rect.width / 80) + 1));
  const rows = Math.max(2, Math.min(7, Math.ceil(rect.height / 80) + 1));
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = rect.x + 1 + (rect.width - 2) * (cols === 1 ? 0.5 : c / (cols - 1));
      const y = rect.y + 1 + (rect.height - 2) * (rows === 1 ? 0.5 : r / (rows - 1));
      points.push([Math.min(x, window.innerWidth - 1), Math.min(y, window.innerHeight - 1)]);
    }
  }
  return points;
}

function ownText(el) {
  let text = [...el.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) {
    const full = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (full.length <= 200) text = full;
  }
  return text;
}

function elementRecord(el, sel) {
  const r = el.getBoundingClientRect();
  const record = {
    selector: buildSelector(el),
    tag: el.localName,
    // Position relative to the screenshot's top-left corner, in CSS px.
    rectInScreenshot: {
      x: round(r.left - sel.x),
      y: round(r.top - sel.y),
      width: round(r.width),
      height: round(r.height)
    },
    coverage:
      r.left >= sel.x - 1 && r.top >= sel.y - 1 &&
      r.right <= sel.x + sel.width + 1 && r.bottom <= sel.y + sel.height + 1
        ? 'fully-visible' : 'partially-visible'
  };
  if (el.id) record.id = el.id;
  const classes = [...el.classList];
  if (classes.length) record.classes = classes.slice(0, 12);

  const component = componentInfo(el);
  if (component && (component.name || component.framework)) record.component = component;

  const text = ownText(el);
  if (text) record.text = truncate(text, MAX_TEXT);

  const attrs = {};
  let attrCount = 0;
  for (const name of INTERESTING_ATTRS) {
    if (attrCount >= MAX_ATTRS) break;
    if (el.hasAttribute(name)) {
      attrs[name] = truncate(el.getAttribute(name), MAX_ATTR_VALUE);
      attrCount++;
    }
  }
  for (const attr of el.attributes) {
    if (attrCount >= MAX_ATTRS) break;
    if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
      attrs[attr.name] = truncate(attr.value, MAX_ATTR_VALUE);
      attrCount++;
    }
  }
  if (attrCount) record.attributes = attrs;
  return record;
}

// --- DOM snippet ----------------------------------------------------------------

function topmostAt(x, y) {
  const stack = document.elementsFromPoint(x, y);
  return stack.find((el) => el !== document.documentElement && el !== document.body) || null;
}

function commonAncestor(a, b) {
  if (!a) return b;
  if (!b) return a;
  let node = a;
  while (node && node !== b && !node.contains(b)) node = node.parentElement;
  return node || document.body;
}

function buildSnippet(rect, target) {
  try {
    let container = target || null;
    if (!container) {
      const inset = 2;
      const topLeft = topmostAt(rect.x + inset, rect.y + inset);
      const bottomRight = topmostAt(rect.x + rect.width - inset, rect.y + rect.height - inset);
      container = commonAncestor(topLeft, bottomRight) || document.body;
    }
    if (!container) return null;

    const clone = container.cloneNode(true);
    if (clone.querySelectorAll) {
      clone.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
      for (const el of clone.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) {
          if (attr.value.length > 200) el.setAttribute(attr.name, attr.value.slice(0, 80) + '…');
        }
      }
    }
    let html = clone.outerHTML || '';
    if (html.length > MAX_SNIPPET) html = html.slice(0, MAX_SNIPPET) + '\n<!-- truncated by bowser-snaps -->';
    return html;
  } catch {
    return null;
  }
}

// --- entry point ------------------------------------------------------------------

/**
 * Collect metadata about everything within a viewport region.
 * @param {{x: number, y: number, width: number, height: number}} rect
 *   Selection in CSS px, viewport-relative.
 * @param {{target?: Element|null}} [options]
 *   `target` — the element the user clicked in the overlay's element-pick
 *   mode. Its record leads the list (marked `target: true`, exempt from the
 *   element cap) and the DOM snippet is its own outerHTML rather than the
 *   region's common container.
 * @returns {{elements: object[], frameworks: string[], domSnippet: string|null}}
 */
export function collectRegionMetadata(rect, { target = null } = {}) {
  if (target && target.nodeType !== 1) target = null;

  const seen = new Set(target ? [target] : []);
  const elements = [];
  for (const [x, y] of samplePoints(rect)) {
    for (const el of document.elementsFromPoint(x, y).slice(0, MAX_STACK_PER_POINT)) {
      if (el === document.documentElement || el === document.body || seen.has(el)) continue;
      seen.add(el);
      elements.push(el);
    }
  }
  for (const el of semanticElements(rect)) {
    if (seen.has(el)) continue;
    seen.add(el);
    elements.push(el);
  }

  // Smallest-area first so the most specific elements survive the cap.
  const records = elements
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { el, area: Math.max(1, r.width * r.height) };
    })
    .sort((a, b) => a.area - b.area)
    .slice(0, target ? MAX_ELEMENTS - 1 : MAX_ELEMENTS)
    .map(({ el }) => elementRecord(el, rect));

  if (target) {
    const rec = elementRecord(target, rect);
    rec.target = true;
    records.unshift(rec);
  }

  const frameworks = detectFrameworks();
  for (const rec of records) {
    const fw = rec.component && rec.component.framework;
    if (fw && !frameworks.some((f) => f.startsWith(fw))) frameworks.push(fw);
  }

  return {
    elements: records,
    frameworks,
    domSnippet: buildSnippet(rect, target)
  };
}

// --- target handoff across JS worlds ---------------------------------------------

// A DOM element can't cross postMessage (the Chrome extension picks the
// element in the isolated world but collects in the MAIN world), so the
// picked element travels as a serializable descriptor and is re-resolved on
// the other side.

/** Serializable descriptor for a picked element: selector + center point + bounds. */
export function describeElementTarget(el) {
  const r = el.getBoundingClientRect();
  // Center of the on-screen part of the element, kept inside the viewport.
  const x1 = Math.max(r.left, 0);
  const y1 = Math.max(r.top, 0);
  const x2 = Math.min(r.right, window.innerWidth);
  const y2 = Math.min(r.bottom, window.innerHeight);
  return {
    selector: buildSelector(el),
    point: {
      x: Math.min((x1 + x2) / 2, window.innerWidth - 1),
      y: Math.min((y1 + y2) / 2, window.innerHeight - 1)
    },
    rect: { x: r.left, y: r.top, width: r.width, height: r.height }
  };
}

/**
 * Re-resolve a describeElementTarget() descriptor to a live element, or null.
 * Tries the selector (verified against the recorded bounds), then hit-tests
 * the recorded center point walking up until the bounds match, then falls
 * back to the bare selector match (the DOM may have shifted slightly).
 */
export function resolveElementTarget(descriptor) {
  if (!descriptor) return null;
  const wanted = descriptor.rect;
  const matches = (el) => {
    if (!wanted) return true;
    const r = el.getBoundingClientRect();
    return Math.abs(r.left - wanted.x) <= 2 && Math.abs(r.top - wanted.y) <= 2 &&
           Math.abs(r.width - wanted.width) <= 2 && Math.abs(r.height - wanted.height) <= 2;
  };

  let bySelector = null;
  try {
    bySelector = descriptor.selector ? document.querySelector(descriptor.selector) : null;
  } catch {
    // A selector that doesn't parse here (exotic characters) — fall through.
  }
  if (bySelector && matches(bySelector)) return bySelector;

  if (descriptor.point) {
    for (let el of document.elementsFromPoint(descriptor.point.x, descriptor.point.y)) {
      for (let depth = 0; el && depth < 12; depth++, el = el.parentElement) {
        if (el === document.documentElement || el === document.body) break;
        if (matches(el)) return el;
      }
    }
  }
  return bySelector;
}
