import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { AutoComplete } from "primereact/autocomplete";
import { FaSpinner } from "react-icons/fa";
import "./style.css";

export default function SelectCollection() {
  const navigate = useNavigate();
  const [detectedCollections, setDetectedCollections] = useState([]);
  const [selectedCollection, setSelectedCollection] = useState("");
  const [filteredCollections, setFilteredCollections] = useState([]);
  const [selectedCollectionID, setSelectedCollectionID] = useState("");
  const [filteredCollectionsID, setFilteredCollectionsID] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasStarted = useRef(false);

  // Example collection options - replace with actual API call later
  const dbCollections = ["Colección A", "Colección B", "Colección C"];

  const loadCollections = async () => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    setIsLoading(true);
    try {
      const folderPath = await window.electronAPI.getFolderPath();
      if (folderPath) {
        const collections = await window.electronAPI.scanCollections(
          folderPath
        );

        setDetectedCollections(collections || []);
      }
    } catch (error) {
      console.error("Failed to initialize watcher:", error);
      setDetectedCollections([]);
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => {
    loadCollections();
  }, []);

  const searchCollections = (event) => {
    const query = event.query.toLowerCase();
    const filtered = detectedCollections.filter(
      (collection) =>
        collection.name.toLowerCase().includes(query) ||
        collection.code.toLowerCase().includes(query)
    );
    setFilteredCollections(filtered);
  };

  const searchCollectionsID = (event) => {
    const query = event.query.toLowerCase();
    const filtered = dbCollections.filter((collection) =>
      collection.toLowerCase().includes(query)
    );
    setFilteredCollectionsID(filtered);
  };

  const handleCollectionSelect = async (collectionPath) => {
    try {
      localStorage.setItem("selectedCollection", true);

      navigate("/import", {
        state: {
          collectionPath,
          dbCollectionId: selectedCollectionID,
        },
      });
    } catch (error) {
      console.error("Error selecting collection:", error);
    }
  };

  const itemTemplate = (item) => {
    if (typeof item === "string") {
      return <div>{item}</div>;
    }
    return (
      <div>
        <strong>{item.name}</strong> ({item.code})
      </div>
    );
  };

  return (
    <>
      {isLoading ? (
        <div className="loaderContainer">
          <FaSpinner className="loaderIcon spin" size={100} />
          <p>Buscando colecciones...</p>
        </div>
      ) : (
        <div className="selectionPanel">
          <div className="selectGroup">
            <label>Selecciona una colección local:</label>
            <AutoComplete
              value={selectedCollection}
              suggestions={filteredCollections}
              completeMethod={searchCollections}
              field="name"
              dropdown
              forceSelection
              placeholder="Selecciona una colección"
              itemTemplate={itemTemplate}
              onChange={(e) => setSelectedCollection(e.value)}
              disabled={!detectedCollections.length}
            />
          </div>

          <div className="selectGroup">
            <label>Asignar a colección de base de datos:</label>
            <AutoComplete
              value={selectedCollectionID}
              suggestions={filteredCollectionsID}
              completeMethod={searchCollectionsID}
              dropdown
              forceSelection
              placeholder="Selecciona una ID para esta colección"
              onChange={(e) => setSelectedCollectionID(e.value)}
              disabled={!selectedCollection}
            />
          </div>

          <div className="buttonGroup">
            <button
              className="confirmButton"
              onClick={() => handleCollectionSelect(selectedCollection?.path)}
              disabled={
                !selectedCollection || !selectedCollectionID || isLoading
              }
            >
              Procesar Colección
            </button>

            <button className="refreshButton" onClick={loadCollections}>
              Actualizar Colecciones
            </button>
          </div>
        </div>
      )}
    </>
  );
}
