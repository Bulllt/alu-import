import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { FaFolderOpen, FaCheckCircle, FaSpinner } from "react-icons/fa";
import "./style.css";

export default function SelectFolder() {
  const navigate = useNavigate();
  const [folderPath, setFolderPath] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();

    const loadSavedPath = async () => {
      try {
        const savedPath = await window.electronAPI.getFolderPath();
        const redirectCount = Number(
          localStorage.getItem("redirectCount") || "0"
        );

        if (!isMounted) return;

        if (savedPath) {
          setFolderPath(savedPath);
          if (redirectCount === 0) {
            localStorage.setItem("redirectCount", "1");
            navigate("/import");
          }
        } else {
          localStorage.setItem("redirectCount", "1");
        }
      } catch (error) {
        if (isMounted) console.error("Error loading saved path:", error);
      }
    };
    loadSavedPath();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, []);

  const handleSelectFolder = async () => {
    setIsLoading(true);

    const result = await window.electronAPI.openFolderDialog();

    if (!result.canceled && result.filePaths.length > 0) {
      setFolderPath(result.filePaths[0]);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (folderPath) {
      setIsSaving(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const response = await window.electronAPI.saveFolderPath(folderPath);

      if (response === true) {
        setIsSaving(false);
        navigate("/import");
      }
    }
  };

  return (
    <div className="container">
      <div className="header">
        <FaFolderOpen className="headerIcon" size={48} />
        <h1>Seleccionar carpeta</h1>
        <p className="headerDescription">
          Seleccionar la carpeta que contiene los archivos que deseas importar
          al sistema
        </p>
      </div>

      <div className="folderSelection">
        <button
          onClick={handleSelectFolder}
          disabled={isLoading}
          className="folderSelectionButton"
        >
          {isLoading ? "Buscando..." : "Seleccionar Carpeta"}
        </button>

        {folderPath && (
          <div className="folderInfo">
            <FaCheckCircle className="folderInfoIcon" />
            <p className="folderInfoPath">
              Carpeta seleccionada: <span>{folderPath}</span>
            </p>
          </div>
        )}
      </div>

      <div className="actions">
        <button
          onClick={handleSave}
          disabled={!folderPath || isSaving}
          className="actionsSave"
        >
          {isSaving ? <FaSpinner className="actionsIcon" /> : "Guardar"}
        </button>
      </div>
    </div>
  );
}
