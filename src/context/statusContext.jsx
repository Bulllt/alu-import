import React, { createContext, useState } from "react";
import StatusMessage from "../components/statusMessage.jsx";

export const StatusContext = createContext();

export function StatusProvider({ children }) {
  const [status, setStatus] = useState(null);

  const showStatusMessage = (type, message) => {
    setStatus({ type, message });
  };

  const clearStatus = () => {
    setStatus(null);
  };

  return (
    <StatusContext.Provider value={{ showStatusMessage }}>
      {children}
      {status && (
        <StatusMessage
          type={status.type}
          message={status.message}
          onDismiss={clearStatus}
        />
      )}
    </StatusContext.Provider>
  );
}
