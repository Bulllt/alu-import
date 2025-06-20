import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";

import { FaUndo, FaCheck } from "react-icons/fa";
import "./styles/rollbackButton.css";

export default function RollbackButton() {
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [confirmStep, setConfirmStep] = useState(0);

  useEffect(() => {
    const checkLastImport = async () => {
      const hasLastImport = await window.electronAPI.hasLastImport();
      setIsVisible(hasLastImport);
    };
    checkLastImport();
  }, [location]);

  const handleRollback = async () => {
    if (confirmStep === 1) {
      try {
        setIsVisible(false);
        await window.electronAPI.importRollback();
        setConfirmStep(0);
      } catch (error) {
        setIsVisible(true);
        console.error("Rollback failed:", error);
      }
    } else {
      setConfirmStep(1);
      setTimeout(() => setConfirmStep(0), 3000);
    }
  };

  if (!isVisible) return null;

  return (
    <div
      className={`rollbackContainer ${isHovered ? "hovered" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="rollbackContent">
        {isHovered && (
          <span className="rollbackText">Borrar la última importación?</span>
        )}
        <button
          className={`rollbackButton ${confirmStep === 1 ? "confirm" : ""}`}
          onClick={handleRollback}
        >
          {confirmStep === 1 ? <FaCheck /> : <FaUndo />}
        </button>
      </div>
    </div>
  );
}
