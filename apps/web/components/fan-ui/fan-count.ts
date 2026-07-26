const fanCountFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatFanCount(value: number): string {
  return `${fanCountFormatter.format(value)} Fans`;
}
