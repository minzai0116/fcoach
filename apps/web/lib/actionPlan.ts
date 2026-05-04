import { normalizeTacticStyleLabel } from "./tactic";

export type CurrentTactic = {
  defenseWidth: number;
  defenseDepth: number;
  attackWidth: number;
  boxPlayers: number;
  defenseStyle?: string;
  buildupPlayStyle?: string;
  chanceCreationStyle?: string;
};

export type ActionGuide = {
  why: string;
  doNow: string;
  verify: string;
};

function clampToFcScale(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function formatFixed(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function isSameStyle(target: string, current?: string): boolean {
  if (!current) return false;
  return normalizeTacticStyleLabel(target).trim() === normalizeTacticStyleLabel(current).trim();
}

function normalizeAdjustmentMainLine(adjustments: string[]): string {
  const candidates = adjustments.filter((line) => line !== "권장 전술 변경 없음");
  if (candidates.length === 0) return "현재 전술 유지";
  const primary = candidates.find((line) => !line.startsWith("수비 스타일:") && !line.startsWith("빌드업 플레이:") && !line.startsWith("기회 만들기:"));
  return primary ?? candidates[0];
}

export function tacticAdjustmentLines(tacticDelta: Record<string, unknown>, current: CurrentTactic | null): string[] {
  const base = current ?? {
    defenseWidth: 0,
    defenseDepth: 0,
    attackWidth: 0,
    boxPlayers: 0,
  };
  const lines: string[] = [];
  if (typeof tacticDelta.defense_style_target === "string") {
    const target = String(tacticDelta.defense_style_target);
    if (!isSameStyle(target, current?.defenseStyle)) {
      lines.push(`수비 스타일: ${target}`);
    }
  }
  const buildupPlayStyleTarget =
    typeof tacticDelta.buildup_play_style_target === "string"
      ? normalizeTacticStyleLabel(String(tacticDelta.buildup_play_style_target))
      : typeof tacticDelta.buildup_style_target === "string"
        ? normalizeTacticStyleLabel(String(tacticDelta.buildup_style_target))
        : null;
  if (buildupPlayStyleTarget && !isSameStyle(buildupPlayStyleTarget, current?.buildupPlayStyle)) {
    lines.push(`빌드업 플레이: ${buildupPlayStyleTarget}`);
  }
  if (typeof tacticDelta.chance_creation_style_target === "string") {
    const target = normalizeTacticStyleLabel(String(tacticDelta.chance_creation_style_target));
    if (!isSameStyle(target, current?.chanceCreationStyle)) {
      lines.push(`기회 만들기: ${target}`);
    }
  }
  if (typeof tacticDelta.defense_width_delta === "number") {
    if (typeof tacticDelta.defense_width_target === "number") {
      const target = clampToFcScale(Number(tacticDelta.defense_width_target));
      lines.push(current ? `수비 폭 ${base.defenseWidth} → ${target}` : `수비 폭 목표: ${target}`);
    } else if (current) {
      lines.push(`수비 폭 ${base.defenseWidth} → ${clampToFcScale(base.defenseWidth + Number(tacticDelta.defense_width_delta))}`);
    } else {
      lines.push(`수비 폭 변화: ${Number(tacticDelta.defense_width_delta) > 0 ? "+" : ""}${Number(tacticDelta.defense_width_delta)}`);
    }
  }
  if (typeof tacticDelta.defense_depth_delta === "number") {
    if (typeof tacticDelta.defense_depth_target === "number") {
      const target = clampToFcScale(Number(tacticDelta.defense_depth_target));
      lines.push(current ? `수비 깊이 ${base.defenseDepth} → ${target}` : `수비 깊이 목표: ${target}`);
    } else if (current) {
      lines.push(`수비 깊이 ${base.defenseDepth} → ${clampToFcScale(base.defenseDepth + Number(tacticDelta.defense_depth_delta))}`);
    } else {
      lines.push(`수비 깊이 변화: ${Number(tacticDelta.defense_depth_delta) > 0 ? "+" : ""}${Number(tacticDelta.defense_depth_delta)}`);
    }
  }
  if (typeof tacticDelta.attack_width_delta === "number") {
    if (typeof tacticDelta.attack_width_target === "number") {
      const target = clampToFcScale(Number(tacticDelta.attack_width_target));
      lines.push(current ? `공격 폭 ${base.attackWidth} → ${target}` : `공격 폭 목표: ${target}`);
    } else if (current) {
      lines.push(`공격 폭 ${base.attackWidth} → ${clampToFcScale(base.attackWidth + Number(tacticDelta.attack_width_delta))}`);
    } else {
      lines.push(`공격 폭 변화: ${Number(tacticDelta.attack_width_delta) > 0 ? "+" : ""}${Number(tacticDelta.attack_width_delta)}`);
    }
  }
  if (typeof tacticDelta.box_players_delta === "number") {
    if (typeof tacticDelta.box_players_target === "number") {
      const target = clampToFcScale(Number(tacticDelta.box_players_target));
      lines.push(current ? `박스 안 쪽 선수 ${base.boxPlayers} → ${target}` : `박스 안 쪽 선수 목표: ${target}`);
    } else if (current) {
      lines.push(`박스 안 쪽 선수 ${base.boxPlayers} → ${clampToFcScale(base.boxPlayers + Number(tacticDelta.box_players_delta))}`);
    } else {
      lines.push(`박스 안 쪽 선수 변화: ${Number(tacticDelta.box_players_delta) > 0 ? "+" : ""}${Number(tacticDelta.box_players_delta)}`);
    }
  }
  if (Array.isArray(tacticDelta.quick_attack_off) && tacticDelta.quick_attack_off.length > 0) {
    lines.push(`빠른 공격 전술 해제 권장: ${tacticDelta.quick_attack_off.join(", ")}`);
  }
  if (typeof tacticDelta.cdm_stay_back === "boolean") {
    lines.push(`CDM 후방대기 ${tacticDelta.cdm_stay_back ? "켜기" : "끄기"}`);
  }
  if (lines.length === 0) lines.push("권장 전술 변경 없음");
  return lines;
}

export function oneLinePrescription(
  issueLabel: string,
  adjustments: string[],
  tacticInputKnown: boolean,
): string {
  const mainAdjustment = normalizeAdjustmentMainLine(adjustments);
  if (!tacticInputKnown) {
    return `${mainAdjustment} 방향을 다음 플레이 구간에서 테스트해 ${issueLabel} 개선 추세를 먼저 확인하세요.`;
  }
  return `${mainAdjustment}를 다음 플레이 구간 동안 고정 적용해 ${issueLabel}를 우선 교정하세요.`;
}

export function actionGuide(
  actionCode: string,
  gapValue: number,
  tacticDelta: Record<string, unknown>,
  tacticInputKnown: boolean,
): ActionGuide {
  if (actionCode === "HIGH_LATE_CONCEDE") {
    const target = typeof tacticDelta.defense_depth_target === "number" ? clampToFcScale(Number(tacticDelta.defense_depth_target)) : null;
    return {
      why: `후반 실점 비율이 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)} 차이입니다.`,
      doNow: tacticInputKnown
        ? `수비 스타일을 보수적으로 두고(후퇴/밸런스), 수비 깊이를 1단계 낮춰 목표 ${target ?? "권장값"}로 다음 플레이 구간 동안 고정하세요.`
        : `수비 스타일을 보수적으로 두고(후퇴/밸런스), 수비 깊이 -1 방향을 다음 플레이 구간에서 테스트하세요.`,
      verify: "다음 진단 때 후반 실점 비율이 최소 0.10 이상 내려가면 유지, 아니면 수비 폭을 1단계 추가 하향하세요.",
    };
  }
  if (actionCode === "LOW_FINISHING") {
    return {
      why: `유효슈팅 대비 득점률이 기준보다 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)} 차이입니다.`,
      doNow: "박스 안 쪽 선수 수치를 1단계 올리고, 공격 폭은 1단계 줄여 마무리 위치를 더 안쪽으로 유도하세요.",
      verify: "다음 진단 때 유효슈팅 대비 득점률이 기준치에 근접하면 유지합니다.",
    };
  }
  if (actionCode === "POOR_SHOT_SELECTION") {
    return {
      why: `박스 안 슈팅 비중이 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "빌드업 플레이를 짧은 패스/밸런스로 두고, 박스 안 쪽 선수·공격 폭을 각 1단계 낮춰 무리한 슛을 줄이세요.",
      verify: "다음 진단 때 박스 안 슈팅 비중과 유효슈팅 비율이 함께 상승하면 유지합니다.",
    };
  }
  if (actionCode === "OFFSIDE_RISK") {
    return {
      why: `오프사이드 평균이 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "공격 폭을 1단계 줄이고, 빠른 공격 전술(박스 안 침투/스트라이커 추가)은 필요 시점에만 사용하세요.",
      verify: "다음 진단 때 오프사이드 평균이 0.3 이상 감소하면 성공입니다.",
    };
  }
  if (actionCode === "BUILDUP_INEFFICIENCY") {
    return {
      why: `빌드업 핵심 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "빌드업 플레이를 짧은 패스로 두고 기회 만들기는 밸런스로 유지한 뒤, 공격 폭/박스 침투 수치를 1단계 낮춰 연결 안정성을 먼저 확보하세요.",
      verify: "다음 진단 때 패스·스루패스 성공률이 동시에 상승하면 유지합니다.",
    };
  }
  if (actionCode === "DEFENSE_DUEL_WEAKNESS") {
    return {
      why: `수비 경합 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "수비 폭과 수비 깊이를 1단계 낮춰 라인 간격을 줄이고, 1차 저지 안정화를 우선 적용하세요.",
      verify: "다음 진단 때 경기당 실점과 태클 성공률이 동시에 개선되면 유지합니다.",
    };
  }
  if (actionCode === "CHANCE_CREATION_LOW") {
    return {
      why: `찬스 생성 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "공격 폭과 박스 안 쪽 선수 수치를 각각 1단계 올려 슈팅 볼륨을 확보하세요.",
      verify: "다음 진단 때 경기당 xG 또는 슈팅수가 유의미하게 증가하면 유지합니다.",
    };
  }
  if (actionCode === "POSSESSION_CONTROL_RISK") {
    return {
      why: `점유 안정 지표가 기준 대비 ${gapValue >= 0 ? "+" : ""}${formatFixed(gapValue, 3)}입니다.`,
      doNow: "빌드업 플레이를 짧은 패스/밸런스로 설정하고 공격 폭을 1단계 줄여 볼 순환 안정성을 확보하세요.",
      verify: "다음 진단 때 점유율과 패스 성공률이 동시에 개선되면 유지합니다.",
    };
  }
  return {
    why: "고우선순위 이슈가 없어 현재 전술을 유지해도 됩니다.",
    doNow: "현재 세팅을 유지하고, 데이터가 쌓이면 다시 분석하세요.",
    verify: "다음 진단 때 승률/실점이 악화되면 그때 전술 코칭을 다시 적용합니다.",
  };
}
