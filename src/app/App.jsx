import React from "react";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import { StatusProvider } from "../context/statusContext.jsx";

import "./App.css";
import Layout from "./Layout.jsx";

import Home from "../screens/home/index.jsx";

export default function App() {
  return (
    <StatusProvider>
      <Router>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>
      </Router>
    </StatusProvider>
  );
}
