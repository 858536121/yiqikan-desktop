import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Remove the inline loading screen once React has painted
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.getElementById("app-loading")?.remove();
  });
});
