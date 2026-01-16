import { mountCompositionPanel } from "./ui/compositionPanel.js";

function waitForApp() {
  return new Promise((resolve) => {
    const tick = () => {
      if (window.__APP__ && typeof window.__APP__.getRowsForClawMode === "function") {
        resolve(window.__APP__);
        return;
      }
      setTimeout(tick, 30);
    };
    tick();
  });
}

(async function init() {
  const app = await waitForApp();

  const mountEl = document.getElementById("composition");
  if (!mountEl) {
    console.warn("[WARN] #composition not found");
    return;
  }

  mountCompositionPanel({
    mountEl,
    getRows: () => app.getRowsForClawMode(),
    subscribe: (fn) => app.subscribe(fn)
  });
})();
