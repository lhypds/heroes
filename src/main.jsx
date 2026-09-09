import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "ress";
import "@fontsource/fira-code/400.css";
import "./global.css";
import "./i18n/index.js";
import App from "./App.jsx";

// The anchors on this page are for following, not for coming back to: an
// address opened or refreshed at #join is put back to the page's own address
// and the reading starts where the page starts. Done before anything is
// drawn, so the browser has no anchor left to scroll to and no place of its
// own to put the page back to. The anchors still work when they are followed.
if (window.location.hash) {
  history.scrollRestoration = "manual";
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
