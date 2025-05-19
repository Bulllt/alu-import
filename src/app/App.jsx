import React, { useEffect } from "react";
import { HashRouter as Router, Routes, Route } from "react-router-dom";
import { PrimeReactProvider } from "primereact/api";
import { addLocale } from "primereact/api";

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

  addLocale("es", {
    firstDayOfWeek: 1,
    dayNames: [
      "domingo",
      "lunes",
      "martes",
      "miércoles",
      "jueves",
      "viernes",
      "sábado",
    ],
    dayNamesShort: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"],
    dayNamesMin: ["D", "L", "M", "X", "J", "V", "S"],
    monthNames: [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre",
    ],
    monthNamesShort: [
      "Ene",
      "Feb",
      "Mar",
      "Abr",
      "May",
      "Jun",
      "Jul",
      "Ago",
      "Sep",
      "Oct",
      "Nov",
      "Dic",
    ],
    today: "Hoy",
    clear: "Limpiar",
    chooseDate: "Seleccionar fecha",
  });

  return (
    <StatusProvider>
      <PrimeReactProvider value={{ locale: "es" }}>
        <MainStatusListener />
        <Router>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<SelectFolder />} />
              <Route path="/import" element={<Import />} />
            </Route>
          </Routes>
        </Router>
      </PrimeReactProvider>
    </StatusProvider>
  );
}
