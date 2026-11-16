"use client";
import { useEffect, useState } from "react";
import { requestApi } from "../../lib/apiClient";
import { currentTierLabel, tierDateLabel, type UserDivisions } from "../../lib/userDivisions";

export function TeamTierSummary({ ouid }: {ouid: string}) {
  const [state, setState] = useState<{ouid: string; data: UserDivisions | null} | null>(null);
  useEffect(() => {
    let active = true;
    requestApi<UserDivisions>(`/users/divisions?ouid=${encodeURIComponent(ouid)}`).then(data => {
      if (active) setState({ouid, data});
    }).catch(() => { if (active) setState({ouid, data: null}); });
    return () => { active = false; };
  }, [ouid]);
  const loaded = state?.ouid === ouid;
  const data = loaded ? state.data : null;
  return <aside className="team-tier-summary" aria-label="1대1 공식경기 티어" aria-busy={!loaded}>
    {([['current', '현재 티어'], ['highest', '최고 티어']] as const).map(([key, label]) => {
      const tier = data?.[key];
      const date = tierDateLabel(tier?.as_of);
      return <div className={`team-tier-card tier-${key}`} key={key}>
        <div className="team-tier-card-top"><span>{label}</span>{tier?.icon_url && <img src={tier.icon_url} alt="" width={52} height={52} decoding="async" onError={event => { event.currentTarget.hidden = true; }} />}</div>
        <strong>{!loaded ? "조회 중…" : key === 'current' ? currentTierLabel(tier) : tier?.name ?? "확인 안 됨"}</strong>
        <small>{key === 'current' ? `이번 시즌 공식경기${date ? ` · ${date} 기준` : ''}` : `공식경기 최고${date ? ` · ${date} 달성` : ''}`}</small>
      </div>;
    })}
  </aside>;
}
