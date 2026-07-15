(() => {
  // extension/popup.js
  (async () => {
    "use strict";
    const list = document.getElementById("captures");
    const empty = document.getElementById("empty");
    const template = document.getElementById("capture-item");
    const sidecar = document.getElementById("sidecar");
    document.getElementById("capture").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "BS_START_CAPTURE_ACTIVE_TAB" });
      window.close();
    });
    const { settings = {} } = await chrome.storage.local.get("settings");
    sidecar.checked = Boolean(settings.sidecarJson);
    sidecar.addEventListener("change", () => {
      chrome.storage.local.set({ settings: { ...settings, sidecarJson: sidecar.checked } });
    });
    const { captures = [] } = await chrome.storage.local.get("captures");
    empty.hidden = captures.length > 0;
    for (const capture of captures) {
      const item = template.content.cloneNode(true);
      item.querySelector(".thumb").src = capture.thumbnail || "";
      item.querySelector(".title").textContent = capture.title || capture.url;
      item.querySelector(".title").title = capture.url;
      item.querySelector(".sub").textContent = `${new Date(capture.capturedAt).toLocaleString()} \xB7 ${shortName(capture.filename)}`;
      item.querySelector('[data-action="copy-report"]').addEventListener("click", (e) => copyWithFeedback(e.target, buildReport(capture)));
      item.querySelector('[data-action="copy-json"]').addEventListener("click", (e) => copyWithFeedback(e.target, JSON.stringify(capture.metadata, null, 2)));
      item.querySelector('[data-action="download-json"]').addEventListener("click", () => downloadJson(capture));
      list.appendChild(item);
    }
    function shortName(filename) {
      return (filename || "").split("/").pop();
    }
    async function copyWithFeedback(button, text) {
      await navigator.clipboard.writeText(text);
      const original = button.textContent;
      button.textContent = "Copied \u2713";
      setTimeout(() => {
        button.textContent = original;
      }, 1200);
    }
    function downloadJson(capture) {
      const blob = new Blob([JSON.stringify(capture.metadata, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = shortName(capture.filename).replace(/\.png$/, ".json");
      a.click();
      URL.revokeObjectURL(a.href);
    }
    function buildReport(capture) {
      const m = capture.metadata || {};
      const page = m.page || {};
      const sel = m.selection || {};
      const lines = [];
      lines.push(`## Bug report: ${capture.title || page.url || "untitled"}`);
      lines.push("");
      lines.push(`- **URL:** ${page.url || capture.url}`);
      lines.push(`- **Captured:** ${capture.capturedAt}`);
      if (page.viewport) {
        lines.push(`- **Viewport:** ${page.viewport.width}\xD7${page.viewport.height} @${page.devicePixelRatio}x, scrolled to (${page.scroll?.x ?? 0}, ${page.scroll?.y ?? 0})`);
      }
      lines.push(`- **Selected region:** ${sel.width}\xD7${sel.height} at (${sel.x}, ${sel.y}) viewport CSS px`);
      if (m.frameworks?.length) lines.push(`- **Frameworks:** ${m.frameworks.join(", ")}`);
      lines.push(`- **Screenshot:** \`${shortName(capture.filename)}\` (full metadata embedded as PNG iTXt chunk \`bowser-snaps\`)`);
      lines.push("");
      const elements = (m.elements || []).slice(0, 15);
      if (elements.length) {
        lines.push("### Elements in the captured region");
        lines.push("");
        lines.push("| Selector | Component | Text | Box in screenshot (x, y, w, h) |");
        lines.push("| --- | --- | --- | --- |");
        for (const el of elements) {
          const r = el.rectInScreenshot || {};
          lines.push(`| \`${cell(el.selector)}\` | ${el.component?.name ? `\`${cell(el.component.name)}\` (${el.component.framework})` : "\u2014"} | ${el.text ? cell(el.text.slice(0, 60)) : "\u2014"} | ${r.x}, ${r.y}, ${r.width}, ${r.height} |`);
        }
        lines.push("");
      }
      const errors = (m.consoleErrors || []).slice(-10);
      if (errors.length) {
        lines.push(`### Console errors (${errors.length} most recent)`);
        lines.push("");
        lines.push("```");
        for (const err of errors) lines.push(`[${err.at}] ${err.type}: ${err.message}`);
        lines.push("```");
        lines.push("");
      }
      if (m.domSnippet) {
        lines.push("### DOM snippet (region container)");
        lines.push("");
        lines.push("```html");
        lines.push(m.domSnippet);
        lines.push("```");
      }
      return lines.join("\n");
    }
    function cell(text) {
      return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
    }
  })();
})();
