import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "ress";
import "@fontsource/fira-code/400.css";
import "./global.css";
import "./i18n/index.js";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
