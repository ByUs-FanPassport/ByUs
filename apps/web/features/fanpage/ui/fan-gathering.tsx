"use client";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Heart, Pause, Play } from "lucide-react";
import { fanCommunitySchema } from "../domain/fan-community";
import { useCommunityResource } from "./use-community-resource";
import { ResourceMessage } from "./home-panels";
import { createMarbles, MARBLE_SIZE, stepMarbles } from "./fan-marbles";
import styles from "./fan-gathering.module.css";

type Fan = { nickname: string; avatarUrl: string };
const reducedQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (refresh: () => void) => { const query = window.matchMedia(reducedQuery); query.addEventListener("change", refresh); return () => query.removeEventListener("change", refresh); };
const readMotion = () => window.matchMedia(reducedQuery).matches;
const serverMotion = () => true;
const parse = (value: unknown) => fanCommunitySchema.parse(value);
function nameHash(name: string) { return [...name].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0); }

function MarbleTray({ fans, paused, locale }: { fans: Fan[]; paused: boolean; locale: "ko" | "en" }) {
  const tray = useRef<HTMLDivElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const stop = useRef(paused), wake = useRef(() => {}), repaint = useRef(() => {});
  const [selected, setSelected] = useState<number | null>(null);
  const tooltipId = useId();
  useEffect(() => { stop.current = paused; wake.current(); }, [paused]);
  useEffect(() => { repaint.current(); }, [selected]);
  useEffect(() => {
    const element = tray.current;
    if (!element) return;
    let width = element.clientWidth, height = element.clientHeight;
    let bodies = createMarbles(fans.length, width, height);
    let frame = 0, previous = 0, active: number | null = null;
    let hovered: number | null = null, focused: number | null = null, pinned: number | null = null;
    let gesture: { id: number; index: number; startX: number; startY: number; moved: boolean } | null = null;
    let drag: { index: number; x: number; y: number } | null = null;
    let pointer: { x: number; y: number; vx: number; vy: number; at: number } | null = null;
    const paint = () => {
      bodies.forEach((body, i) => { const node = items.current[i]; if (node) node.style.transform = `translate3d(${body.x - MARBLE_SIZE / 2}px,${body.y - MARBLE_SIZE / 2}px,0)`; });
      const label = tooltip.current, body = active === null ? null : bodies[active];
      if (label && body) {
        const labelWidth = label.offsetWidth, labelHeight = label.offsetHeight;
        const x = Math.max(8, Math.min(width - labelWidth - 8, body.x - labelWidth / 2));
        const above = body.y - MARBLE_SIZE / 2 - labelHeight - 10;
        const y = above >= 8 ? above : body.y + MARBLE_SIZE / 2 + 10;
        label.style.transform = `translate3d(${x}px,${Math.min(height - labelHeight - 8, y)}px,0)`;
      }
    };
    const select = () => { const next = gesture?.index ?? focused ?? hovered ?? pinned; if (next !== active) { active = next; setSelected(next); } paint(); };
    const indexOf = (target: EventTarget | null) => {
      const button = target instanceof Element ? target.closest<HTMLButtonElement>("button[data-marble-index]") : null;
      return button && element.contains(button) ? Number(button.dataset.marbleIndex) : null;
    };
    const local = (event: PointerEvent) => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0 || gesture) return;
      const index = indexOf(event.target); pointer = null;
      if (index === null) { pinned = null; hovered = null; select(); return; }
      gesture = { id: event.pointerId, index, startX: event.clientX, startY: event.clientY, moved: false };
      items.current[index]?.setPointerCapture(event.pointerId); select();
    };
    const move = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      const point = local(event);
      if (gesture && gesture.id === event.pointerId) {
        if (!stop.current && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) {
          gesture.moved = true; drag = { index: gesture.index, ...point }; pinned = null; focused = null; hovered = null;
        }
      } else if (event.pointerType === "mouse" && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        const at = performance.now(), dt = pointer ? Math.max(.008, (at - pointer.at) / 1000) : 0;
        pointer = { ...point, vx: dt ? (point.x - pointer!.x) / dt : 0, vy: dt ? (point.y - pointer!.y) / dt : 0, at };
        hovered = indexOf(event.target); select();
      }
    };
    const release = (event: PointerEvent) => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const { index, moved } = gesture;
      if (event.type === "pointerup" && !moved) pinned = pinned === index ? null : index;
      gesture = null; drag = null; pointer = null; hovered = null;
      const node = items.current[index]; if (node?.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      select();
    };
    const leave = () => { pointer = null; hovered = null; select(); };
    const focus = (event: FocusEvent) => { const index = indexOf(event.target); if (index !== null && !gesture) { focused = index; select(); } };
    const blur = () => { focused = null; select(); };
    const key = (event: KeyboardEvent) => {
      const index = indexOf(event.target);
      if (event.key === "Escape") { pinned = null; hovered = null; select(); }
      if (index !== null && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); pinned = pinned === index ? null : index; select(); }
    };
    const loop = (time: number) => {
      if (stop.current || document.hidden) { previous = 0; return; }
      if (previous) stepMarbles(bodies, width, height, (time - previous) / 1000, { heldIndex: active, drag, pointer: pointer && performance.now() - pointer.at < 80 ? pointer : null });
      previous = time; paint(); frame = requestAnimationFrame(loop);
    };
    const visibility = () => {
      cancelAnimationFrame(frame); previous = 0;
      if (document.hidden || stop.current) { gesture = null; drag = null; pointer = null; hovered = null; select(); }
      if (!document.hidden && !stop.current) frame = requestAnimationFrame(loop);
    };
    const observer = new ResizeObserver(() => { width = element.clientWidth; height = element.clientHeight; bodies = createMarbles(fans.length, width, height); paint(); });
    const events = { pointerdown: down, pointermove: move, pointerup: release, pointercancel: release, lostpointercapture: release, pointerleave: leave, focusin: focus, focusout: blur, keydown: key };
    for (const [type, listener] of Object.entries(events)) element.addEventListener(type, listener as EventListener);
    wake.current = visibility; repaint.current = paint; observer.observe(element); paint(); visibility(); document.addEventListener("visibilitychange", visibility);
    return () => {
      wake.current = () => {}; repaint.current = () => {}; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", visibility);
      for (const [type, listener] of Object.entries(events)) element.removeEventListener(type, listener as EventListener);
    };
  }, [fans]);
  return <div ref={tray} className={styles.tray} data-marble-tray data-paused={paused} role="group" aria-label={locale === "ko" ? "함께하는 팬 캐릭터" : "Fan characters"}>
    {fans.map((fan, index) => <button type="button" key={`${fan.nickname}:${index}`} data-marble-index={index} ref={node => { items.current[index] = node; }} className={styles.marble} data-selected={selected === index} aria-label={fan.nickname} aria-describedby={selected === index ? tooltipId : undefined}>
      <img src={fan.avatarUrl} alt="" width={44} height={44} draggable={false} />
    </button>)}
    {selected !== null && fans[selected] && <div ref={tooltip} id={tooltipId} className={styles.tooltip} role="tooltip">{fans[selected]!.nickname}</div>}
  </div>;
}
export function FanGathering({ fans, fanCount, locale }: { fans: Fan[]; fanCount: number; locale: "ko" | "en" }) {
  const ko = locale === "ko", titleId = useId();
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, serverMotion);
  const [paused, setPaused] = useState(false);
  // Stable placement conveys no score, membership tier, or arrival order.
  const current = useMemo(() => [...fans].sort((a, b) => nameHash(a.nickname) - nameHash(b.nickname)), [fans]);
  const count = fanCount.toLocaleString(ko ? "ko-KR" : "en-US");
  return <section className={styles.panel} aria-labelledby={titleId} data-fan-gathering>
    <div className={styles.top}><span><Heart size={15} aria-hidden="true" /> BYUS FANS</span></div>
    <h2 id={titleId}>{ko ? "좋아하는 마음으로 모인 팬들" : "Fans, brought together"}</h2>
    <p className={styles.description}>{ko ? <><strong>{count}명</strong>이 좋아요와 패스포트로 함께하고 있어요.</> : <><strong>{count} {fanCount === 1 ? "fan" : "fans"}</strong> joined with a like or Passport.</>}</p>
    {current.length ? <MarbleTray key={JSON.stringify(current)} fans={current} paused={paused || reduced} locale={locale} /> : <div className={styles.empty}><Heart size={28} aria-hidden="true" /><p>{ko ? "아직 함께하는 팬이 없어요." : "No fans have joined yet."}</p></div>}
    {current.length > 0 && <p className={styles.caption}>{ko ? `캐릭터에 마우스를 올리거나 눌러 닉네임을 확인하세요.${paused || reduced ? "" : " 끌어서 움직일 수도 있어요."}` : `Hover or tap to see a name.${paused || reduced ? "" : " Drag a character to move it."}`}</p>}
    <div className={styles.bottom}>
      {current.length > 0 && <button type="button" className={styles.motion} disabled={reduced} onClick={() => setPaused(value => !value)} aria-pressed={paused || reduced}>
        {paused || reduced ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{reduced ? (ko ? "동작 줄이기 사용 중" : "Reduced motion on") : paused ? (ko ? "움직임 재생" : "Resume motion") : (ko ? "움직임 멈추기" : "Pause motion")}
      </button>}
    </div>
  </section>;
}
export function FanGatheringPanel({ slug, locale }: { slug: string; locale: "ko" | "en" }) {
  const resource = useCommunityResource(`/api/celebrities/${slug}/fans?locale=${locale}`, parse);
  if (resource.state.status !== "ready") return <ResourceMessage locale={locale} error={resource.state.status === "error"} retry={resource.retry} />;
  return <><FanGathering key={`${slug}:${locale}`} {...resource.state.data} locale={locale} />{resource.refreshFailed && <ResourceMessage locale={locale} error retry={resource.retry} />}</>;
}
