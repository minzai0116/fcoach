export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function PercentageBar({ value, reference, tone = "blue" }: { value: number | null; reference?: number; tone?: "blue" | "amber" }) {
  return (
    <span className={`coaching-bar ${tone}${value === null ? " empty" : ""}`} aria-hidden="true">
      {value !== null && <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />}
      {reference !== undefined && <i style={{ left: `${Math.max(0, Math.min(100, reference * 100))}%` }} />}
    </span>
  );
}

export function SuccessRing({ value, label = "성공률" }: { value: number | null; label?: string }) {
  return (
    <div className="coaching-ring" role="img" aria-label={`${label} ${value === null ? "기록 없음" : formatPercent(value)}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" stroke="#e7edf3" strokeWidth="9" />
        {value !== null && <circle cx="50" cy="50" r="42" fill="none" stroke="#2563eb" strokeWidth="9" pathLength="100" strokeDasharray={`${value * 100} 100`} transform="rotate(-90 50 50)" />}
      </svg>
      <span><strong>{formatPercent(value)}</strong><small>{label}</small></span>
    </div>
  );
}
