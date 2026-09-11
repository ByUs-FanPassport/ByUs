"use client";

import { useId } from "react";
import type { AdminLocale } from "../../../components/admin/operations-shell";
import styles from "./analytics-dashboard.module.css";

export type AnalyticsChartPoint = { label: string; value: number };

export function AnalyticsLineChart({
  points,
  label,
  locale = "ko",
}: {
  points: AnalyticsChartPoint[];
  label: string;
  locale?: AdminLocale;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const ko = locale === "ko";
  if (points.length === 0) {
    return (
      <div className={styles.chartEmpty}>
        <strong>{ko ? "기간 데이터가 없습니다" : "No data in this period"}</strong>
        <p>{ko ? "다른 기간을 선택해 확인해 주세요." : "Choose a different period."}</p>
      </div>
    );
  }

  const width = 720;
  const height = 240;
  const left = 48;
  const right = 16;
  const top = 16;
  const bottom = 40;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const rawMax = Math.max(...points.map((point) => point.value));
  const tickStep = Math.max(1, Math.ceil(rawMax / 4));
  const axisMax = tickStep * 4;
  const ticks = Array.from({ length: 5 }, (_, index) => tickStep * (4 - index));
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? left + plotWidth / 2 : left + (plotWidth * index) / (points.length - 1),
    y: top + plotHeight - (point.value / axisMax) * plotHeight,
  }));
  const polyline = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const description = ko
    ? `${label}, 최대 ${rawMax.toLocaleString("ko-KR")}, ${points.length}개 시점`
    : `${label}, maximum ${rawMax.toLocaleString("en")}, ${points.length} points`;

  return (
    <div className={styles.lineChart}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descriptionId}`}>
        <title id={titleId}>{label}</title>
        <desc id={descriptionId}>{description}</desc>
        {ticks.map((tick, index) => {
          const y = top + (plotHeight * index) / 4;
          return (
            <g key={`${tick}-${index}`}>
              <line className={styles.chartGridLine} x1={left} x2={width - right} y1={y} y2={y} />
              <text className={styles.chartAxisLabel} x={left - 10} y={y + 4} textAnchor="end">{tick}</text>
            </g>
          );
        })}
        {rawMax > 0 && <polyline className={styles.chartLine} points={polyline} />}
        {coordinates.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle className={styles.chartPoint} cx={point.x} cy={point.y} r="4">
              <title>{point.label}: {point.value.toLocaleString(locale)}</title>
            </circle>
            {(index === 0 || index === coordinates.length - 1 || index === Math.floor(coordinates.length / 2)) && (
              <text className={styles.chartAxisLabel} x={point.x} y={height - 13}
                textAnchor={index === 0 ? "start" : index === coordinates.length - 1 ? "end" : "middle"}>
                {point.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      {rawMax === 0 && <p className={styles.zeroNote}>{label}: 0</p>}
      <details className={styles.chartData}>
        <summary>{ko ? "수치로 보기" : "View values"}</summary>
        <table>
          <thead><tr><th>{ko ? "시점" : "Period"}</th><th>{label}</th></tr></thead>
          <tbody>{points.map((point, index) => <tr key={`${point.label}-${index}`}><td>{point.label}</td><td>{point.value}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
