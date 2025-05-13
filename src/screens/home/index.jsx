import React, { useState, useEffect, useContext } from "react";
import { StatusContext } from "../../context/statusContext.jsx";

import { FaFolderOpen, FaCheckCircle, FaSpinner } from "react-icons/fa";
import "./style.css";

export default function Home() {
  useEffect(() => {
    const loadSavedPath = async () => {
      const savedPath = await window.electronAPI.getFolderPath();
      if (savedPath) setFolderPath(savedPath);
    };
    loadSavedPath();
  }, []);

  const [folderPath, setFolderPath] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSelectFolder = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.openFolderDialog();

      if (!result.canceled && result.filePaths.length > 0) {
        setFolderPath(result.filePaths[0]);
      }
    } catch (error) {
      console.error("Error opening folder dialog:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const { showStatusMessage } = useContext(StatusContext);
  const handleSave = async () => {
    if (folderPath) {
      setIsSaving(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await window.electronAPI.saveFolderPath(folderPath);
        showStatusMessage("success", "Carpeta guardada correctamente");
      } catch (error) {
        showStatusMessage("error", "Error al guardar la carpeta");
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="homeContainer">
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
