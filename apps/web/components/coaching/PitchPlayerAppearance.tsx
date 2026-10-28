"use client";

import type { PlayerReportEntry } from "../../types/analysis";
import type { PitchPlayer } from "../../lib/pitchLineup";
import { PlayerPortrait } from "../player/PlayerPortrait";
import { OfficialPlayerBadges } from "../player/OfficialPlayerBadges";
import { newPlayerTraits, traitSourceLabel } from "../../lib/playerTraits";

export function PitchPlayerAppearance({ player, report }: { player: PitchPlayer; report?: PlayerReportEntry }) {
  const source = player.traitSource ?? player.settings;
  const traits = newPlayerTraits(source);
  const sourceLabel = traitSourceLabel(source, player.grade);
  const seasonImg = report?.season_img || source?.season_img;
  const seasonName = player.record?.season_name || source?.season_code || "선수";
  return <>
    <span className="pitch-saved-traits" aria-label={traits.length ? "신규 특성" : undefined}>
      {traits.map(feature => <img key={feature.code} src={feature.icon_url!} alt={feature.label} title={feature.label}
        onError={event => { event.currentTarget.style.visibility = "hidden"; }} />)}
      {!!traits.length && sourceLabel && <span className="pitch-trait-source" title="선택한 피드에 저장된 강화 단계의 특성">{sourceLabel}</span>}
    </span>
    <span className="pitch-photo-area">
      <span className="pitch-card-left">
        {player.settings?.overall != null && <b className="pitch-overall" title="피드 능력치">{player.settings.overall}</b>}
        <span className="pitch-position">{player.position}<span className="pitch-state-dot" aria-hidden="true" /></span>
      </span>
      <PlayerPortrait player={report ?? { sp_id: player.spId, face_img: "", action_img: "", fallback_img: "" }}
        preferredImage={player.portraitImage} actionFirst alt="" className="pitch-portrait" />
      <span className="pitch-card-right">
        {player.settings?.salary != null && <span className="pitch-salary" aria-label={`급여 ${player.settings.salary}`} title={`급여 ${player.settings.salary}`}><span>{player.settings.salary}</span></span>}
        {player.grade != null && <OfficialPlayerBadges grade={player.grade} />}
      </span>
    </span>
    <span className="pitch-player-caption">
      {seasonImg && <img className="pitch-season" src={seasonImg} alt={`${seasonName} 시즌`} title={seasonName} />}
      <strong className="pitch-name-full">{player.name}</strong>
      <strong className="pitch-name-short">{player.name.trim().split(/\s+/).at(-1)}</strong>
    </span>
  </>;
}
