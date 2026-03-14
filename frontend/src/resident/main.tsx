import React from "react";
import ReactDOM from "react-dom/client";
import ResidentApp from "./ResidentApp";
import "../styles.css";
import "./resident.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ResidentApp />
  </React.StrictMode>
);
