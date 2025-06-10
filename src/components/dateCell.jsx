import React, { useState, useRef, useEffect } from "react";
import { Calendar } from "primereact/calendar";
import { Dropdown } from "primereact/dropdown";
import "./styles/dateCell.css";

export default function DateCell({ file, onChange, onComplete }) {
  const [datePrecision, setDatePrecision] = useState(
    file.datePrecision || null
  );
  const [internalDate, setInternalDate] = useState(
    file.date ? new Date(file.date) : null
  );
  const [editPhase, setEditPhase] = useState("precision");
  const [lastPrecisionClicked, setLastPrecisionClicked] = useState(null);
  const calendarRef = useRef(null);

  const precisionOptions = [
    { label: "Año", value: "year" },
    { label: "Año y Mes", value: "month" },
    { label: "Fecha Completa", value: "full" },
  ];

  useEffect(() => {
    let yearDropdown = null;

    const attachListener = () => {
      const calendarEl = document.querySelector(".p-datepicker");
      if (!calendarEl) {
        return;
      }

      yearDropdown = calendarEl.querySelector(".p-datepicker-year");

      if (yearDropdown) {
        if (datePrecision === "year") {
          yearDropdown.addEventListener("change", handleYearDropdownSelect);
        }
      }
    };

    const timeoutId = setTimeout(attachListener, 200);

    return () => {
      clearTimeout(timeoutId);
      if (yearDropdown) {
        yearDropdown.removeEventListener("change", handleYearDropdownSelect);
      }
    };
  }, [editPhase]);

  const handleYearDropdownSelect = (e) => {
    const selectedYear = parseInt(e.target.value);

    if (!isNaN(selectedYear)) {
      const newDate = new Date(selectedYear, 0, 1);
      setInternalDate(newDate);
      updateParent(newDate, "year");
      onComplete();
    }
  };

  const getViewOptions = () => ({
    yearNavigator: true,
    yearRange: "1700:2030",
    hideOnDateTimeSelect: true,
    ...(datePrecision === "year" && { view: "year", monthNavigator: false }),
    ...(datePrecision === "month" && { view: "month", monthNavigator: true }),
    ...(datePrecision === "full" && {
      view: "date",
      monthNavigator: true,
      showOtherMonths: true,
    }),
  });

  const handlePrecisionChange = (e) => {
    const newPrecision = e.value;
    setDatePrecision(newPrecision);
    setEditPhase("calendar");
  };
  const handleDropdownClick = () => {
    if (datePrecision && lastPrecisionClicked === datePrecision) {
      setEditPhase("calendar");
    }
    setLastPrecisionClicked(datePrecision);
  };

  const handleDateChange = (e) => {
    if (!e.value) return;

    const date = e.value;
    setInternalDate(date);
    updateParent(date, datePrecision);
    onComplete();
  };

  const handleCalendarClose = (e) => {
    if (e && calendarRef.current && !calendarRef.current.contains(e.target)) {
      if (!internalDate) {
        setDatePrecision(null);
      }
      onComplete();
    }
  };

  const updateParent = (date, precision) => {
    onChange({
      date: date,
      year: date.getFullYear(),
      month: precision === "year" ? "" : date.getMonth() + 1,
      day: precision === "full" ? date.getDate() : "",
      datePrecision: precision,
    });
  };

  return (
    <div ref={calendarRef} onClick={(e) => e.stopPropagation()}>
      {editPhase === "precision" && (
        <Dropdown
          value={datePrecision}
          options={precisionOptions}
          onChange={handlePrecisionChange}
          onClick={handleDropdownClick}
          placeholder="Formato"
          appendTo="self"
          autoFocus
        />
      )}

      {editPhase === "calendar" && datePrecision && (
        <Calendar
          value={internalDate}
          onChange={handleDateChange}
          onBlur={handleCalendarClose}
          onHide={handleCalendarClose}
          dateFormat={
            datePrecision === "full"
              ? "dd/mm/yy"
              : datePrecision === "month"
              ? "mm/yy"
              : "yy"
          }
          showIcon
          locale="es"
          {...getViewOptions()}
          autoFocus
        />
      )}
    </div>
  );
}
