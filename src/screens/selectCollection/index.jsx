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
  const [collectionsDB, setCollectionsDB] = useState([]);
  const [selectedCollectionDB, setSelectedCollectionDB] = useState("");
  const [filteredCollectionsDB, setFilteredCollectionsDB] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasStarted = useRef(false);

  const loadCollections = async () => {
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
    }
  };

  const fetchCollectionsDB = async () => {
    setIsLoading(true);
    try {
      const response = await window.electronAPI.fetchCollections();
      const formatted = response.data.map((c) => ({
        ...c,
        display: `${c.id} (${c.donor})`,
      }));

      setCollectionsDB(formatted);
    } catch (error) {
      console.error("Connection Failed:", error.message);
      setCollectionsDB([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    loadCollections();
    fetchCollectionsDB();
  }, []);
  const refresh = () => {
    loadCollections();
    fetchCollectionsDB();
  };

  const searchCollections = (event) => {
    const query = event.query.toLowerCase();
    const filtered = detectedCollections.filter(
      (collection) =>
        collection.name.toLowerCase().includes(query) ||
        collection.code.toLowerCase().includes(query)
    );
    setFilteredCollections(filtered);
  };

  const searchCollectionsDB = (event) => {
    const query = event.query.toLowerCase();
    const filtered = collectionsDB.filter((collection) =>
      collection.display.toLowerCase().includes(query)
    );
    setFilteredCollectionsDB(filtered);
  };

  const handleCollectionSelect = async (collectionPath) => {
    try {
      localStorage.setItem("selectedCollection", true);

      navigate("/import", {
        state: {
          collectionPath,
          dbCollectionId: selectedCollectionDB.id,
        },
      });
    } catch (error) {
      console.error("Error selecting collection:", error);
    }
  };

  const collectionsTemplate = (item) => {
    if (!item) {
      return <div>Error</div>;
    }
    return (
      <div>
        <strong>{item.name}</strong> ({item.code})
      </div>
    );
  };
  const dbCollectionsTemplate = (item) => {
    if (!item) {
      return <div>Error</div>;
    }
    return (
      <div>
        <strong>{item.id}</strong> ({item.donor})
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
              itemTemplate={collectionsTemplate}
              onChange={(e) => setSelectedCollection(e.value)}
              disabled={!detectedCollections.length}
            />
          </div>

          <div className="selectGroup">
            <label>Asignar a colección de base de datos:</label>
            <AutoComplete
              value={selectedCollectionDB}
              suggestions={filteredCollectionsDB}
              completeMethod={searchCollectionsDB}
              field="display"
              dropdown
              forceSelection
              placeholder="Selecciona una ID para esta colección"
              itemTemplate={dbCollectionsTemplate}
              onChange={(e) => setSelectedCollectionDB(e.value)}
              disabled={!selectedCollection}
            />
          </div>

          <div className="buttonGroup">
            <button
              className="confirmButton"
              onClick={() => handleCollectionSelect(selectedCollection?.path)}
              disabled={
                !selectedCollection || !selectedCollectionDB || isLoading
              }
            >
              Procesar Colección
            </button>

            <button className="refreshButton" onClick={refresh}>
              Actualizar Colecciones
            </button>
          </div>
        </div>
      )}
    </>
  );
}
