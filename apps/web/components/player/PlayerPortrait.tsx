"use client";

import { useEffect, useMemo, useState } from "react";
import { playerFaceCandidates } from "../../lib/playerReport";
import type { PlayerReportEntry } from "../../types/analysis";

const DEFAULT_PLAYER_IMAGE = "https://ssl.nexon.com/s2/game/fc/mobile/squadMaker/default/d_player.png";

export function PlayerPortrait({
  player,
  alt,
  className,
}: {
  player: Pick<PlayerReportEntry, "face_img" | "action_img" | "fallback_img" | "sp_id">;
  alt: string;
  className: string;
}) {
  const candidates = useMemo(() => playerFaceCandidates(player), [player]);
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
