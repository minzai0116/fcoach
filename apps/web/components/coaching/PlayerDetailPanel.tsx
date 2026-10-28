"use client";

import { useId, useState } from "react";
import type { PitchPlayer } from "../../lib/pitchLineup";
import type { PlayerReportEntry } from "../../types/analysis";
import { PlayerPortrait } from "../player/PlayerPortrait";
import { OfficialPlayerBadges } from "../player/OfficialPlayerBadges";
import { FeatureIcons } from "./FeatureIcons";
import { FeedPlayerSettings } from "./SquadFeedSettings";
import { PlayerCoachingSummary } from "./PlayerCoachingSummary";
import { PlayerRecordDetails } from "./PlayerRecordDetails";
import { newPlayerTraits, traitSourceLabel } from "../../lib/playerTraits";

export function PlayerDetailPanel({ player, report, observation, id, onBack }: {
  player?: PitchPlayer; report?: PlayerReportEntry; observation: boolean; id: string; onBack: () => void;
}) {
  const [tab, setTab] = useState("record");
  const tabId = useId();
  const source = player?.traitSource ?? player?.settings;
  const savedTraits = newPlayerTraits(source);
  const sourceLabel = traitSourceLabel(source, player?.grade ?? null);

  function moveTab(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["record", "settings", "coaching"];
    let index = keys.indexOf(tab);
    if (event.key === "ArrowRight") index = (index + 1) % keys.length;
    else if (event.key === "ArrowLeft") index = (index + keys.length - 1) % keys.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = keys.length - 1;
    else return;
    event.preventDefault(); setTab(keys[index]);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }
  return <div className="selected-player-detail" id={id} role="region" aria-label="선택한 선수 상세">
    <button type="button" className="mobile-detail-back" onClick={onBack}>← 포메이션으로 돌아가기</button>
    {!player ? <p>포메이션에서 선수를 선택하세요.</p> : <>
      <header className="selected-player-header">
        <PlayerPortrait player={report ?? { sp_id: player.spId, face_img: "", action_img: "", fallback_img: "" }} preferredImage={player.portraitImage} actionFirst alt="" className="selected-player-portrait" />
        <div className="selected-player-identity"><span className="coaching-eyebrow">{player.position} · {player.record ? `${player.record.appearances}경기` : "경기 기록 없음"}</span><h4>{player.name}</h4>
          <OfficialPlayerBadges seasonImg={report?.season_img || player.settings?.season_img} seasonName={player.record?.season_name || player.settings?.season_code} grade={player.grade} />
          {player.settings?.overall != null && <span className="player-saved-overall">능력치 {player.settings.overall}</span>}
        </div>
        {player.comparison && <span className={`coaching-badge ${player.comparison.linked ? "feed-matched" : "muted-badge"}`}>{player.comparison.linked ? "피드 연결" : savedTraits.length ? "피드 특성" : "연결 보류"}</span>}
      </header>
      <div className="player-detail-tabs" role="tablist" aria-label="선수 상세 항목" onKeyDown={moveTab}>{[["record", "경기 기록"], ["settings", "설정·특성"], ["coaching", "종합 코칭"]].map(([key, label]) => <button key={key} id={`${tabId}-${key}`} type="button" role="tab" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls={`${tabId}-panel`} onClick={() => setTab(key)}>{label}</button>)}</div>
      <div className="player-detail-body" role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} key={`${player.key}:${tab}`}>
        {tab === "record" && (player.record ? <PlayerRecordDetails player={player.record} observation={observation} /> : <p>같은 카드·강화·자리의 경기 기록이 없습니다.</p>)}
        {tab === "settings" && (player.settings ? <>
          <div className="player-settings-features">{([["intrinsic_features", "기본 특성"], ["acquired_traits", "획득 특성"], ["training_coach", "훈련코치"]] as const).map(([key, label]) => {
            const setting = player.settings![key];
            return <section key={key}><h5>{label}</h5>{setting?.status === "present" ? <FeatureIcons features={setting.value ?? []} label={label} /> : <p className="feed-value-state">{setting?.status === "unset" ? "피드에서 미설정" : "피드에서 확인 불가"}</p>}</section>;
          })}</div>
          <FeedPlayerSettings player={player.settings} includeFeatures={false} />
        </> : <>
          {!!savedTraits.length && <section><h5>피드에 저장된 신규 특성{sourceLabel && ` · ${sourceLabel}`}</h5><FeatureIcons features={savedTraits} label="피드에 저장된 신규 특성" /></section>}
          <p className="feed-value-state">{player.comparison?.label ?? "연결된 피드 설정이 없습니다."}</p>
        </>)}
        {tab === "coaching" && <PlayerCoachingSummary guidance={player.comparison?.guidance ?? player.record?.guidance} />}
      </div>
    </>}
  </div>;
}
