"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createShareImage, shareImageTitle, type ShareImageInput } from "../../lib/shareImage";
import "./share-image.css";

export function ShareImageButton({ input, label = "이미지 저장" }: { input: ShareImageInput; label?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <><button type="button" ref={trigger} className="share-image-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{label}</button>
    {open && createPortal(<ShareImageDialog input={input} onClose={() => { setOpen(false); trigger.current?.focus(); }} />, document.body)}
  </>;
}

function ShareImageDialog({ input, onClose }: { input: ShareImageInput; onClose: () => void }) {
  const [showNickname, setShowNickname] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [prepared, setPrepared] = useState<{ filename: string; url: string } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const title = shareImageTitle(input);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled])') ?? []);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", keydown); };
  }, [onClose]);
  useEffect(() => {
    let active = true, url: string | null = null;
    setPrepared(null); setError(""); setMessage("");
    createShareImage(input, showNickname).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPrepared({ filename: `fcoach-${input.kind}.png`, url });
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "이미지를 만들지 못했습니다."); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [input, showNickname, attempt]);
  return <div className="share-image-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="share-image-dialog" role="dialog" aria-modal="true" aria-labelledby="share-image-title" ref={dialog}>
      <header><div><h2 id="share-image-title">{title}</h2><p>저장 이미지 미리보기</p></div><button type="button" ref={close} className="share-image-close" aria-label="저장 미리보기 닫기" onClick={onClose}>×</button></header>
      <div className="share-image-preview" aria-busy={!prepared && !error}>
        {prepared ? <img src={prepared.url} alt={`${title} 저장 이미지`} /> : error ? <div role="alert"><p>{error}</p><button type="button" className="share-image-trigger" onClick={() => setAttempt(v => v + 1)}>다시 시도</button></div> : <p role="status">저장 이미지를 만들고 있습니다…</p>}
      </div>
      <footer><label className="share-image-name"><input type="checkbox" checked={showNickname} onChange={event => setShowNickname(event.target.checked)} />감독명 표시</label>
        <div className="share-image-actions">
          {prepared && <a className="share-image-primary" href={prepared.url} download={prepared.filename} onClick={() => setMessage("이미지 다운로드를 요청했습니다.")}>이미지 다운로드</a>}
        </div>
        {message && <p role="status" className="share-image-help">{message}</p>}
      </footer>
    </div>
  </div>;
}
