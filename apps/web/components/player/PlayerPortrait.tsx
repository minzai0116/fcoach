"use client";

import { useEffect, useMemo, useState } from "react";
import { playerFaceCandidates } from "../../lib/playerReport";
import type { PlayerReportEntry } from "../../types/analysis";

const DEFAULT_PLAYER_IMAGE = "https://ssl.nexon.com/s2/game/fc/mobile/squadMaker/default/d_player.png";

export function PlayerPortrait({
  player,
  alt,
  className,
  preferredImage,
  actionFirst = false,
}: {
  player: Pick<PlayerReportEntry, "face_img" | "action_img" | "fallback_img" | "sp_id">;
  alt: string;
  className: string;
  preferredImage?: string;
  actionFirst?: boolean;
}) {
  const { sp_id, face_img, action_img, fallback_img } = player;
  const candidates = useMemo(() => Array.from(new Set([
    preferredImage,
    ...(actionFirst ? [action_img, `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${sp_id}.png`] : []),
    ...playerFaceCandidates({ sp_id, face_img, action_img, fallback_img }),
  ].filter((value): value is string => !!value))), [preferredImage, actionFirst, sp_id, face_img, action_img, fallback_img]);
  const [imageIndex, setImageIndex] = useState(0);

  useEffect(() => {
    setImageIndex(0);
  }, [candidates]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={candidates[imageIndex] ?? DEFAULT_PLAYER_IMAGE}
      alt={alt}
      onError={() => setImageIndex((prev) => (prev + 1 < candidates.length ? prev + 1 : prev))}
    />
  );
}
