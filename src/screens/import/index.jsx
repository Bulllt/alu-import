import React, { useEffect, useState, useRef, useContext } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { StatusContext } from "../../context/statusContext.jsx";
import ImportConfirmation from "../../components/importConfirmation.jsx";
import DateCell from "../../components/dateCell.jsx";
import { Chips } from "primereact/chips";
import { AutoComplete } from "primereact/autocomplete";
import TableScrollbar from "../../components/tableScrollbar.jsx";
import ImagePreview from "../../components/imagePreview.jsx";
import LoadingModal from "../../components/loadingModal.jsx";

import {
  FaWindowClose,
  FaSearch,
  FaSort,
  FaCheck,
  FaTimes,
  FaChevronDown,
  FaCopy,
  FaEdit,
  FaFileImport,
  FaSpinner,
  FaArrowUp,
} from "react-icons/fa";
import "./style.css";

export default function Import() {
  const location = useLocation();
  const navigate = useNavigate();
  const { showStatusMessage } = useContext(StatusContext);
  const [files, setFiles] = useState([]);
  const [csvDatasets, setCsvDatasets] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [editValues, setEditValues] = useState({});
  const [filterText, setFilterText] = useState("");
  const [selectedRows, setSelectedRows] = useState([]);
  const [selectAll, setSelectAll] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: null });
  const [openColumnMenu, setOpenColumnMenu] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [filesReadyToImport, setFilesReadyToImport] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingModalVisible, setLoadingModalVisible] = useState(false);
  const [backToTopButtonVisible, setBackToTopButtonVisible] = useState(false);

  const hasStartedRef = useRef(false);
  const tableRef = useRef(null);
  const columnMenuRef = useRef(null);
  const editInputRef = useRef(null);

  const autoCompleteRef = useRef(null);
  const [filteredOptions, setFilteredOptions] = useState([]);
  const [currentSearchType, setCurrentSearchType] = useState("");
  const [foreignTablesData, setForeignTablesData] = useState({
    ubicacion_id: [],
    communes_id: [],
    ubications_id: [],
  });

  const [importProgress, setImportProgress] = useState(0);

  // Column configuration
  const [columns, setColumns] = useState([
    { id: "name", header: "Inventario", type: "text", editable: false },
    { id: "description", header: "Descripción", type: "text", editable: true },
    { id: "elements", header: "Elementos", type: "chips", editable: true },
    {
      id: "date",
      header: "Fecha\u00A0\u00A0\u00A0\u00A0",
      type: "date",
      editable: true,
    },
    {
      id: "ubicacion_id",
      header: "Ubicación\u00A0 objeto",
      type: "select",
      options: [],
      editable: true,
    },
    {
      id: "communes_id",
      header: "Comuna\u00A0\u00A0\u00A0\u00A0",
      type: "select",
      options: [],
      editable: true,
    },
    {
      id: "ubications_id",
      header: "Ubicación\u00A0\u00A0\u00A0",
      type: "select",
      options: [],
      editable: true,
    },
    { id: "censored", header: "Censurado", type: "boolean", editable: true },
    {
      id: "censored_reason",
      header: "Razón de censura",
      type: "text",
      editable: true,
      dependsOn: "censored",
    },
    { id: "published", header: "Publicado", type: "boolean", editable: true },
  ]);

  const initialFiles = async () => {
    setIsLoading(true);
    try {
      await window.electronAPI.startCollectionProcessing(
        location.state?.collectionPath
      );
    } catch (error) {
      console.error("Processing error:", error);
    } finally {
      setTimeout(() => {
        setIsLoading(false);
      }, 500);
    }
  };

  const fetchForeignTablesDB = async () => {
    try {
      const response = await window.electronAPI.fetchForeignTables();
      const [ubicaciones, communes, ubications] = response.data;

      const transformData = (items, displayFormat) => {
        return items.map((item) => ({
          value: item.id,
          display: displayFormat(item),
        }));
      };

      const displayFormats = {
        ubicacion: (item) =>
          `${item.tipo}: ${item.numero_caja ?? ""}-${item.deposito ?? ""}-${
            item.estante ?? ""
          }-${item.piso ?? ""}`,
        commune: (item) => item.description,
        ubication: (item) => item.enclosure,
      };

      setForeignTablesData({
        ubicacion_id: transformData(ubicaciones, displayFormats.ubicacion),
        communes_id: transformData(communes, displayFormats.commune),
        ubications_id: transformData(ubications, displayFormats.ubication),
      });

      setColumns((column) =>
        column.map((col) => {
          if (col.id === "ubicacion_id") {
            return {
              ...col,
              options: transformData(ubicaciones, displayFormats.ubicacion),
            };
          }
          if (col.id === "communes_id") {
            return {
              ...col,
              options: transformData(communes, displayFormats.commune),
            };
          }
          if (col.id === "ubications_id") {
            return {
              ...col,
              options: transformData(ubications, displayFormats.ubication),
            };
          }
          return col;
        })
      );
    } catch (error) {
      console.error("Connection Failed:", error.message);
    }
  };

  useEffect(() => {
    const hasStarted = hasStartedRef.current;
    hasStartedRef.current = true;
    let isMounted = true;

    if (!hasStarted) {
      fetchForeignTablesDB();
      initialFiles();
    }

    const onFileProcessed = (event, data) => {
      if (!isMounted) return;

      setFiles((prevFiles) => {
        const processFile = (file) => ({
          id: file.inventoryCode,
          name: file.newName,
          path: file.path,
          description: null,
          elements: null,
          date: null,
          ubicacion_id: "",
          communes_id: "",
          ubications_id: "",
          censored: false,
          censored_reason: null,
          published: false,
          document:
            location.state?.collectionType === "documentos" ? true : false,
          csvContext: file.csvContext,
        });

        const newFiles = Array.isArray(data)
          ? data.map(processFile)
          : [processFile(data)];

        const existingIds = new Set(prevFiles.map((f) => f.id));
        const uniqueNewFiles = newFiles.filter((f) => !existingIds.has(f.id));
        return [...prevFiles, ...uniqueNewFiles];
      });
    };

    const fileCleanup = window.electronAPI.onFileProcessed(onFileProcessed);

    const onCSVFile = (csvInfo) => {
      if (!isMounted) return;

      const { data, scope, folderName } = csvInfo;

      const hasDateParts = data.some((row) => row.year);
      const updatedColumns = columns.filter((col) => {
        if (col.id === "date" && hasDateParts) return false;
        return true;
      });

      setColumns(updatedColumns);
      setCsvDatasets((prev) => {
        const existingIndex = prev.findIndex(
          (dataset) =>
            dataset.scope === scope && dataset.folderName === folderName
        );

        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = { data, scope, folderName };
          return updated;
        } else {
          return [...prev, { data, scope, folderName }];
        }
      });
    };

    const csvCleanup = window.electronAPI.onCSVFile(onCSVFile);

    return () => {
      isMounted = false;
      fileCleanup();
      csvCleanup();

      window.electronAPI
        .executeRollback(location.state?.collectionPath)
        .catch((error) => {
          console.error("Rollback error:", error);
        });
    };
  }, [location.state?.collectionPath, location.state?.dbCollectionId]);

  // Handle edit cell
  const handleCellClick = (fileId, columnId, value) => {
    if (editingCell?.fileId === fileId && editingCell?.columnId === columnId) {
      return;
    }

    const column = columns.find((col) => col.id === columnId);
    if (!column.editable) return;

    if (column.dependsOn) {
      const file = files.find((f) => f.id === fileId);
      if (!file) return;
      if (!file.censored) {
        showStatusMessage(
          "error",
          "Activa 'Censurado' para habilitar la edición de la razón"
        );
        return;
      }
    }

    if (column.type === "boolean") {
      setEditingCell(null);
      const updatedFiles = files.map((file) => {
        if (file.id === fileId) {
          const newValue = !file[columnId];
          if (columnId === "censored" && !newValue) {
            return { ...file, [columnId]: newValue, censored_reason: "" };
          }
          return { ...file, [columnId]: newValue };
        }
        return file;
      });
      setFiles(updatedFiles);
      return;
    }

    setEditingCell({ fileId, columnId });
    if (column.type === "select") {
      setCurrentSearchType(column.id);
      const option = foreignTablesData[column.id]?.find(
        (opt) => opt.value === value
      );
      setEditValues((prev) => ({
        ...prev,
        [columnId]: option?.display || "",
      }));
    } else {
      setEditValues((prev) => ({
        ...prev,
        [columnId]: value,
      }));
    }

    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.focus();
      }
    }, 0);
  };

  const handleEditChange = (e) => {
    const { columnId } = editingCell;
    setEditValues((prev) => ({
      ...prev,
      [columnId]: e.target.value,
    }));
  };

  const handleEditComplete = (e) => {
    if (!editingCell) return;

    const { fileId, columnId } = editingCell;
    const column = columns.find((col) => col.id === columnId);
    let value = editValues[columnId];
    if (value) value = value.trim();

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
    setEditValues((prev) => ({ ...prev, [columnId]: "" }));
  };

  const handleEditKeyDown = (e) => {
    if (e.key === "Enter") {
      handleEditComplete();
    } else if (e.key === "Escape") {
      const { columnId } = editingCell;
      setEditingCell(null);
      setEditValues((prev) => ({ ...prev, [columnId]: "" }));
    }
  };

  // Render cell content based on type
  const searchOptions = (event) => {
    const query = event.query.toLowerCase();
    const filtered = foreignTablesData[currentSearchType]?.filter((option) =>
      option.display.toLowerCase().includes(query)
    );
    setFilteredOptions(filtered);
  };

  const renderCellContent = (file, column) => {
    const { id: columnId, type } = column;
    const value = file[columnId];

    if (
      editingCell &&
      editingCell.fileId === file.id &&
      editingCell.columnId === columnId
    ) {
      switch (column.type) {
        case "date":
          return (
            <DateCell
              file={file}
              onChange={(dateData) => {
                const updatedFiles = files.map((f) =>
                  f.id === file.id
                    ? {
                        ...f,
                        ...dateData,
                      }
                    : f
                );
                setFiles(updatedFiles);
              }}
              onComplete={() => setEditingCell(null)}
            />
          );

        case "chips":
          return (
            <Chips
              value={
                Array.isArray(file.elements)
                  ? file.elements
                  : typeof file.elements === "string"
                  ? file.elements.split(",").map((el) => el.trim())
                  : []
              }
              onChange={(e) => {
                const updatedFiles = files.map((f) =>
                  f.id === file.id
                    ? {
                        ...f,
                        elements: e.value.join(","),
                      }
                    : f
                );
                setFiles(updatedFiles);
              }}
              onBlur={() => setEditingCell(null)}
              separator=","
              removable
              autoFocus
            />
          );

        case "select":
          return (
            <AutoComplete
              ref={autoCompleteRef}
              value={editValues[columnId]}
              suggestions={filteredOptions}
              completeMethod={searchOptions}
              field="display"
              dropdown
              forceSelection
              placeholder="Seleccionar"
              className="cellEditSelect"
              onChange={(e) =>
                setEditValues((prev) => ({
                  ...prev,
                  [columnId]:
                    typeof e.value === "string"
                      ? e.value
                      : e.value?.display || "",
                }))
              }
              onSelect={(e) => {
                setEditValues((prev) => ({
                  ...prev,
                  [columnId]: e.value.display,
                }));
                const updatedFiles = files.map((f) =>
                  f.id === file.id ? { ...f, [columnId]: e.value.value } : f
                );
                setFiles(updatedFiles);
              }}
              onFocus={() => {
                setTimeout(() => {
                  const input = autoCompleteRef.current
                    ?.getElement()
                    ?.querySelector("input");
                  if (input) {
                    input.select();
                  }
                }, 0);
              }}
              itemTemplate={(option) => <div>{option.display}</div>}
            />
          );

        default:
          return (
            <input
              ref={editInputRef}
              type={type === "number" ? "number" : "text"}
              value={editValues[columnId] ?? ""}
              onChange={handleEditChange}
              onBlur={handleEditComplete}
              onKeyDown={handleEditKeyDown}
              className="cellEditInput"
            />
          );
      }
    }

    switch (column.type) {
      case "date":
        const { date, datePrecision } = file;
        let formattedDate;

        if (!date) {
          return <FaEdit className="inputCellIcon" />;
        }

        try {
          const dateObj = new Date(date);
          switch (datePrecision) {
            case "year":
              formattedDate = dateObj.getFullYear();
              break;
            case "month":
              formattedDate = dateObj.toLocaleDateString("es-ES", {
                month: "long",
                year: "numeric",
              });
              break;
            case "full":
            default:
              formattedDate = dateObj.toLocaleDateString("es-ES", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
              });
          }
        } catch (e) {
          formattedDate = "Fecha inválida";
        }

        return (
          <div className="visibleCellControl inputCell">
            <div className="inputCellValue">{formattedDate}</div>
          </div>
        );

      case "chips":
        const chipValues = Array.isArray(file.elements)
          ? file.elements
          : typeof file.elements === "string"
          ? file.elements.split(",").filter(Boolean)
          : [];

        if (chipValues.length === 0) {
          return (
            <div className="visibleCellControl inputCell">
              <div className="inputCellValue">
                <FaEdit className="inputCellIcon" />
              </div>
            </div>
          );
        }

        return (
          <div className="visibleCellControl inputCell">
            <div className="inputCellValue chips-preview">
              {chipValues.map((chip, index) => (
                <div key={index} className="chip-item">
                  {chip}
                  <span
                    className="remove-chip"
                    onClick={(e) => {
                      e.stopPropagation();
                      const updated = chipValues.filter((_, i) => i !== index);
                      const updatedFiles = files.map((f) =>
                        f.id === file.id
                          ? { ...f, elements: updated.join(",") }
                          : f
                      );
                      setFiles(updatedFiles);
                    }}
                  >
                    <FaTimes />
                  </span>
                </div>
              ))}
            </div>
          </div>
        );

      case "boolean":
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

      default:
        const displayOption =
          column.options?.find((opt) => opt.value === value) || null;
        return (
          <div className="visibleCellControl inputCell">
            <div className="inputCellValue">
              {value ? (
                column.type === "select" ? (
                  displayOption?.display
                ) : (
                  value
                )
              ) : (
                <FaEdit className="inputCellIcon" />
              )}
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

      if (aValue === "" && bValue === "") return 0;
      if (aValue === "") return 1;
      if (bValue === "") return -1;

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
                  key={option.value}
                  className="columnMenuButton"
                  onClick={() => fillAllRows(column.id, option.value)}
                >
                  {option.display}
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
                      key={option.value}
                      className="columnMenuButton"
                      onClick={() => fillSelectedRows(column.id, option.value)}
                    >
                      {option.display}
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
        const newFile = { ...file };

        columns.forEach((column) => {
          if (column.editable) {
            if (column.type === "date") {
              newFile.datePrecision = sourceRow.datePrecision;
              newFile.date = sourceRow.date;
              newFile.year = sourceRow.year;
              newFile.month = sourceRow.month;
              newFile.day = sourceRow.day;
            } else {
              newFile[column.id] = sourceRow[column.id];
            }
          }
        });
        return newFile;
      }
      return file;
    });

    setFiles(updatedFiles);
  };

  const copyRowToSelected = (sourceRowId) => {
    const sourceRow = files.find((file) => file.id === sourceRowId);
    if (!sourceRow || selectedRows.length === 0) return;

    const updatedFiles = files.map((file) => {
      if (file.id !== sourceRowId && selectedRows.includes(file.id)) {
        const newFile = { ...file };

        columns.forEach((column) => {
          if (column.editable) {
            if (column.type === "date") {
              newFile.datePrecision = sourceRow.datePrecision;
              newFile.date = sourceRow.date;
              newFile.year = sourceRow.year;
              newFile.month = sourceRow.month;
              newFile.day = sourceRow.day;
            } else {
              newFile[column.id] = sourceRow[column.id];
            }
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
    if (file.document && !file.id.endsWith("_01")) return false;
    if (!filterText) return true;

    return columns.some((column) => {
      const value = file[column.id];
      if (value === null || value === undefined) return false;

      return String(value).toLowerCase().includes(filterText.toLowerCase());
    });
  });

  const sortedData = getSortedData();

  // Sending data
  const validateFilesForImport = (files) => {
    const mandatoryColumns = [
      //{ id: "ubicacion_id", header: "Ubicación objeto" },
    ];
    const errors = [];

    files.forEach((file) => {
      mandatoryColumns.forEach(({ id, header }) => {
        if (!file[id] || file[id].toString().trim() === "") {
          errors.push({
            fileId: file.id,
            column: id,
            message: `Campo vacío en columna ${header}`,
          });
        }
      });
    });

    return errors;
  };

  const transformFileForDatabase = (file) => {
    let year = null;
    let month = null;
    let day = null;

    switch (file.datePrecision) {
      case "year":
        year = file.year || null;
        break;

      case "month":
        year = file.year || null;
        month = file.month || null;
        break;

      case "full":
        year = file.year || null;
        month = file.month || null;
        day = file.day || null;
        break;
    }

    const now = new Date();
    const nowYear = now.getFullYear();
    const nowMonth = String(now.getMonth() + 1).padStart(2, "0");
    const nowDay = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");

    let fileType = null;
    const collectionType = location.state?.collectionType;
    switch (collectionType) {
      case "audios":
        fileType = 4;
        break;

      case "documentos":
        fileType = 3;
        break;

      case "imagenes":
        fileType = 1;
        break;

      case "peliculas":
        fileType = 2;
        break;
    }

    const csvData = findCSVDataForFile(file, csvDatasets);
    const csvRow = csvData?.[0] || {};

    const monthMap = {
      enero: 1,
      febrero: 2,
      marzo: 3,
      abril: 4,
      mayo: 5,
      junio: 6,
      julio: 7,
      agosto: 8,
      septiembre: 9,
      octubre: 10,
      noviembre: 11,
      diciembre: 12,
    };

    const csvValues = Object.entries(csvRow).reduce((item, [key, value]) => {
      if (value === undefined || value === null) {
        item[key] = null;
        return item;
      }

      if (key.toLowerCase() === "month") {
        const numValue = Number(value);
        if (!Number.isNaN(numValue)) {
          item[key] = numValue;
          return item;
        }

        const lowerValue = String(value).toLowerCase().trim();
        item[key] = monthMap[lowerValue];
        return item;
      }

      const numericFields = ["year", "day", "box_number", "container_number"];
      if (numericFields.includes(key)) {
        item[key] = Number.isNaN(Number(value)) ? null : Number(value);
        return item;
      }

      item[key] = String(value);
      return item;
    }, {});

    const valuesToSend = {
      code: file.id.split("_")[0],
      n_object: file.id.split("_")[1],
      n_ic: file.id.split("_")[2],
      collection_id: location.state?.dbCollectionId,
      path: file.path,
      container_annotations: null,
      object_annotations: null,
      title: null,
      description: file.description || null,
      history: null,
      information: null,
      peoples: null,
      elements: file.elements || null,
      streets: "desconocido,desconocido",
      year: year,
      month: month,
      day: day,
      censored: file.censored ? 1 : 0,
      censored_reason: file.censored_reason || null,
      published: file.published ? 1 : 0,
      ai_description: null,
      ai_elements: null,
      ubicacion_id: file.ubicacion_id || 1,
      techniques_id: 27,
      sizes_id: 1,
      communes_id: file.communes_id || 128,
      types_id: fileType,
      locations_id: 3,
      ubications_id: file.ubications_id || 360,
      created_at: `${nowYear}-${nowMonth}-${nowDay} ${hours}:${minutes}:${seconds}`,
      updated_at: `${nowYear}-${nowMonth}-${nowDay} ${hours}:${minutes}:${seconds}`,
      document: file.document,
      ...csvValues,
    };

    return valuesToSend;
  };

  const findCSVDataForFile = (file, csvDatasets) => {
    if (!csvDatasets || csvDatasets.length === 0) {
      return null;
    }

    const fileFolderContext = file.csvContext;

    if (fileFolderContext) {
      const folderCSV = csvDatasets.find(
        (dataset) =>
          dataset.scope === "folder" && dataset.folderName === fileFolderContext
      );

      if (folderCSV) {
        return folderCSV.data;
      }
    }

    const collectionCSV = csvDatasets.find(
      (dataset) => dataset.scope === "collection"
    );

    if (collectionCSV) {
      return collectionCSV.data;
    }

    return null;
  };

  const handleImport = async () => {
    const validationErrors = validateFilesForImport(files);

    if (validationErrors.length > 0) {
      const errorMap = validationErrors.reduce((acc, error) => {
        if (!acc[error.fileId]) {
          acc[error.fileId] = new Set();
        }
        acc[error.fileId].add(error.column);
        return acc;
      }, {});

      setFiles((prevFiles) =>
        prevFiles.map((file) => ({
          ...file,
          errorColumns: errorMap[file.id] ? Array.from(errorMap[file.id]) : [],
        }))
      );

      showStatusMessage(
        "error",
        `Error en ${validationErrors[0].fileId}: ${validationErrors[0].message}`
      );
      return;
    }

    setFiles((prevFiles) =>
      prevFiles.map((file) => ({ ...file, errorColumns: [] }))
    );

    const importData = files.map(transformFileForDatabase);
    setFilesReadyToImport(importData);
    setModalVisible(true);
  };

  const handleConfirmImport = async () => {
    try {
      setModalVisible(false);
      showStatusMessage(
        "success",
        "Se esta importando la colección, por favor espera"
      );
      setLoadingModalVisible(true);
      setImportProgress(0);

      await window.electronAPI.importProcessedFiles(
        filesReadyToImport,
        location.state?.collectionPath,
        location.state?.collectionType
      );
      setFiles([]);
      localStorage.removeItem("selectedCollection");
    } catch (error) {
      setLoadingModalVisible(false);
      showStatusMessage("error", `Error durante la importación`);
      console.error("Import error:", error);
    }
  };

  useEffect(() => {
    const cleanup = window.electronAPI.onImportProgress((progress) => {
      setImportProgress(progress);
      if (progress === 100) {
        setTimeout(() => {
          navigate("/selectCollection");
          setLoadingModalVisible(false);
        }, 500);
      }
    });

    return () => cleanup();
  }, []);

  // Back to top functionality and column menu click outside function
  useEffect(() => {
    const toggleVisibility = () => {
      if (window.scrollY > 400) {
        setBackToTopButtonVisible(true);
      } else {
        setBackToTopButtonVisible(false);
      }
    };

    const handleClickOutside = (event) => {
      if (
        columnMenuRef.current &&
        !columnMenuRef.current.contains(event.target)
      ) {
        const isMenuToggle = event.target.closest(".columnMenuToggle");
        if (!isMenuToggle) {
          setOpenColumnMenu(null);
        }
      }
    };

    window.addEventListener("scroll", toggleVisibility);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      window.removeEventListener("scroll", toggleVisibility);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  if (loadingModalVisible) {
    return (
      <div className="importContainer">
        <div className="loadingModalContainer">
          <LoadingModal progress={importProgress} />
        </div>
      </div>
    );
  }

  return (
    <div className="importContainer">
      {isLoading ? (
        <div className="loaderContainer">
          <FaSpinner className="loaderIcon" size={100} />
        </div>
      ) : files.length === 0 ? (
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
                  <button
                    type="button"
                    className="actionButton"
                    onClick={handleImport}
                  >
                    <FaFileImport />
                    <span>Importar</span>
                  </button>

                  <ImportConfirmation
                    visible={modalVisible}
                    onHide={() => setModalVisible(false)}
                    filesToImport={filesReadyToImport}
                    onConfirm={handleConfirmImport}
                  />
                </div>
              </div>

              <div className="tableControls">
                <div className="tableInfo">
                  <span>{sortedData.length} archivos encontrados</span>
                  <span style={{ margin: "0 0.5rem" }}>|</span>
                  <span>
                    Importando a la colección {location.state?.dbCollectionId}
                  </span>
                  {selectedRows.length > 0 && (
                    <span className="selectedInfo">
                      {selectedRows.length} seleccionados
                    </span>
                  )}
                </div>
              </div>

              <div className="tableWrapper" ref={tableRef}>
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

                      <th className="imageColumn">Imagen</th>

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
                              !["text", "date", "chips"].includes(
                                column.type
                              ) && (
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

                        <td className="imageColumn">
                          <ImagePreview file={file} />
                        </td>

                        {columns.map((column) => {
                          const hasError = file.errorColumns?.includes(
                            column.id
                          );
                          return (
                            <td
                              key={`${file.id}-${column.id}`}
                              className={`dataCell ${
                                column.editable ? "editableCell" : ""
                              } ${hasError ? "cellError" : ""}
                            `}
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
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <TableScrollbar tableRef={tableRef} />
              </div>
            </div>
          </div>
        </>
      )}
      <button
        className={`backToTop ${backToTopButtonVisible ? "visible" : ""}`}
        onClick={scrollToTop}
      >
        <FaArrowUp />
      </button>
    </div>
  );
}
