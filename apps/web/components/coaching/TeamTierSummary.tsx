"use client";
import { useEffect, useState } from "react";
import { requestApi } from "../../lib/apiClient";

type Tier = {status: string; name: string | null; as_of: string | null; icon_url?: string | null};
type Tiers = {current: Tier; highest: Tier};
const dateLabel = (value: string | null) => {
  if (!value) return "";
  const date = new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z");
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ko-KR", {timeZone:"Asia/Seoul", month:"numeric",day:"numeric"});
};

export function TeamTierSummary({ ouid }: {ouid: string}) {
  const [state, setState] = useState<{ouid: string; data: Tiers | null} | null>(null);
  useEffect(() => {
    let active = true;
    requestApi<Tiers>(`/users/divisions?ouid=${encodeURIComponent(ouid)}`).then(data => {
      if (active) setState({ouid, data});
    }).catch(() => { if (active) setState({ouid, data: null}); });
    return () => { active = false; };
  }, [ouid]);
  const loaded = state?.ouid === ouid;
  const data = loaded ? state.data : null;
  return <aside className="team-tier-summary" aria-label="1대1 공식경기 티어" aria-busy={!loaded}>
    {([['current', '현재 티어'], ['highest', '최고 티어']] as const).map(([key, label]) => {
      const tier = data?.[key];
      const date = dateLabel(tier?.as_of ?? null);
      return <div className={`team-tier-card tier-${key}`} key={key}>
        <div className="team-tier-card-top"><span>{label}</span>{tier?.icon_url && <img src={tier.icon_url} alt="" width={52} height={52} decoding="async" onError={event => { event.currentTarget.hidden = true; }} />}</div>
        <strong>{!loaded ? "조회 중…" : tier?.name ?? "확인 안 됨"}</strong>
        <small>{key === 'current' ? `최근 공식경기${date ? ` · ${date}` : ''}` : `공식경기 최고${date ? ` · ${date} 달성` : ''}`}</small>
      </div>;
    })}
  </aside>;
}
