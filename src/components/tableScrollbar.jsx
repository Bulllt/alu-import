import React, { useState, useEffect } from "react";
import "./styles/tableScrollbar.css";

export default function TableScrollbar({ tableRef }) {
  const [showScroll, setShowScroll] = useState(false);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;

    const checkScroll = () => {
      setShowScroll(table.scrollWidth > table.clientWidth);
    };

    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [tableRef]);

  const handleScroll = (e) => {
    tableRef.current.scrollLeft = e.target.scrollLeft;
  };

  return showScroll ? (
    <div className="floatingScroll" onScroll={handleScroll}>
      <div style={{ width: tableRef.current?.scrollWidth }} />
    </div>
  ) : null;
}
