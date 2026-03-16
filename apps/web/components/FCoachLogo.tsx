export function FCoachLogo() {
  return (
    <div className="brand-logo" aria-label="FCOACH">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" role="img" focusable="false">
          <defs>
            <linearGradient id="fcoach-gradient" x1="0%" x2="100%" y1="0%" y2="100%">
              <stop offset="0%" stopColor="#1d4ed8" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#fcoach-gradient)" />
          <path d="M13 27V13h14v4H17v2.8h8.4v4H17V27h-4z" fill="#fff" />
        </svg>
      </span>
      <h1 className="title brand-text">FCOACH</h1>
    </div>
  );
}
