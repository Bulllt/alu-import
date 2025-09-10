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

    const handleWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const scrollAmount = e.deltaY * 2;
        table.scrollLeft += scrollAmount;

        const floatingScroll = document.querySelector(".floatingScroll");
        if (floatingScroll) {
          floatingScroll.scrollLeft = table.scrollLeft;
        }
      }
    };

    checkScroll();

    window.addEventListener("resize", checkScroll);
    table.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("resize", checkScroll);
      table.removeEventListener("wheel", handleWheel);
    };
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
