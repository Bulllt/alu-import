import React from "react";

import { FaSpinner } from "react-icons/fa";
import "./styles/loadingModal.css";

export default function LoadingModal({ progress }) {
  const isComplete = progress.percent === 100;

  return (
    <div className="loadingModal">
      <div className="loadingModalContent">
        <div className="loadingModalHeader">
          <h2>Se están importando los archivos</h2>
        </div>

        <div className="loadingModalBody">
          <FaSpinner
            className={`loadingSpinner ${isComplete ? "completeSpin" : ""}`}
            size={40}
          />

          <div>{progress.stage}</div>

          <div className="progressContainer">
            <div
              className={`progressBar ${isComplete ? "complete" : ""}`}
              style={{ width: `${progress.percent}%` }}
            ></div>
          </div>

          <span className="progressText">
            {progress.percent}%
            {isComplete && <span className="checkmark"> ✓</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
