import React, { useEffect, useState, useRef } from "react";
import {
  FaWindowClose,
  FaSearch,
  FaSort,
  FaCheck,
  FaTimes,
  FaChevronDown,
  FaCopy,
  FaEdit,
} from "react-icons/fa";
import "./style.css";

export default function Import() {
  const [files, setFiles] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [filterText, setFilterText] = useState("");
  const [selectedRows, setSelectedRows] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null });
  const [openColumnMenu, setOpenColumnMenu] = useState(null);

  const columnMenuRef = useRef(null);
  const editInputRef = useRef(null);

  const collections = ["Colección A", "Colección B", "Colección C"]; // Example collection options

  // Column configuration
  const columns = [
    { id: "name", header: "Inventario", type: "text", editable: false },
    {
      id: "collection_id",
      header: "Colección",
      type: "select",
      options: collections,
      editable: true,
    },
    { id: "description", header: "Descripción", type: "text", editable: true },
    { id: "elements", header: "Elementos", type: "text", editable: true },
    { id: "year", header: "Año", type: "number", editable: true },
    { id: "month", header: "Mes", type: "number", editable: true },
    { id: "day", header: "Día", type: "number", editable: true },
    { id: "censored", header: "Censurado", type: "boolean", editable: true },
    { id: "published", header: "Publicado", type: "boolean", editable: true },
  ];

  // Track folder and fetch files
  const loadProcessedFiles = async (folderPath) => {
    try {
      const processedFiles = await window.electronAPI.getProcessedFiles(
        folderPath
      );
      setFiles(processedFiles);
    } catch (error) {
      console.error("Error loading processed files:", error);
    }
  };
  useEffect(() => {
    let isMounted = true;
    const abortController = new AbortController();

    const initialize = async () => {
      try {
        const folderPath = await window.electronAPI.getFolderPath();
        if (isMounted && folderPath) {
          await window.electronAPI.watchFolder(folderPath);
          await loadProcessedFiles(folderPath);
        }
      } catch (error) {
        console.error("Failed to initialize watcher:", error);
      }
    };
    initialize();

    const onFileProcessed = (event, data) => {
      if (!isMounted) return;

      setFiles((prevFiles) => [
        ...prevFiles,
        {
          id: data.renamed,
          name: data.renamed,
          collection_id: "",
          description: "",
          elements: "",
          year: "",
          month: "",
          day: "",
          censored: false,
          published: false,
          selected: false,
        },
      ]);
    };
    window.electronAPI.onFileProcessed(onFileProcessed);

    const handleClickOutside = (event) => {
      if (
        columnMenuRef.current &&
        !columnMenuRef.current.contains(event.target)
      ) {
        setOpenColumnMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      isMounted = false;
      abortController.abort();
      window.electronAPI.offFileProcessed(onFileProcessed);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Handle edit cell
  const handleCellClick = (fileId, columnId, value) => {
    const column = columns.find((col) => col.id === columnId);
    if (!column.editable) return;

    if (column.type === "boolean") {
      const updatedFiles = files.map((file) => {
        if (file.id === fileId) {
          return { ...file, [columnId]: !file[columnId] };
        }
        return file;
      });
      setFiles(updatedFiles);
      return;
    }

    setEditingCell({ fileId, columnId });
    setEditValue(value);

    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.focus();
      }
    }, 0);
  };

  const handleEditChange = (e) => {
    setEditValue(e.target.value);

    if (editingCell) {
      const { fileId, columnId } = editingCell;
      const column = columns.find((col) => col.id === columnId);

      if (column.type === "select") {
        const value = e.target.value;
        if (value !== "") {
          const updatedFiles = files.map((file) => {
            if (file.id === fileId) {
              return { ...file, [columnId]: value };
            }
            return file;
          });
          setFiles(updatedFiles);
          setTimeout(() => {
            setEditingCell(null);
            setEditValue("");
          }, 50);
        }
      }
    }
  };

  const handleEditComplete = () => {
    if (!editingCell) return;

    const { fileId, columnId } = editingCell;
    const column = columns.find((col) => col.id === columnId);
    let value = editValue;

    const updatedFiles = files.map((file) => {
      if (file.id === fileId) {
        if (column.type === "number") {
          value = value === "" ? "" : Number(value);
        } else if (column.type === "boolean") {
          value = value === "true";
        }

        return { ...file, [columnId]: value };
      }
      return file;
    });

    setFiles(updatedFiles);
    setEditingCell(null);
    setEditValue("");
  };

  const handleEditKeyDown = (e) => {
    if (e.key === "Enter") {
      handleEditComplete();
    } else if (e.key === "Escape") {
      setEditingCell(null);
      setEditValue("");
    }
  };

  // Render cell content based on type
  const renderCellContent = (file, column) => {
    const { id: columnId, type } = column;
    const value = file[columnId];

    if (
      editingCell &&
      editingCell.fileId === file.id &&
      editingCell.columnId === columnId
    ) {
      if (type === "select") {
        return (
          <select
            ref={editInputRef}
            value={editValue}
            onChange={handleEditChange}
            className="cellEditSelect"
            autoFocus
          >
            <option value="">Seleccionar</option>
            {column.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      } else {
        return (
          <input
            ref={editInputRef}
            type={type === "number" ? "number" : "text"}
            value={editValue ?? ""}
            onChange={handleEditChange}
            onBlur={handleEditComplete}
            onKeyDown={handleEditKeyDown}
            className="cellEditInput"
          />
        );
      }
    }
    if (type === "boolean") {
      return (
        <div className="booleanCell">
          <div
            className={`booleanIcon ${value ? "active" : ""}`}
            onClick={() => handleCellClick(file.id, columnId, value)}
            data-icon="check"
          >
            <FaCheck />
          </div>

          <div
            className={`booleanIcon ${!value ? "active" : ""}`}
            onClick={() => handleCellClick(file.id, columnId, value)}
            data-icon="times"
          >
            <FaTimes />
          </div>
        </div>
      );
    }
    if (type === "select" || type === "text" || type === "number") {
      return (
        <div className="visibleCellControl inputCell">
          <div className="inputCellValue">
            {value ? value : <FaEdit className="inputCellIcon" />}
          </div>
        </div>
      );
    }
  };

  // Sorting
  const requestSort = (key) => {
    let direction = "ascending";

    if (sortConfig.key === key) {
      if (sortConfig.direction === "ascending") {
        direction = "descending";
      } else {
        setSortConfig({ key: null, direction: null });
        return;
      }
    }

    setSortConfig({ key, direction });
  };

  const getSortedData = () => {
    if (!sortConfig.key) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      // Handle empty values
      if (aValue === "" && bValue === "") return 0;
      if (aValue === "") return 1;
      if (bValue === "") return -1;

      // Compare based on data type
      if (typeof aValue === "string") {
        if (sortConfig.direction === "ascending") {
          return aValue.localeCompare(bValue);
        }
        return bValue.localeCompare(aValue);
      } else {
        if (sortConfig.direction === "ascending") {
          return aValue - bValue;
        }
        return bValue - aValue;
      }
    });
  };

  // Column menu
  const handleColumnMenuClick = (columnId) => {
    if (openColumnMenu === columnId) {
      setOpenColumnMenu(null);
    } else {
      setOpenColumnMenu(columnId);
    }
  };
  // Render column menu
  const renderColumnMenu = (column) => {
    if (openColumnMenu !== column.id) return null;

    return (
      <div className="columnMenu" ref={columnMenuRef}>
        <div className="columnMenuHeader">
          <h4>Opciones para {column.header}</h4>
        </div>

        <div className="columnMenuSection">
          <h5>Rellenar todas las filas</h5>
          {column.type === "boolean" ? (
            <>
              <button
                className="columnMenuButton"
                onClick={() => fillAllRows(column.id, true)}
              >
                <FaCheck />
              </button>
              <button
                className="columnMenuButton"
                onClick={() => fillAllRows(column.id, false)}
              >
                <FaTimes />
              </button>
            </>
          ) : (
            <>
              {column.options.map((option) => (
                <button
                  key={option}
                  className="columnMenuButton"
                  onClick={() => fillAllRows(column.id, option)}
                >
                  {option}
                </button>
              ))}
              <button
                className="columnMenuButton"
                onClick={() => fillAllRows(column.id, "")}
              >
                Limpiar todas
              </button>
            </>
          )}
        </div>

        <div className="columnMenuSection">
          <h5>Rellenar filas seleccionadas ({selectedRows.length})</h5>
          {selectedRows.length > 0 ? (
            <>
              {column.type === "boolean" ? (
                <>
                  <button
                    className="columnMenuButton"
                    onClick={() => fillSelectedRows(column.id, true)}
                  >
                    <FaCheck />
                  </button>
                  <button
                    className="columnMenuButton"
                    onClick={() => fillSelectedRows(column.id, false)}
                  >
                    <FaTimes />
                  </button>
                </>
              ) : (
                <>
                  {column.options.map((option) => (
                    <button
                      key={option}
                      className="columnMenuButton"
                      onClick={() => fillSelectedRows(column.id, option)}
                    >
                      {option}
                    </button>
                  ))}
                  <button
                    className="columnMenuButton"
                    onClick={() => fillSelectedRows(column.id, "")}
                  >
                    Limpiar seleccionadas
                  </button>
                </>
              )}
            </>
          ) : (
            <p className="columnMenuEmpty">No hay filas seleccionadas</p>
          )}
        </div>
      </div>
    );
  };

  // Mass edit functions
  const fillAllRows = (columnId, value) => {
    const updatedFiles = files.map((file) => ({
      ...file,
      [columnId]: value,
    }));

    setFiles(updatedFiles);
    setOpenColumnMenu(null);
  };

  const fillSelectedRows = (columnId, value) => {
    if (selectedRows.length === 0) return;

    const updatedFiles = files.map((file) => {
      if (selectedRows.includes(file.id)) {
        return {
          ...file,
          [columnId]: value,
        };
      }
      return file;
    });

    setFiles(updatedFiles);
    setOpenColumnMenu(null);
  };

  const copyRowToAll = (sourceRowId) => {
    const sourceRow = files.find((file) => file.id === sourceRowId);
    if (!sourceRow) return;

    const updatedFiles = files.map((file) => {
      if (file.id !== sourceRowId) {
        // Copy all editable fields
        const newFile = { ...file };
        columns.forEach((column) => {
          if (column.editable) {
            newFile[column.id] = sourceRow[column.id];
          }
        });
        return newFile;
      }
      return file;
    });

    setFiles(updatedFiles);
  };

  const copyRowToSelected = (sourceRowId) => {
    if (selectedRows.length === 0) return;

    const sourceRow = files.find((file) => file.id === sourceRowId);
    if (!sourceRow) return;

    const updatedFiles = files.map((file) => {
      if (file.id !== sourceRowId && selectedRows.includes(file.id)) {
        // Copy all editable fields
        const newFile = { ...file };
        columns.forEach((column) => {
          if (column.editable) {
            newFile[column.id] = sourceRow[column.id];
          }
        });
        return newFile;
      }
      return file;
    });

    setFiles(updatedFiles);
  };

  // Row selection
  const toggleRowSelection = (fileId) => {
    setSelectedRows((prev) => {
      if (prev.includes(fileId)) {
        return prev.filter((id) => id !== fileId);
      } else {
        return [...prev, fileId];
      }
    });
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedRows([]);
    } else {
      setSelectedRows(filteredData.map((file) => file.id));
    }
    setSelectAll(!selectAll);
  };

  // Filtering
  const filteredData = files.filter((file) => {
    if (!filterText) return true;

    return columns.some((column) => {
      const value = file[column.id];
      if (value === null || value === undefined) return false;

      return String(value).toLowerCase().includes(filterText.toLowerCase());
    });
  });
  const sortedData = getSortedData();

  return (
    <div className="container">
      {files.length === 0 ? (
        <div className="emptyState">
          <FaWindowClose size={60} className="emptyStateIcon" />
          <h1 className="emptyStateTitle">No hay archivos para importar</h1>
          <p className="emptyStateDescription">
            No se han detectado archivos nuevos listos para importar. Por favor
            verifica que los archivos estén en el formato correcto y en la
            carpeta seleccionada.
          </p>
        </div>
      ) : (
        <>
          <div className="table">
            <div className="tableContent">
              <div className="tableFilter">
                <div className="featuresWrapper">
                  <div className="searchGroup">
                    <input
                      type="text"
                      className="filterInput"
                      placeholder="Filtrar..."
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                    />

                    {filterText && (
                      <button
                        type="button"
                        className="clearInputBtn"
                        id="clearInputBtn"
                        onClick={() => setFilterText("")}
                      >
                        <FaTimes />
                      </button>
                    )}
                  </div>
                  <button type="button" className="actionButton">
                    <FaSearch />
                    <span>Buscar</span>
                  </button>
                </div>
              </div>

              <div className="tableControls">
                <div className="tableInfo">
                  <span>{sortedData.length} archivos encontrados</span>
                  {selectedRows.length > 0 && (
                    <span className="selectedInfo">
                      {selectedRows.length} seleccionados
                    </span>
                  )}
                </div>
              </div>

              <div className="tableWrapper">
                <table>
                  <thead>
                    <tr>
                      <th className="selectColumn">
                        <input
                          type="checkbox"
                          checked={selectAll}
                          onChange={toggleSelectAll}
                          className="selectCheckbox"
                        />
                      </th>
                      <th className="actionColumn">Acciones</th>
                      {columns.map((column) => (
                        <th key={column.id} className="columnHeader">
                          <div className="columnHeaderContent">
                            <span
                              className="columnHeaderText"
                              onClick={() => requestSort(column.id)}
                            >
                              {column.header}
                              {column.type === "boolean" ? (
                                ""
                              ) : (
                                <FaSort
                                  className={`sortIcon ${sortConfig.direction}`}
                                />
                              )}
                            </span>
                            {column.editable &&
                              !["text", "number"].includes(column.type) && (
                                <button
                                  className="columnMenuToggle"
                                  onClick={() =>
                                    handleColumnMenuClick(column.id)
                                  }
                                >
                                  <FaChevronDown />
                                </button>
                              )}
                            {renderColumnMenu(column)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedData.map((file) => (
                      <tr
                        key={file.id}
                        className={
                          selectedRows.includes(file.id) ? "rowSelected" : ""
                        }
                      >
                        <td className="selectColumn">
                          <input
                            type="checkbox"
                            checked={selectedRows.includes(file.id)}
                            onChange={() => toggleRowSelection(file.id)}
                            className="selectCheckbox"
                          />
                        </td>

                        <td className="actionColumn">
                          <div className="rowActions">
                            <button
                              className="rowActionButton"
                              title="Usar como plantilla para todas las filas"
                              onClick={() => copyRowToAll(file.id)}
                            >
                              <FaCopy />
                            </button>
                            {selectedRows.length > 0 && (
                              <button
                                className="rowActionButton"
                                title="Usar como plantilla para filas seleccionadas"
                                onClick={() => copyRowToSelected(file.id)}
                              >
                                <FaCopy className="selectedCopy" />
                              </button>
                            )}
                          </div>
                        </td>

                        {columns.map((column) => (
                          <td
                            key={`${file.id}-${column.id}`}
                            className={`dataCell ${
                              column.editable ? "editableCell" : ""
                            }`}
                            onClick={() =>
                              handleCellClick(
                                file.id,
                                column.id,
                                file[column.id]
                              )
                            }
                          >
                            {renderCellContent(file, column)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
