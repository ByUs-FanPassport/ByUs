"use client";

import { Download, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { AdminLocale } from "../../../components/admin/operations-shell";
import styles from "./analytics-dashboard.module.css";

export type PerformanceColumn<Row> = {
  key: string;
  label: string;
  value: (row: Row) => string | number;
  render?: (row: Row) => ReactNode;
};

function safeSpreadsheetValue(value: string | number) {
  const text = String(value);
  return /^[\t\r\n]/.test(text) || /^[\s]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
}

function quoteCsv(value: string | number) {
  return `"${safeSpreadsheetValue(value).replaceAll('"', '""')}"`;
}

export function createCsv<Row>(columns: PerformanceColumn<Row>[], rows: Row[]) {
  const lines = [
    columns.map((column) => quoteCsv(column.label)).join(","),
    ...rows.map((row) =>
      columns.map((column) => quoteCsv(column.value(row))).join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/csv;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PerformanceTable<Row>({
  columns,
  rows,
  rowKey,
  title,
  filename,
  locale,
}: {
  columns: PerformanceColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  title: string;
  filename: string;
  locale: AdminLocale;
}) {
  const ko = locale === "ko";
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState(columns[0]?.key ?? "");
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const filteredRows = useMemo(() => {
    const matching = normalizedQuery
      ? rows.filter((row) =>
          columns.some((column) =>
            String(column.value(row))
              .toLocaleLowerCase(locale)
              .includes(normalizedQuery),
          ),
        )
      : rows;
    const column = columns.find((item) => item.key === sortKey);
    if (!column) return matching;
    return [...matching].sort((left, right) => {
      const a = column.value(left);
      const b = column.value(right);
      const order =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), locale, {
              numeric: true,
              sensitivity: "base",
            });
      return descending ? -order : order;
    });
  }, [columns, descending, locale, normalizedQuery, rows, sortKey]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  function updateQuery(next: string) {
    setQuery(next);
    setPage(1);
  }
  function updateSort(next: string) {
    setSortKey(next);
    setPage(1);
  }

  return (
    <>
      <div className={styles.tableTools}>
        <label className={styles.searchField}>
          <span className={styles.srOnly}>
            {ko ? `${title} 검색` : `Search ${title}`}
          </span>
          <Search aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            placeholder={ko ? "이름 또는 수치 검색" : "Search names or values"}
          />
        </label>
        <label className={styles.sortField}>
          <span>{ko ? "정렬" : "Sort"}</span>
          <select value={sortKey} onChange={(event) => updateSort(event.target.value)}>
            {columns.map((column) => (
              <option key={column.key} value={column.key}>{column.label}</option>
            ))}
          </select>
        </label>
        <button
          className={styles.sortDirection}
          type="button"
          aria-pressed={descending}
          onClick={() => { setDescending((value) => !value); setPage(1); }}
        >
          {descending ? (ko ? "내림차순" : "Descending") : (ko ? "오름차순" : "Ascending")}
        </button>
        <button
          className={styles.exportButton}
          type="button"
          disabled={filteredRows.length === 0}
          onClick={() => downloadCsv(filename, createCsv(columns, filteredRows))}
        >
          <Download aria-hidden="true" />
          CSV
        </button>
      </div>
      <p className={styles.resultCount} role="status">
        {ko
          ? `전체 ${rows.length.toLocaleString("ko-KR")}건 중 ${filteredRows.length.toLocaleString("ko-KR")}건`
          : `${filteredRows.length.toLocaleString("en")} of ${rows.length.toLocaleString("en")} rows`}
      </p>
      {filteredRows.length === 0 ? (
        <div className={styles.tableEmpty}>
          <strong>{rows.length === 0 ? (ko ? "집계된 데이터가 없습니다" : "No aggregated data") : (ko ? "검색 결과가 없습니다" : "No matching rows")}</strong>
          <p>{rows.length === 0 ? (ko ? "선택한 기간에 기록된 항목이 없습니다." : "No records exist in the selected period.") : (ko ? "검색어를 바꿔 다시 확인해 주세요." : "Try a different search term.")}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => <td key={column.key}>{column.render?.(row) ?? column.value(row)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filteredRows.length > pageSize && (
        <div className={styles.pagination}>
          <button type="button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
            {ko ? "이전" : "Previous"}
          </button>
          <span>{ko ? `${safePage} / ${pageCount}페이지` : `Page ${safePage} of ${pageCount}`}</span>
          <button type="button" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)}>
            {ko ? "다음" : "Next"}
          </button>
        </div>
      )}
    </>
  );
}
