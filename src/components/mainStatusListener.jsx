import React, { useContext, useEffect } from "react";
import { StatusContext } from "../context/statusContext.jsx";

export default function MainStatusListener() {
  const { showStatusMessage } = useContext(StatusContext);
  useEffect(() => {
    const removeListener = window.electronAPI.onStatusMessage(
      ({ type, message }) => {
        showStatusMessage(type, message);
      }
    );

    return () => {
      if (removeListener) removeListener();
    };
  }, [showStatusMessage]);

  return null;
}
