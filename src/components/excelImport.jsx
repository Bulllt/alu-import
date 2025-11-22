import React, { useState, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { FaTimes, FaFileExcel } from "react-icons/fa";
import "./styles/excelImport.css";
import "primeicons/primeicons.css";

export default function ExcelImport({
  visible,
  onHide,
  inventoryCodes,
  onDataProcessed,
}) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  if (!visible) return null;

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleFileSelection = (file) => {
    const validExtensions = [".xlsx", ".xls", ".xlsm"];
    const fileExtension = "." + file.name.split(".").pop().toLowerCase();

    if (!validExtensions.includes(fileExtension)) {
      return;
    }

    setSelectedFile(file);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      const file = files[0];

      const validExtensions = [".xlsx", ".xls", ".xlsm"];
      const fileExtension = "." + file.name.split(".").pop().toLowerCase();

      if (!validExtensions.includes(fileExtension)) {
        return;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Array.from(new Uint8Array(arrayBuffer));

        setSelectedFile({
          name: file.name,
          path: file.name,
          buffer: fileBuffer,
        });
      } catch (error) {
        console.error("Drag & drop error:", error);
      }
    }
  };

  const handleFileInput = (e) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleFileSelection(files[0]);
    }
  };

  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI.openFileDialog();
      if (!result.canceled && result.filePaths.length > 0) {
        const file = {
          name: result.filePaths[0].split("/").pop(),
          path: result.filePaths[0],
        };
        handleFileSelection(file);
      }
    } catch (error) {
      console.log("error selecting file");
    }
  };

  const handleProcessData = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    try {
      let result;

      if (selectedFile.buffer) {
        result = await window.electronAPI.processExcelFileBuffer(
          selectedFile.buffer,
          inventoryCodes
        );
      } else {
        const fileBuffer = await window.electronAPI.readFileAsBuffer(
          selectedFile.path
        );
        result = await window.electronAPI.processExcelFileBuffer(
          fileBuffer,
          inventoryCodes
        );
      }

      if (result.success) {
        onDataProcessed(result);
        onHide();
      }
    } catch (error) {
      console.log("error processing file", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const footer = (
    <div className="dialogFooter">
      <Button
        label="Atrás"
        icon="pi pi-arrow-left"
        className="cancelButton"
        onClick={onHide}
      />
    </div>
  );

  return (
    <Dialog visible={visible} onHide={onHide} dismissableMask footer={footer}>
      <div className="excelImportDialog">
        <div className="dialogHeader">
          <h2>Importar datos desde Excel</h2>
        </div>

        <div className="dialogContent">
          <div className="instructions">
            <p>
              Selecciona un archivo Excel que contenga una columna "Inventario"
              y los datos que deseas importar.
            </p>
          </div>

          {!selectedFile ? (
            <div
              className={`fileDropZone ${dragActive ? "dragActive" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={handleSelectFile}
            >
              <div className="dropZoneContent">
                <FaFileExcel className="fileIcon" />
                <h3>Arrastra tu archivo Excel aquí</h3>
                <p>o haz clic para seleccionar</p>
                <span className="fileTypes">
                  Formatos soportados: .xlsx, .xls, .xlsm
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.xlsm"
                onChange={handleFileInput}
                style={{ display: "none" }}
              />
            </div>
          ) : (
            <div className="fileSelected">
              <div className="fileInfo">
                <FaFileExcel className="fileIcon" />
                <div className="fileDetails">
                  <h4>{selectedFile.name}</h4>
                  <span>Archivo listo para procesar</span>
                </div>
                <button className="clearFile" onClick={clearFile}>
                  <FaTimes />
                </button>
              </div>
              <div className="fileActions">
                <Button
                  label={isProcessing ? "Procesando" : "Obtener datos"}
                  icon={isProcessing ? "pi pi-spin pi-spinner" : "pi pi-check"}
                  className="processButton"
                  onClick={handleProcessData}
                  disabled={isProcessing}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
