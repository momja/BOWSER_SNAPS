(() => {
  // sdk/selection-overlay.js
  var MAX_Z = 2147483647;
  var DRAG_THRESHOLD = 4;
  function nextPaint() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  var activeTeardown = null;
  var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function elementAt(x, y, host) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === host || el === document.documentElement || el === document.body) continue;
      return el;
    }
    return null;
  }
  function viewportRect(el) {
    const r = el.getBoundingClientRect();
    const x = clamp(r.left, 0, window.innerWidth);
    const y = clamp(r.top, 0, window.innerHeight);
    return {
      x,
      y,
      width: clamp(r.right, 0, window.innerWidth) - x,
      height: clamp(r.bottom, 0, window.innerHeight) - y
    };
  }
  function describeElement(el, rect) {
    let name = el.localName;
    if (el.id) name += "#" + el.id;
    else {
      const classes = [...el.classList].slice(0, 2);
      if (classes.length) name += "." + classes.join(".");
    }
    return `${name} \xB7 ${Math.round(rect.width)} \xD7 ${Math.round(rect.height)}`;
  }
  function selectRegion({ hintText = "Click an element or drag a region \xB7 \u2191 \u2193 parent/child \xB7 Esc to cancel" } = {}) {
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
        .pick {
          position: fixed; display: none; pointer-events: none;
          border: 1px solid #58a6ff; background: rgba(88, 166, 255, .18);
        }
        .pick-label {
          position: absolute; left: 0; top: 100%; margin-top: 6px;
          background: rgba(20, 20, 24, .88); color: #fff;
          font: 11px/1 ui-monospace, monospace;
          padding: 4px 6px; border-radius: 4px; white-space: nowrap;
        }
        .pick-label.above { top: auto; bottom: 100%; margin: 0 0 6px; }
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
      <div class="pick"><div class="pick-label"></div></div>
      <div class="box"><div class="size"></div></div>`;
      root.querySelector(".hint").textContent = hintText;
      const backdrop = root.querySelector(".backdrop");
      const pick = root.querySelector(".pick");
      const pickLabel = root.querySelector(".pick-label");
      const box = root.querySelector(".box");
      const sizeLabel = root.querySelector(".size");
      const hint = root.querySelector(".hint");
      let start = null;
      let dragging = false;
      let hoverEl = null;
      let current = null;
      let descentStack = [];
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
      const finish = async (result) => {
        teardown();
        await nextPaint();
        resolve(result);
      };
      const finishRegion = (rect) => {
        finish(rect && rect.width >= DRAG_THRESHOLD && rect.height >= DRAG_THRESHOLD ? { ...rect, mode: "region" } : null);
      };
      const finishElement = (el) => {
        if (!el) return;
        const rect = viewportRect(el);
        if (rect.width < 1 || rect.height < 1) return;
        finish({ ...rect, mode: "element", element: el });
      };
      const highlight = (el) => {
        current = el;
        if (!el) {
          pick.style.display = "none";
          return;
        }
        const r = viewportRect(el);
        pick.style.display = "block";
        pick.style.left = r.x + "px";
        pick.style.top = r.y + "px";
        pick.style.width = r.width + "px";
        pick.style.height = r.height + "px";
        pickLabel.textContent = describeElement(el, r);
        pickLabel.classList.toggle("above", r.y + r.height > window.innerHeight - 32);
      };
      const onMouseDown = (e) => {
        if (e.button !== 0) {
          finish(null);
          return;
        }
        e.preventDefault();
        start = { x: e.clientX, y: e.clientY };
        dragging = false;
        hint.style.display = "none";
      };
      const onMouseMove = (e) => {
        if (start) {
          e.preventDefault();
          if (!dragging) {
            if (Math.abs(e.clientX - start.x) < DRAG_THRESHOLD && Math.abs(e.clientY - start.y) < DRAG_THRESHOLD) return;
            dragging = true;
            pick.style.display = "none";
          }
          const r = currentRect(e);
          box.style.display = "block";
          box.style.left = r.x + "px";
          box.style.top = r.y + "px";
          box.style.width = r.width + "px";
          box.style.height = r.height + "px";
          sizeLabel.textContent = `${Math.round(r.width)} \xD7 ${Math.round(r.height)}`;
          return;
        }
        const el = elementAt(e.clientX, e.clientY, host);
        if (el !== hoverEl) {
          hoverEl = el;
          descentStack = [];
          highlight(el);
        }
      };
      const onMouseUp = (e) => {
        if (!start) return;
        if (dragging) {
          finishRegion(currentRect(e));
        } else {
          finishElement(current);
          start = null;
        }
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
          return;
        }
        if (start) return;
        if (e.key === "ArrowUp" && current) {
          e.preventDefault();
          const parent = current.parentElement;
          if (parent && parent !== document.body && parent !== document.documentElement) {
            descentStack.push(current);
            highlight(parent);
          }
        } else if (e.key === "ArrowDown" && descentStack.length) {
          e.preventDefault();
          highlight(descentStack.pop());
        } else if (e.key === "Enter") {
          e.preventDefault();
          finishElement(current);
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
  function collectRegionMetadata(rect, { target = null } = {}) {
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
    const records = elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { el, area: Math.max(1, r.width * r.height) };
    }).sort((a, b) => a.area - b.area).slice(0, target ? MAX_ELEMENTS - 1 : MAX_ELEMENTS).map(({ el }) => elementRecord(el, rect));
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
  function describeElementTarget(el) {
    const r = el.getBoundingClientRect();
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

  // sdk/report-dialog.js
  var MAX_Z2 = 2147483647;
  var MAX_DESCRIPTION = 5e3;
  function promptBugReport({
    thumbnailUrl = null,
    placeholder = "What's wrong here? Steps, expected vs. actual\u2026 (markdown welcome)"
  } = {}) {
    return new Promise((resolve) => {
      const host = document.createElement("bowser-snaps-report");
      host.style.cssText = `position:fixed !important; inset:0 !important; z-index:${MAX_Z2} !important;`;
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, .35); }
        .card {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: min(520px, calc(100vw - 48px));
          background: #1d1f24; color: #e8eaf0;
          font: 13px/1.45 -apple-system, system-ui, sans-serif;
          border-radius: 12px; box-shadow: 0 12px 40px rgba(0, 0, 0, .45);
          padding: 16px; display: flex; flex-direction: column; gap: 10px;
        }
        .head { display: flex; align-items: center; justify-content: space-between; }
        .title { font-size: 14px; font-weight: 600; }
        .close {
          border: 0; background: transparent; color: #9aa0ab; cursor: pointer;
          font: 16px/1 sans-serif; padding: 2px 6px; border-radius: 6px;
        }
        .close:hover { background: rgba(255, 255, 255, .08); color: #fff; }
        .thumb {
          max-width: 100%; max-height: 140px; object-fit: contain;
          border-radius: 8px; border: 1px solid rgba(255, 255, 255, .12);
          align-self: flex-start;
        }
        textarea {
          width: 100%; min-height: 96px; resize: vertical;
          background: #14151a; color: inherit; font: inherit;
          border: 1px solid rgba(255, 255, 255, .15); border-radius: 8px;
          padding: 10px 12px; outline: none;
        }
        textarea:focus { border-color: #58a6ff; }
        .hint { color: #9aa0ab; font-size: 11.5px; }
        kbd {
          font: 10.5px/1 ui-monospace, monospace; padding: 1px 4px;
          border-radius: 4px; background: rgba(255, 255, 255, .10);
        }
        .actions { display: flex; justify-content: flex-end; gap: 8px; }
        button.action {
          font: inherit; cursor: pointer; border-radius: 8px; padding: 6px 14px;
          border: 1px solid rgba(255, 255, 255, .18); background: transparent; color: inherit;
        }
        button.action:hover { background: rgba(255, 255, 255, .07); }
        button.save { background: #2563eb; border-color: #2563eb; color: #fff; }
        button.save:hover { background: #1d4ed8; }
      </style>
      <div class="backdrop"></div>
      <div class="card" role="dialog" aria-label="Report this bug">
        <div class="head">
          <span class="title">Report this bug</span>
          <button class="close" title="Discard capture (Esc)">\u2715</button>
        </div>
        ${thumbnailUrl ? '<img class="thumb" alt="capture preview">' : ""}
        <textarea maxlength="${MAX_DESCRIPTION}"></textarea>
        <div class="hint">
          Included verbatim in the snap's JSON metadata \u2014 markdown welcome.
          <kbd>\u2318/Ctrl+Enter</kbd> save \xB7 <kbd>Esc</kbd> discard
        </div>
        <div class="actions">
          <button class="action skip">Skip note</button>
          <button class="action save">Save snap</button>
        </div>
      </div>`;
      const textarea = root.querySelector("textarea");
      textarea.placeholder = placeholder;
      if (thumbnailUrl) root.querySelector(".thumb").src = thumbnailUrl;
      const finish = (result) => {
        window.removeEventListener("keydown", onKeyDown, true);
        host.remove();
        resolve(result);
      };
      const save = () => {
        const description = textarea.value.trim().slice(0, MAX_DESCRIPTION);
        finish(description ? { action: "save", description } : { action: "skip" });
      };
      const onKeyDown = (e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          finish({ action: "discard" });
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save();
        }
      };
      root.querySelector(".save").addEventListener("click", save);
      root.querySelector(".skip").addEventListener("click", () => finish({ action: "skip" }));
      root.querySelector(".close").addEventListener("click", () => finish({ action: "discard" }));
      window.addEventListener("keydown", onKeyDown, true);
      (document.body || document.documentElement).appendChild(host);
      textarea.focus();
    });
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
      } else if (msg.type === "BS_REQUEST_REPORT") {
        handleReportRequest(msg).catch(() => {
          chrome.runtime.sendMessage({ type: "BS_REPORT_SUBMITTED", captureId: msg.captureId, report: { description: null } });
        });
      } else if (msg.type === "BS_CAPTURE_DONE") {
        showToast(`Saved ${msg.filename} \u2014 metadata embedded in the PNG`);
      } else if (msg.type === "BS_CAPTURE_FAILED") {
        showToast(`Capture failed: ${msg.error}`, { isError: true });
      }
    });
    async function run() {
      const rect = await selectRegion();
      if (!rect) return;
      const target = rect.mode === "element" && rect.element ? describeElementTarget(rect.element) : null;
      const plainRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      const collected = await collectViaPageAgent(plainRect, target, rect.element || null);
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
            mode: rect.mode || "region",
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
    async function handleReportRequest(msg) {
      const outcome = await promptBugReport({ thumbnailUrl: msg.thumbnail || null });
      if (outcome.action === "discard") {
        chrome.runtime.sendMessage({ type: "BS_REPORT_SUBMITTED", captureId: msg.captureId, discard: true });
        showToast("Snap discarded");
        return;
      }
      chrome.runtime.sendMessage({
        type: "BS_REPORT_SUBMITTED",
        captureId: msg.captureId,
        report: { description: outcome.action === "save" ? outcome.description : null }
      });
    }
    function collectViaPageAgent(rect, target, targetElement) {
      return new Promise((resolve) => {
        const id = Math.random().toString(36).slice(2);
        const fallback = () => {
          try {
            resolve(collectRegionMetadata(rect, { target: targetElement }));
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
        window.postMessage({ __bowserSnaps: "request", id, action: "collect", rect, target }, "*");
      });
    }
  })();
})();
