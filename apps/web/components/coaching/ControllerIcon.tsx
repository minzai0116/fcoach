export function ControllerIcon({ value, side }: { value?: string | null; side: "내" | "상대" }) {
  const [icon, label] = value === "keyboard" ? ["⌨️", "키보드"] : value === "gamepad" ? ["🎮", "패드"] : ["?", "미확인"];
  const description = `${side} 컨트롤러 ${label}`;
  return <span className="controller-icon" role="img" aria-label={description} title={description}>{icon}</span>;
}
