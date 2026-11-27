import { useCallback, useEffect, useRef, useState } from "react";
import { parseSize } from "@/lib/plugins";
import { rendererLabel } from "@/lib/plugin-ui";
import type { Layout, TileDef, Theme } from "@/types";

const DECK_URL = `${(import.meta.env.VITE_AGENT as string | undefined) ?? ""}/?preview=1&np=clean`;
const DECK_ORIGIN = new URL(DECK_URL, location.href).origin;
/** The deck runs at a real phone cell size and is scaled down with CSS, so text and spacing look like the phone. */
const CELL = 112;
const PAD = 16;
/** The deck draws its own status bar above the grid; the preview pushes it out of view so only the tile shows. */
const BAR = 44;


/**
 * How one tile of a plugin looks on the phone: the real deck (the same iframe the Screens preview uses) with a one-tile
 * layout, the current theme and the tile's sample data. Without sample data it shows the registry screenshot, and without
 * that a neutral placeholder with the renderer's name. The deck mounts only once the tile scrolls into view.
 */
/** The frame scaled so the tile fills the box: the measured tile when there is one, else the assumed spot (PAD inside, BAR above). */
export function frameStyle(IW: number, IH: number, boxW: number, fit: { x: number; y: number; w: number; h: number } | null): React.CSSProperties {
  const scale = boxW / (fit ? fit.w : IW) || 0.3;
  return { width: IW, height: IH + BAR, left: fit ? -fit.x * scale : 0, top: fit ? -fit.y * scale : -BAR * scale, transformOrigin: "0 0", transform: `scale(${scale})` };
}

export function TilePreview({ pluginId, widget, theme, screenshot, className }: { pluginId: string; widget: TileDef; theme?: Theme; screenshot?: string; className?: string }) {
  const [w, h] = parseSize(widget.sizes?.[0] ?? "2x1") ?? [2, 1];
  const IW = w * CELL + PAD * 2;
  const IH = h * CELL + PAD * 2;
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [seen, setSeen] = useState(false);
  const [boxW, setBoxW] = useState(0);
  /** where the deck really drew the tile, in the frame's own pixels (it sizes its grid to the frame, so it is measured, not assumed) */
  const [fit, setFit] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const has = widget.preview !== undefined && widget.preview !== null;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = () => setBoxW(el.clientWidth);
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const io = has ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io?.disconnect(); } }) : null;
    io?.observe(el);
    return () => { ro.disconnect(); io?.disconnect(); };
  }, [IW, has]);

  const post = useCallback(() => {
    const layout: Layout = {
      version: 1, theme: { ...(theme ?? {}), orientation: IH + BAR > IW ? "portrait" : "landscape" } as Theme,
      pages: [{ id: "p", name: "", columns: w, rows: h, items: [{ id: "t", kind: "widget", widget: "plugin", x: 0, y: 0, ...(w > 1 || h > 1 ? { w, h } : {}), plugin: { id: pluginId, widget: widget.id } } as never] }],
    };
    frame.current?.contentWindow?.postMessage({ type: "pd-preview", layout, pageId: "p", selectedId: null, pluginData: { t: { render: widget.render, data: widget.preview } } }, DECK_ORIGIN);
    // find the tile once the deck has drawn it (same origin as this page; a dev agent on another origin keeps the assumed spot)
    let tries = 0;
    const measure = () => {
      try {
        const el = frame.current?.contentDocument?.querySelector(".pd-tile");
        const r = el?.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) { setFit({ x: r.left, y: r.top, w: r.width, h: r.height }); return; }
      } catch {
        return;
      }
      if (++tries < 40) setTimeout(measure, 100);
    };
    measure();
  }, [pluginId, widget, theme, w, h, IW, IH]);

  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && e.data?.type === "pd-ready") post(); };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [post]);
  useEffect(() => { if (seen) post(); }, [seen, post]);

  return (
    <div ref={box} className={className ?? "w-full"} style={{ aspectRatio: fit ? `${fit.w} / ${fit.h}` : `${IW} / ${IH}` }}>
      {has ? (
        <div className="relative size-full overflow-hidden rounded-xl border bg-black" aria-hidden>
          {seen && <iframe ref={frame} src={DECK_URL} title="" tabIndex={-1} className="pointer-events-none absolute left-0 top-0 border-0"
            style={frameStyle(IW, IH, boxW, fit)} />}
        </div>
      ) : screenshot ? (
        <img src={screenshot} alt="" loading="lazy" className="size-full rounded-xl border object-cover" />
      ) : (
        <div className="grid size-full place-items-center rounded-xl border bg-muted/40 px-2 text-center text-[11px] text-muted-foreground" aria-hidden>{rendererLabel(widget.render)}</div>
      )}
    </div>
  );
}
