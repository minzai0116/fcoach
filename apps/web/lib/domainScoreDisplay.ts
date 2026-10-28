export const scorePoint = (value: number | null, digits = 0) => value == null ? "—" : value.toFixed(digits);
export const scoreDifference = (value: number | null, reference: number | null, digits = 1) => {
  if (value == null || reference == null) return "—";
  const gap = value - reference;
  const magnitude = Number(Math.abs(gap).toFixed(digits));
  return `${magnitude === 0 ? "" : gap > 0 ? "+" : "−"}${magnitude.toFixed(digits)}점`;
};
