export const FC_TACTIC_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const SET_PIECE_OPTIONS = [1, 2, 3, 4, 5];
export const DEFENSE_STYLE_OPTIONS = ["후퇴", "밸런스", "볼터치 실수시 압박", "공 뺏긴 직후 압박", "지속적인 압박"];
export const TACTIC_STYLE_OPTIONS = ["짧은 패스", "밸런스", "긴 패스", "빠른 빌드업"];

export function tacticBandLabel(value: number, field: "defenseWidth" | "defenseDepth" | "attackWidth" | "boxPlayers"): string {
  if (field === "defenseWidth") {
    if (value <= 3) return "중앙 압축형";
    if (value <= 7) return "균형";
    return "측면 커버형";
  }
  if (field === "defenseDepth") {
    if (value <= 3) return "깊은 라인";
    if (value <= 7) return "균형";
    return "높은 라인";
  }
  if (field === "attackWidth") {
    if (value <= 3) return "중앙 연계형";
    if (value <= 7) return "균형";
    return "측면 확장형";
  }
  if (value <= 3) return "역습 대비형";
  if (value <= 7) return "균형";
  return "박스 침투형";
}

export function setPieceLabel(value: number): string {
  if (value <= 2) return "수비적";
  if (value === 3) return "균형";
  return "공격적";
}

export function normalizeTacticStyleLabel(value: string): string {
  if (value === "느린 빌드업") return "짧은 패스";
  return value;
}
