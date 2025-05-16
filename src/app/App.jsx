import React, { useEffect } from "react";
import { HashRouter as Router, Routes, Route } from "react-router-dom";

import "./App.css";
import Layout from "./Layout.jsx";
import { StatusProvider } from "../context/statusContext.jsx";
import MainStatusListener from "../components/mainStatusListener.jsx";

import SelectFolder from "../screens/selectFolder/index.jsx";
import Import from "../screens/import/index.jsx";

export default function App() {
  useEffect(() => {
    const handleUnload = () => {
      localStorage.removeItem("redirectCount");
    };

    window.addEventListener("beforeunload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  return (
    <StatusProvider>
      <MainStatusListener />
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<SelectFolder />} />
            <Route path="/import" element={<Import />} />
          </Route>
        </Routes>
      </Router>
    </StatusProvider>
  );
}
