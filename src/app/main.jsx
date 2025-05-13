import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const container = document.createElement("div");
container.id = "root";
document.body.appendChild(container);

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
