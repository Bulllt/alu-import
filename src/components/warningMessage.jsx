import React from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";

import "./styles/warningMessage.css";
import { IoIosWarning } from "react-icons/io";
import "primeicons/primeicons.css";

export default function WarningMessage({
  visible,
  onHide,
  onConfirm,
  message,
  showExitButton,
}) {
  const footer = (
    <div className="warningFooter">
      <Button
        label="Atrás"
        icon="pi pi-arrow-left"
        className="warningButton"
        onClick={onHide}
      />
      {showExitButton && (
        <Button
          label="Salir"
          icon="pi pi-sign-out"
          className="warningButton"
          onClick={onConfirm}
          autoFocus
        />
      )}
    </div>
  );

  return (
    <Dialog
      visible={visible}
      style={{ width: "40vw" }}
      footer={footer}
      onHide={onHide}
      dismissableMask
    >
      <div className="warningContainer">
        <IoIosWarning className="warningIcon" size={100} />
        <p className="warningDescription">{message}</p>
      </div>
    </Dialog>
  );
}
