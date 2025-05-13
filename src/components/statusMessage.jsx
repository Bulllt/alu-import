import React, { useEffect, useState } from "react";
import { FaTimes, FaCheckCircle, FaExclamationTriangle } from "react-icons/fa";
import "./styles/statusMessage.css";

export default function StatusMessage({ type, message, onDismiss }) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onDismiss?.();
    }, 5000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  if (!isVisible) return null;

  return (
    <div className={`alert ${type}`}>
      <div className="alertContent">
        <div className="alertMessage">
          {type === "success" ? (
            <FaCheckCircle className="alertIcon" />
          ) : (
            <FaExclamationTriangle className="alertIcon" />
          )}
          <span>{message}</span>
        </div>
        <button
          type="button"
          className="alertClose"
          onClick={() => setIsVisible(false)}
        >
          <FaTimes />
        </button>
      </div>
    </div>
  );
}
