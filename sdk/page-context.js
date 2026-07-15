// Environment snapshot for bug reports: where we are and what the viewport
// looks like. Pure DOM, no extension APIs.

export function buildPageContext() {
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
