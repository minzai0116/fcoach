"use client";

import { useId, useState } from "react";
import type { FeedFeature } from "../../types/squadFeed";

function FeatureButton({ feature, active, onSelect, descriptionId }: {
  feature: FeedFeature; active: boolean; onSelect: () => void; descriptionId: string;
}) {
  const [failed, setFailed] = useState(false);
  return <button type="button" className={`feature-icon ${active ? "selected" : ""}`} title={feature.label}
    aria-label={`${feature.label} 이름 보기`} aria-pressed={active} aria-controls={descriptionId} onClick={onSelect}>
    {feature.icon_url && !failed ? <img src={feature.icon_url} alt="" width={36} height={36} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : <span className="feature-icon-fallback" aria-hidden="true">?</span>}
  </button>;
}

export function FeatureIcons({ features, label }: { features: FeedFeature[]; label: string }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const descriptionId = useId();
  const selected = features.find(f => `${f.code}:${f.label}` === selectedKey);
  return <div className="feature-icons" role="group" aria-label={label} onKeyDown={event => { if (event.key === "Escape") setSelectedKey(null); }}>
    <div className="feature-icon-row">{features.map(f => {
      const key = `${f.code}:${f.label}`;
      return <FeatureButton key={`${key}:${f.icon_url}`} feature={f} active={key === selectedKey} descriptionId={descriptionId}
        onSelect={() => setSelectedKey(current => current === key ? null : key)} />;
    })}</div>
    <p id={descriptionId} className="feature-icon-name" role="status" aria-live="polite" hidden={!selected}>
      {selected?.label}{selected && !selected.known ? " · 공식 그림 미확인" : ""}
    </p>
  </div>;
}
