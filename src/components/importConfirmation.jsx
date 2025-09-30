import React from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import "./styles/importConfirmation.css";
import "primeicons/primeicons.css";

export default function ImportConfirmation({
  visible,
  onHide,
  filesToImport,
  onConfirm,
}) {
  const formatDate = (file) => {
    const year =
      file.year !== null && file.year !== undefined ? Number(file.year) : NaN;
    const month =
      file.month !== null && file.month !== undefined
        ? Number(file.month)
        : NaN;
    const day =
      file.day !== null && file.day !== undefined ? Number(file.day) : NaN;

    const hasYear = !isNaN(year) && year > 0;
    const hasMonth = !isNaN(month) && month >= 1 && month <= 12;
    const hasDay = !isNaN(day) && day >= 1 && day <= 31;

    const monthNames = [
      "Enero",
      "Febrero",
      "Marzo",
      "Abril",
      "Mayo",
      "Junio",
      "Julio",
      "Agosto",
      "Septiembre",
      "Octubre",
      "Noviembre",
      "Diciembre",
    ];

    if (!hasYear && !hasMonth && !hasDay) return "Sin fecha";

    if (hasYear && hasMonth && hasDay) {
      return `${String(day).padStart(2, "0")}/${String(month).padStart(
        2,
        "0"
      )}/${year}`;
    } else if (hasYear && hasMonth) {
      return `${monthNames[month - 1]} de ${year}`;
    } else if (hasYear) {
      return year.toString();
    }
  };

  const getImportCount = () => {
    let count = 0;
    for (const file of filesToImport) {
      if (file.document && file.n_ic == "01") {
        count++;
      } else if (!file.document) {
        count++;
      }
    }
    return count;
  };

  const fieldMappings = {
    collection_id: "Colección",
    container_annotations: "container_annotations",
    object_annotations: "object_annotations",
    title: "Título",
    description: "Descripción",
    history: "Historia",
    information: "Información",
    peoples: "Personas",
    elements: "Elementos",
    streets: "Calles",
    censored: "Censurado",
    censored_reason: "Razón de censura",
    published: "Publicado",
    ubicacion_id: "Ubicación objeto",
    techniques_id: "Técnica",
    sizes_id: "Tamaño",
    communes_id: "Comuna",
    types_id: "Tipo",
    locations_id: "Localización",
    ubications_id: "Ubicación",
  };

  const excludedKeys = new Set([
    "document",
    "code",
    "n_object",
    "n_ic",
    "year",
    "month",
    "day",
    "path",
    "created_at",
    "updated_at",
  ]);

  const formatFieldValue = (key, value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (key === "censored" || key === "published") {
      return value ? "Sí" : "No";
    }

    if (key === "ubicacion_id" && value === 1) return null;
    if (key === "communes_id" && value === 128) return null;
    if (key === "ubications_id" && value === 360) return null;

    if (key === "types_id") {
      const typeMap = {
        1: "Imagen",
        2: "Película",
        3: "Documento",
        4: "Audio",
      };
      return typeMap[value] || value;
    }

    return value;
  };

  const footer = (
    <div className="buttonsContainer">
      <Button
        label="Atrás"
        icon="pi pi-arrow-left"
        className="button"
        onClick={onHide}
      />
      <Button
        label="Confirmar"
        icon="pi pi-check"
        className="button"
        onClick={onConfirm}
        autoFocus
      />
    </div>
  );

  return (
    <Dialog
      header="Confirmar Importación"
      visible={visible}
      style={{ width: "95vw" }}
      footer={footer}
      onHide={onHide}
      dismissableMask
    >
      <div className="modalContainer">
        <h4>Se importarán {getImportCount()} archivos:</h4>
        <div className="filesContainer">
          {filesToImport
            .filter((file) => {
              if (!file.document) return true;
              if (file.document && file.n_ic == "01") {
                return true;
              }
              return false;
            })
            .map((file, index) => (
              <div key={index} className="file">
                <div className="fileName">
                  {file.code}_{file.n_object}_{file.n_ic}
                </div>
                <div className="fileDetails">
                  <span data-label="Fecha" data-value={formatDate(file)} />
                  {Object.entries(file)
                    .filter(([key, value]) => {
                      if (excludedKeys.has(key)) return false;
                      const formattedValue = formatFieldValue(key, value);
                      return (
                        formattedValue !== null && formattedValue !== undefined
                      );
                    })
                    .map(([key, value]) => {
                      const displayName = fieldMappings[key] || key;
                      const formattedValue = formatFieldValue(key, value);

                      return (
                        <span
                          key={key}
                          data-label={displayName}
                          data-value={formattedValue}
                        />
                      );
                    })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </Dialog>
  );
}
