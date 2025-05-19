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
        <h4>Se importarán {filesToImport.length} archivos:</h4>
        <div className="filesContainer">
          {filesToImport.map((file, index) => (
            <div key={index} className="file">
              <div className="fileName">{file.code}</div>
              <div className="fileDetails">
                <span>Colección: {file.collection_id}</span>
                <span>Fecha: {formatDate(file)}</span>
                <span>Censurado: {file.censored ? "Sí" : "No"}</span>
                <span>Publicado: {file.published ? "Sí" : "No"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
