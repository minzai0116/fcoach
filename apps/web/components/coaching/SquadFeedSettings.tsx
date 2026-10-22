import type { ReactNode } from "react";
import type { FeedPlayer, FeedSetting, SquadFeedSnapshot } from "../../types/squadFeed";
import { PercentageBar } from "./CoachingVisuals";
import { FeatureIcons } from "./FeatureIcons";

export const FEED_STATUS = { present: "피드에 저장됨", unset: "피드에서 미설정", missing: "피드에 값 없음", invalid: "값 확인 불가" };

export function FeedValue<T>({ setting, children }: { setting: FeedSetting<T>; children: (value: T) => ReactNode }) {
  return setting.status === "present" && setting.value !== null ? children(setting.value) : <span className="feed-value-state">{FEED_STATUS[setting.status]}</span>;
}

export function FeedPlayerSettings({ player, includeFeatures = true }: { player: FeedPlayer; includeFeatures?: boolean }) {
  return <dl className="feed-player-settings">
    {includeFeatures && <><div><dt>기본 특성</dt><dd>{player.intrinsic_features ? <FeedValue setting={player.intrinsic_features}>{values => <FeatureIcons features={values} label="기본 특성" />}</FeedValue> : <FeedValue setting={player.intrinsic_traits}>{values => <FeatureIcons features={values.map(label => ({ label, code: null, known: false }))} label="기본 특성" />}</FeedValue>}</dd></div>
    <div><dt>획득 특성</dt><dd><FeedValue setting={player.acquired_traits}>{values => <FeatureIcons features={values} label="획득 특성" />}</FeedValue></dd></div>
    <div><dt>훈련코치 특성</dt><dd><FeedValue setting={player.training_coach}>{values => <FeatureIcons features={values} label="훈련코치 특성" />}</FeedValue></dd></div>
    </>}
    <div><dt>개인 전술</dt><dd><FeedValue setting={player.personal_tactics}>{values => values.map(v => v.label).join(" · ")}</FeedValue></dd></div>
    <div><dt>공/수 참여도</dt><dd><FeedValue setting={player.participation}>{values => `공격 ${values[0]} · 수비 ${values[1]} (1~3)`}</FeedValue></dd></div>
  </dl>;
}

export function SquadFeedSettings({ snapshot, teamOnly = false }: { snapshot: SquadFeedSnapshot; teamOnly?: boolean }) {
  return <div className="feed-snapshot-settings">
    <div className="feed-team-grid">{snapshot.team_tactics.map(setting => <div key={setting.key}>
      <span>{setting.label}</span><strong><FeedValue setting={setting}>{value => value}</FeedValue></strong>
      {typeof setting.value === "number" && setting.status === "present" && <><PercentageBar value={setting.value / (setting.key === "offcornerkick" || setting.key === "offfreekick" ? 5 : 10)} /><small>1~{setting.key === "offcornerkick" || setting.key === "offfreekick" ? 5 : 10} 기준</small></>}
    </div>)}</div>
    {!teamOnly && <details className="detail-block"><summary>피드 선수 {snapshot.players.length}명의 설정 보기</summary><div className="feed-record-list">
      {snapshot.players.map((player, index) => <details className="feed-record" key={`${player.sp_id}:${player.grade}:${player.position}:${index}`}><summary><strong>{player.lineup_role === "starter" ? "선발" : player.lineup_role === "substitute" ? "후보" : "선발 여부 미확인"} · {player.position ?? "자리 미제공"} · {player.name} +{player.grade ?? "?"}</strong></summary><FeedPlayerSettings player={player} /></details>)}
    </div></details>}

  </div>;
}
