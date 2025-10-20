import React from "react";
import { createRoot } from "react-dom/client";
import InteractiveGNNVisualization from "./InteractiveGNNVisualization.jsx";
import "./style.css";

const mounts = new Map();

export function mount(selectorOrEl) {
  const el =
    typeof selectorOrEl === "string"
      ? document.querySelector(selectorOrEl)
      : selectorOrEl;
  if (!el) return null;
  if (mounts.has(el)) return mounts.get(el);
  el.innerHTML = "";
  const root = createRoot(el);
  root.render(
    <div className="gnn-app">
      <InteractiveGNNVisualization />
    </div>
  );
  const api = {
    unmount() {
      root.unmount();
      mounts.delete(el);
    },
  };
  mounts.set(el, api);
  return api;
}

// Expose a global for non-module consumers
if (typeof window !== "undefined") {
  window.GNNReact = { mount };
}

export default { mount };
