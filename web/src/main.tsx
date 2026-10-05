import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, readThemePreference } from "./theme";
import "./design-tokens.css";
import "./styles.css";
import "./dashboard.css";
import "./palette.css";
// Resolve the stored or system theme before the first render.
applyTheme(readThemePreference());
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
