(() => {
  // sdk/selection-overlay.js
  var MAX_Z = 2147483647;
  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  var activeTeardown = null;
  function selectRegion({ hintText = "Drag to snap a region \xB7 Esc to cancel" } = {}) {
    if (activeTeardown) return Promise.resolve(null);
    return new Promise((resolve) => {
      const host = document.createElement("bowser-snaps-overlay");
      host.style.cssText = `position:fixed !important; inset:0 !important; z-index:${MAX_Z} !important;`;
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `
      <style>
        .backdrop { position: fixed; inset: 0; cursor: crosshair; }
        .hint {
          position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
          background: rgba(20, 20, 24, .88); color: #fff;
          font: 13px/1.4 -apple-system, system-ui, sans-serif;
          padding: 6px 14px; border-radius: 999px; pointer-events: none;
        }
        .box {
          position: fixed; display: none; pointer-events: none;
          border: 1px solid #58a6ff; background: rgba(88, 166, 255, .10);
          box-shadow: 0 0 0 200vmax rgba(0, 0, 0, .30);
        }
        .size {
          position: absolute; right: 0; top: 100%; margin-top: 6px;
          background: rgba(20, 20, 24, .88); color: #fff;
          font: 11px/1 ui-monospace, monospace;
          padding: 4px 6px; border-radius: 4px; white-space: nowrap;
        }
      </style>
      <div class="backdrop"></div>
      <div class="hint"></div>
      <div class="box"><div class="size"></div></div>`;
      root.querySelector(".hint").textContent = hintText;
      const backdrop = root.querySelector(".backdrop");
      const box = root.querySelector(".box");
      const sizeLabel = root.querySelector(".size");
      const hint = root.querySelector(".hint");
      let start = null;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const currentRect = (e) => {
        const x2 = clamp(e.clientX, 0, window.innerWidth);
        const y2 = clamp(e.clientY, 0, window.innerHeight);
        return {
          x: Math.min(start.x, x2),
          y: Math.min(start.y, y2),
          width: Math.abs(x2 - start.x),
          height: Math.abs(y2 - start.y)
        };
      };
      const finish = async (rect) => {
        teardown();
        await nextPaint();
        resolve(rect && rect.width >= 4 && rect.height >= 4 ? rect : null);
      };
      const onMouseDown = (e) => {
        if (e.button !== 0) {
          finish(null);
          return;
        }
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
        hint.style.display = "none";
      };
      const onMouseMove = (e) => {
        if (!start) return;
        e.preventDefault();
        const r = currentRect(e);
        box.style.display = "block";
        box.style.left = r.x + "px";
        box.style.top = r.y + "px";
        box.style.width = r.width + "px";
        box.style.height = r.height + "px";
        sizeLabel.textContent = `${Math.round(r.width)} \xD7 ${Math.round(r.height)}`;
      };
      const onMouseUp = (e) => {
        if (!start) return;
        finish(currentRect(e));
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      };
      function teardown() {
        window.removeEventListener("mousemove", onMouseMove, true);
        window.removeEventListener("mouseup", onMouseUp, true);
        window.removeEventListener("keydown", onKeyDown, true);
        host.remove();
        activeTeardown = null;
      }
      backdrop.addEventListener("mousedown", onMouseDown);
      window.addEventListener("mousemove", onMouseMove, true);
      window.addEventListener("mouseup", onMouseUp, true);
      window.addEventListener("keydown", onKeyDown, true);
      (document.body || document.documentElement).appendChild(host);
      activeTeardown = teardown;
    });
  }
  function showToast(text, { isError = false, durationMs = 4500 } = {}) {
    const host = document.createElement("bowser-snaps-toast");
    host.style.cssText = `position:fixed !important; left:50% !important; bottom:24px !important; transform:translateX(-50%) !important; z-index:${MAX_Z} !important;`;
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
    <style>
      .toast {
        background: ${isError ? "#b3261e" : "rgba(20, 20, 24, .92)"}; color: #fff;
        font: 13px/1.4 -apple-system, system-ui, sans-serif;
        padding: 10px 16px; border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, .25); max-width: 80vw;
      }
    </style>
    <div class="toast"></div>`;
    root.querySelector(".toast").textContent = text;
    (document.body || document.documentElement).appendChild(host);
    setTimeout(() => host.remove(), durationMs);
  }

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

  // sdk/page-context.js
  function buildPageContext() {
    return {
      url: location.href,
      path: location.pathname,
      query: location.search || null,
      hash: location.hash || null,
      title: document.title,
      referrer: document.referrer || null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      documentSize: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight
      },
      userAgent: navigator.userAgent,
      language: navigator.language
    };
  }

  // extension/content.js
  (() => {
    "use strict";
    if (window.__bowserSnapsContent) return;
    window.__bowserSnapsContent = true;
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg) return;
      if (msg.type === "BS_START_CAPTURE") {
        run().catch(() => showToast("Capture failed while collecting metadata", { isError: true }));
      } else if (msg.type === "BS_CAPTURE_DONE") {
        showToast(`Saved ${msg.filename} \u2014 metadata embedded in the PNG`);
      } else if (msg.type === "BS_CAPTURE_FAILED") {
        showToast(`Capture failed: ${msg.error}`, { isError: true });
      }
    });
    async function run() {
      const rect = await selectRegion();
      if (!rect) return;
      const collected = await collectViaPageAgent(rect);
      const selection = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      chrome.runtime.sendMessage({
        type: "BS_REGION_SELECTED",
        rect: selection,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        metadata: {
          page: buildPageContext(),
          selection: {
            ...selection,
            unit: "css-px, viewport-relative",
            pagePosition: {
              x: selection.x + Math.round(window.scrollX),
              y: selection.y + Math.round(window.scrollY)
            }
          },
          frameworks: collected.frameworks || [],
          elements: collected.elements || [],
          domSnippet: collected.domSnippet || null,
          consoleErrors: collected.consoleErrors || []
        }
      });
    }
    function collectViaPageAgent(rect) {
      return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        const fallback = () => {
          try {
            resolve(collectRegionMetadata(rect));
          } catch {
            resolve({});
          }
        };
        const timer = setTimeout(() => {
          window.removeEventListener("message", onMessage);
          fallback();
        }, 500);
        function onMessage(event) {
          const d = event.data;
          if (event.source !== window || !d || d.__bowserSnaps !== "response" || d.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener("message", onMessage);
          if (d.result && !d.result.error) resolve(d.result);
          else fallback();
        }
        window.addEventListener("message", onMessage);
        window.postMessage({ __bowserSnaps: "request", id, action: "collect", rect }, "*");
      });
    }
  })();
})();
