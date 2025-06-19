import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import WarningMessage from "./warningMessage.jsx";

import { FaFolderOpen, FaFileImport } from "react-icons/fa";
import { BsCollectionFill } from "react-icons/bs";
import logo from "../assets/logo2.png";
import "./styles/navbar.css";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [warningVisible, setWarningVisible] = useState(false);
  const [warningMessage, setWarningMessage] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [showExitButton, setShowExitButton] = useState(false);
  const [folderPath, setFolderPath] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState(false);

  useEffect(() => {
    const handleStorageChange = () => {
      const savedFolderPath = localStorage.getItem("folderPath");
      const savedCollection = localStorage.getItem("selectedCollection");
      setFolderPath(savedFolderPath);
      setSelectedCollection(savedCollection);
    };

    handleStorageChange();

    // Listen for storage changes
    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [location]);

  const isOnImportScreen = location.pathname.startsWith("/import");
  const handleNavigation = (e, path, condition, message) => {
    if (location.pathname === path) {
      e.preventDefault();
      return;
    }

    if (isOnImportScreen && path !== "/import") {
      e.preventDefault();
      setWarningMessage(
        "Al salir los datos de la tabla se perderán y tendrá que llenarlos denuevo"
      );
      setTargetPath(path);
      setShowExitButton(true);
      setWarningVisible(true);
      return;
    }

    if (!condition) {
      e.preventDefault();
      setWarningMessage(message);
      setTargetPath(path);
      setShowExitButton(false);
      setWarningVisible(true);
    } else {
      navigate(path);
    }
  };

  const handleConfirmNavigation = () => {
    localStorage.removeItem("selectedCollection");
    setSelectedCollection(false);
    setWarningVisible(false);
    navigate(targetPath);
  };

  const handleCancelNavigation = () => {
    setWarningVisible(false);
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbarBrand">
          <img src={logo} alt="Logo" className="navbarLogo" />
          <span className="navbarAppName">ALU Import</span>
        </div>

        <ul className="navbarNav">
          <li className="navbarItem">
            {isOnImportScreen ? (
              <span className="navbarLink navbarLinkDisabled">
                <FaFolderOpen className="navbarIcon" />
                <span>Seleccionar carpeta</span>
              </span>
            ) : (
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `navbarLink ${isActive ? "navbarLinkActive" : ""}`
                }
                onClick={(e) => handleNavigation(e, "/", true, "")}
              >
                <FaFolderOpen className="navbarIcon" />
                <span>Seleccionar carpeta</span>
              </NavLink>
            )}
          </li>

          <li className="navbarItem">
            <NavLink
              to="/selectCollection"
              className={({ isActive }) =>
                `navbarLink ${isActive ? "navbarLinkActive" : ""} ${
                  !folderPath ? "navbarLinkDisabled" : ""
                }`
              }
              onClick={(e) =>
                handleNavigation(
                  e,
                  "/selectCollection",
                  folderPath,
                  "Por favor seleccione una carpeta primero"
                )
              }
            >
              <BsCollectionFill className="navbarIcon" />
              <span>Seleccionar colección</span>
            </NavLink>
          </li>

          <li className="navbarItem">
            <NavLink
              to="/import"
              className={({ isActive }) =>
                `navbarLink ${isActive ? "navbarLinkActive" : ""} ${
                  !selectedCollection ? "navbarLinkDisabled" : ""
                }`
              }
              onClick={(e) =>
                handleNavigation(
                  e,
                  "/import",
                  selectedCollection,
                  "Por favor seleccione una colección primero"
                )
              }
            >
              <FaFileImport className="navbarIcon" />
              <span>Importar</span>
            </NavLink>
          </li>
        </ul>
      </nav>

      <WarningMessage
        visible={warningVisible}
        onHide={handleCancelNavigation}
        onConfirm={handleConfirmNavigation}
        message={warningMessage}
        showExitButton={showExitButton}
      />
    </>
  );
}
