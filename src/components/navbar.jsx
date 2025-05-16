import React from "react";
import { NavLink } from "react-router-dom";
import { FaFolderOpen, FaFileImport } from "react-icons/fa";
import logo from "../assets/logo2.png";
import "./styles/navbar.css";

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbarBrand">
        <img src={logo} alt="Logo" className="navbarLogo" />
        <span className="navbarAppName">ALU Import</span>
      </div>

      <ul className="navbarNav">
        <li className="navbarItem">
          <NavLink
            to="/"
            className={({ isActive }) =>
              `navbarLink ${isActive ? "navbarLinkActive" : ""}`
            }
          >
            <FaFolderOpen className="navbarIcon" />
            <span>Seleccionar carpeta</span>
          </NavLink>
        </li>

        <li className="navbarItem">
          <NavLink
            to="/Import"
            className={({ isActive }) =>
              `navbarLink ${isActive ? "navbarLinkActive" : ""}`
            }
          >
            <FaFileImport className="navbarIcon" />
            <span>Importar</span>
          </NavLink>
        </li>
      </ul>
    </nav>
  );
}
