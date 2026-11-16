import { PITCH_BOX, PITCH_BOX_DEPTH_LINE, PITCH_BOX_LANE_LINES, PITCH_LANE_LINES } from "../../lib/shotZones";

export function ShotPitchLines({ fullPitch }: { fullPitch: boolean }) {
  return <g aria-hidden="true" stroke="#92b6a1">
    <rect x="18" y="18" width="204" height={fullPitch ? 316 : 158} rx="3" fill="#e8f4ed" />
    <path d={`M${PITCH_BOX.left} 18 V${PITCH_BOX.bottom} H${PITCH_BOX.right} V18 M92 18 V35 H148 V18 M109 18 V12 H131 V18 M94 68 A29 29 0 0 0 146 68 M18 176 H222`} fill="none" />
    {PITCH_LANE_LINES.map(x => <line key={x} x1={x} x2={x} y1={PITCH_BOX.bottom} y2="176" strokeDasharray="3 4" />)}
    {PITCH_BOX_LANE_LINES.map(x => <line key={x} x1={x} x2={x} y1="18" y2={PITCH_BOX.bottom} strokeDasharray="3 3" />)}
    <line x1={PITCH_BOX.left} x2={PITCH_BOX.right} y1={PITCH_BOX_DEPTH_LINE} y2={PITCH_BOX_DEPTH_LINE} strokeDasharray="3 3" />
    {fullPitch ? <><circle cx="120" cy="176" r="27" fill="none" /><path d="M59 334 V284 H181 V334 M92 334 V317 H148 V334" fill="none" /></>
      : <path d="M93 176 A27 27 0 0 1 147 176" fill="none" />}
  </g>;
}
