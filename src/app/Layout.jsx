import React, { useEffect } from "react";
import Navbar from "../components/navbar.jsx";
import { Outlet, useLocation } from "react-router-dom";

export default function Layout() {
  const location = useLocation();

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (location.pathname.startsWith("/import")) {
        e.preventDefault();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [location]);

  return (
    <>
      <Navbar />

      <main>
        <Outlet />
      </main>
    </>
  );
}
