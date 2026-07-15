(() => {
  // sdk/collect.js
  var MAX_ELEMENTS = 40;
  var MAX_STACK_PER_POINT = 6;
  var MAX_TEXT = 140;
  var MAX_ATTR_VALUE = 160;
  var MAX_ATTRS = 15;
  var MAX_SNIPPET = 4e3;
  var INTERESTING_ATTRS = [
    "role",
    "name",
    "type",
    "href",
    "src",
    "alt",
    "title",
    "placeholder",
    "for",
    "value",
    "disabled",
    "contenteditable"
  ];
  var GENERATED_CLASS = /^(css|sc|jss|chakra|emotion)-|__[A-Za-z0-9_-]{5,}$|[0-9a-f]{8,}/i;
  function truncate(value, max) {
    const s = String(value);
    return s.length > max ? s.slice(0, max) + "\u2026" : s;
  }
  function round(n) {
    return Math.round(n * 10) / 10;
  }
  function buildSelector(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
      if (node.id) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      let part = node.localName;
      const stableClasses = [...node.classList].filter((c) => !GENERATED_CLASS.test(c)).slice(0, 2);
      if (stableClasses.length) part += "." + stableClasses.map((c) => CSS.escape(c)).join(".");
      const parent = node.parentElement;
      if (parent) {
        const sameTag = [...parent.children].filter((s) => s.localName === node.localName);
        if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }
  function componentInfo(el) {
    try {
      for (const key of Object.keys(el)) {
        if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
          const chain = [];
          let fiber = el[key];
          while (fiber && chain.length < 3) {
            const t = fiber.type;
            const name = typeof t === "function" ? t.displayName || t.name : t && typeof t === "object" ? t.displayName || t.render && t.render.name : null;
            if (name && !chain.includes(name)) chain.push(name);
            fiber = fiber.return;
          }
          if (chain.length) return { framework: "react", name: chain[0], ownerChain: chain };
        }
      }
      const v3 = el.__vueParentComponent;
      if (v3) {
        const name = v3.type && (v3.type.name || v3.type.__name) || null;
        return { framework: "vue", name };
      }
      const v2 = el.__vue__;
      if (v2 && v2.$options) {
        return { framework: "vue", name: v2.$options.name || v2.$options._componentTag || null };
      }
      if (window.ng && typeof window.ng.getComponent === "function") {
        const cmp = window.ng.getComponent(el);
        if (cmp) return { framework: "angular", name: cmp.constructor && cmp.constructor.name };
      }
    } catch {
    }
    return null;
  }
  function detectFrameworks() {
    const found = [];
    try {
      const w = window;
      const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook && hook.renderers && hook.renderers.size > 0 || document.querySelector("[data-reactroot], [data-reactid]")) found.push("react");
      if (w.__NEXT_DATA__) found.push("next.js");
      if (w.__NUXT__) found.push("nuxt");
      if (w.__VUE__ || w.Vue || document.querySelector("[data-v-app]")) found.push("vue");
      const ng = document.querySelector("[ng-version]");
      if (ng) found.push("angular@" + ng.getAttribute("ng-version"));
      if (document.querySelector('[class*="svelte-"]')) found.push("svelte");
      if (w.jQuery && w.jQuery.fn && w.jQuery.fn.jquery) found.push("jquery@" + w.jQuery.fn.jquery);
      if (w.Ember) found.push("ember");
    } catch {
    }
    return found;
  }
  var SEMANTIC_SELECTOR = "a, button, input, select, textarea, label, img, svg, video, h1, h2, h3, h4, h5, h6, [role], [data-testid], [aria-label]";
  var MAX_SEMANTIC = 30;
  var MAX_SEMANTIC_SCAN = 3e3;
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
    let text = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    if (!text) {
      const full = (el.textContent || "").replace(/\s+/g, " ").trim();
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
      coverage: r.left >= sel.x - 1 && r.top >= sel.y - 1 && r.right <= sel.x + sel.width + 1 && r.bottom <= sel.y + sel.height + 1 ? "fully-visible" : "partially-visible"
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
      if (attr.name.startsWith("data-") || attr.name.startsWith("aria-")) {
        attrs[attr.name] = truncate(attr.value, MAX_ATTR_VALUE);
        attrCount++;
      }
    }
    if (attrCount) record.attributes = attrs;
    return record;
  }
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
  function buildSnippet(rect) {
    try {
      const inset = 2;
      const topLeft = topmostAt(rect.x + inset, rect.y + inset);
      const bottomRight = topmostAt(rect.x + rect.width - inset, rect.y + rect.height - inset);
      const container = commonAncestor(topLeft, bottomRight) || document.body;
      if (!container) return null;
      const clone = container.cloneNode(true);
      if (clone.querySelectorAll) {
        clone.querySelectorAll("script, style, noscript, template").forEach((n) => n.remove());
        for (const el of clone.querySelectorAll("*")) {
          for (const attr of [...el.attributes]) {
            if (attr.value.length > 200) el.setAttribute(attr.name, attr.value.slice(0, 80) + "\u2026");
          }
        }
      }
      let html = clone.outerHTML || "";
      if (html.length > MAX_SNIPPET) html = html.slice(0, MAX_SNIPPET) + "\n<!-- truncated by bowser-snaps -->";
      return html;
    } catch {
      return null;
    }
  }
  function collectRegionMetadata(rect) {
    const seen = /* @__PURE__ */ new Set();
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
    const records = elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, area: Math.max(1, r.width * r.height) };
    }).sort((a, b) => a.area - b.area).slice(0, MAX_ELEMENTS).map(({ el }) => elementRecord(el, rect));
    const frameworks = detectFrameworks();
    for (const rec of records) {
      const fw = rec.component && rec.component.framework;
      if (fw && !frameworks.some((f) => f.startsWith(fw))) frameworks.push(fw);
    }
    return {
      elements: records,
      frameworks,
      domSnippet: buildSnippet(rect)
    };
  }

  // sdk/error-monitor.js
  function formatArg(arg) {
    try {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}
${(arg.stack || "").slice(0, 1200)}`;
      }
      if (typeof arg === "object" && arg !== null) {
        const json = JSON.stringify(arg);
        return json ? json.slice(0, 400) : String(arg);
      }
      return String(arg).slice(0, 400);
    } catch {
      return "[unserializable]";
    }
  }
  function createErrorMonitor({ maxEntries = 30 } = {}) {
    const entries = [];
    function push(entry) {
      entries.push(entry);
      if (entries.length > maxEntries) entries.shift();
    }
    const onError = (e) => {
      push({
        type: "uncaught-exception",
        message: e.message,
        source: e.filename || null,
        line: e.lineno || null,
        column: e.colno || null,
        stack: e.error && e.error.stack && e.error.stack.slice(0, 1500) || null,
        at: (/* @__PURE__ */ new Date()).toISOString()
      });
    };
    const onRejection = (e) => {
      push({
        type: "unhandled-rejection",
        message: formatArg(e.reason),
        at: (/* @__PURE__ */ new Date()).toISOString()
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const originals = {};
    for (const level of ["error", "warn"]) {
      originals[level] = console[level].bind(console);
      console[level] = (...args) => {
        push({
          type: `console.${level}`,
          message: args.map(formatArg).join(" ").slice(0, 1e3),
          at: (/* @__PURE__ */ new Date()).toISOString()
        });
        originals[level](...args);
      };
    }
    return {
      snapshot: () => entries.slice(),
      dispose() {
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        for (const level of Object.keys(originals)) console[level] = originals[level];
      }
    };
  }

  // extension/page-agent.js
  (() => {
    "use strict";
    if (window.__bowserSnapsAgent) return;
    window.__bowserSnapsAgent = true;
    const errorMonitor = createErrorMonitor();
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (event.source !== window || !data || data.__bowserSnaps !== "request") return;
      if (data.action !== "collect") return;
      let result;
      try {
        result = collectRegionMetadata(data.rect);
        result.consoleErrors = errorMonitor.snapshot();
      } catch (err) {
        result = { error: String(err) };
      }
      window.postMessage({ __bowserSnaps: "response", id: data.id, result }, "*");
    });
  })();
})();
