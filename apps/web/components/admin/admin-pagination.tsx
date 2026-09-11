"use client";

import { useState } from "react";
import type { AdminLocale } from "./operations-shell";
import styles from "./admin-pagination.module.css";

export function useAdminPagination<T>(items: readonly T[], resetKey = "", pageSize = 20) {
  const [selection, setSelection] = useState({ key: resetKey, page: 1 });
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = selection.key === resetKey ? Math.min(selection.page, pageCount) : 1;
  // Keep the clamped page when a refresh removes the last item or filters change.
  if (selection.key !== resetKey || selection.page !== page) setSelection({ key: resetKey, page });
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    page, pageSize, total: items.length,
    onPageChange: (next: number) => setSelection({ key: resetKey, page: Math.max(1, Math.min(next, pageCount)) }),
  };
}

export function AdminPagination({ page, pageSize, total, onPageChange, locale, disabled = false, label }: {
  page: number; pageSize: number; total: number; onPageChange: (page: number) => void;
  locale: AdminLocale; disabled?: boolean; label?: string;
}) {
  if (total === 0) return null;
  const count = Math.ceil(total / pageSize);
  const start = Math.max(1, Math.min(page - 1, count - 2));
  const numbers = Array.from({ length: Math.min(3, count) }, (_, index) => start + index);
  const ko = locale === "ko";
  return <nav className={styles.pagination} aria-label={label ?? (ko ? "페이지 이동" : "Pagination")}>
    <span aria-live="polite" aria-atomic="true">{ko ? `전체 ${total}건 중 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)}건` : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
    {count > 1 && <div className={styles.controls}>
      <button type="button" disabled={disabled || page === 1} onClick={() => onPageChange(1)} aria-label={ko ? "첫 페이지" : "First page"}>«</button>
      <button type="button" disabled={disabled || page === 1} onClick={() => onPageChange(page - 1)} aria-label={ko ? "이전 페이지" : "Previous page"}>‹</button>
      {numbers.map(number => <button type="button" key={number} aria-label={ko ? `${number}페이지` : `Page ${number}`} aria-current={number === page ? "page" : undefined} disabled={disabled} onClick={() => onPageChange(number)}>{number}</button>)}
      <button type="button" disabled={disabled || page === count} onClick={() => onPageChange(page + 1)} aria-label={ko ? "다음 페이지" : "Next page"}>›</button>
      <button type="button" disabled={disabled || page === count} onClick={() => onPageChange(count)} aria-label={ko ? "마지막 페이지" : "Last page"}>»</button>
    </div>}
  </nav>;
}

export function AdminListSearch({ value, onChange, locale, disabled = false }: {
  value: string; onChange: (value: string) => void; locale: AdminLocale; disabled?: boolean;
}) {
  const label = locale === "ko" ? "목록 검색" : "Search list";
  return <label className={styles.search}><span>{label}</span><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={label} disabled={disabled} /></label>;
}
