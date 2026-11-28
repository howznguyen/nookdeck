import { useId, useMemo, useState, type ReactNode } from "react";
import { IconPlus as Plus, IconTrash as Trash } from "@tabler/icons-react";
import { Button } from "@/components/ui/knowns/button";
import { Field, Input } from "@/components/ui/knowns/input";
import { Switch } from "@/components/ui/knowns/switch";
import { cn } from "@/lib/utils";
import { t, useLanguage } from "@/lib/i18n";
import { CLOCK_STYLES, type ClockOptions, type ClockStyle, type WeatherOptions } from "@/types";

const FALLBACK_ZONES = [
  "Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Kolkata", "Asia/Dubai",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow", "America/New_York", "America/Chicago", "America/Los_Angeles",
  "America/Sao_Paulo", "Africa/Cairo", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

function zoneList(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = f?.("timeZone");
    if (list?.length) return list.includes("UTC") ? list : [...list, "UTC"];
  } catch {
    /* older browsers */
  }
  return FALLBACK_ZONES;
}

const isZone = (z: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

const STYLE_NAME: Record<ClockStyle, string> = {
  digital: "Large digits", flip: "Flip", analog: "Analog", minimal: "Minimal", word: "Words", world: "World",
  weather: "With weather", lunar: "Lunar calendar", bloc: "Wall calendar", segment: "LED segments", ring: "Ring", stack: "Stacked", ticks: "Tick marks", dither: "Dither",
};

/** The ticks thumbnail's marks, clockwise from the top centre of a 36 x 30 rounded rect. */
const TICK_PTS = [[18, 2], [23, 2], [28, 2], [32, 4], [34, 8], [34, 13], [34, 17], [34, 22], [32, 26], [28, 28], [23, 28], [18, 28], [13, 28], [8, 28], [4, 26], [2, 22], [2, 17], [2, 13], [2, 8], [4, 4], [8, 2], [13, 2]];

/** The dither thumbnail: "10:42" from the deck's own dither-logic at 300 x 70 px. */
const DITHER_THUMB = [
  " .  @@  - @%@@@%     :@%  @% -@%@@@%  ",
  "  %@%@    %@  %@  %@  %@  %@      %@  ",
  "    @%   :@@  @@    . @@@%@@  @@@%@@  ",
  "    %@   -%@  %@  %@      %@  %@      ",
  "  @%@@@%  @%@@@%          @%  @%@@@%  ",
];

/** A few pixels of what each style looks like. */
function Thumb({ style }: { style: ClockStyle }) {
  const box = "grid h-9 w-full place-items-center rounded-md bg-muted/60 text-foreground";
  switch (style) {
    case "digital":
      return <span className={cn(box, "font-mono text-[15px] font-light tracking-tight")}>10:42</span>;
    case "flip":
      return (
        <span className={cn(box, "gap-0.5 grid-flow-col")}>
          {["1", "0", "4", "2"].map((d, i) => <span key={i} className="grid h-6 w-3.5 place-items-center rounded-[3px] bg-foreground/15 font-mono text-[12px] font-semibold">{d}</span>)}
        </span>
      );
    case "analog":
      return (
        <span className={box}>
          <svg viewBox="0 0 32 32" className="size-7" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round">
            <circle cx="16" cy="16" r="13" strokeWidth="1.5" opacity=".5" />
            <path d="M16 16V8" strokeWidth="2" />
            <path d="M16 16l6 3" strokeWidth="1.5" />
          </svg>
        </span>
      );
    case "minimal":
      return <span className={cn(box, "text-[12px]")}>10:42</span>;
    case "word":
      return <span className={cn(box, "text-[10px] leading-tight")}>{t("ten o'clock")}<br />{t("ten to")}</span>;
    case "world":
      return (
        <span className={cn(box, "grid-cols-3 gap-1 px-1 text-[9px] leading-tight")}>
          {["10:42", "03:42", "21:42"].map((c) => <span key={c}>{c}</span>)}
        </span>
      );
    case "weather":
      return (
        <span className={cn(box, "grid-flow-col gap-1.5")}>
          <span className="font-mono text-[13px] font-light">10:42</span>
          <span className="text-[10px] text-muted-foreground">☀ 31°</span>
        </span>
      );
    case "lunar":
      return (
        <span className={cn(box, "leading-tight")}>
          <span className="font-mono text-[12px] font-light">10:42</span>
          <span className="text-[8px] text-primary">☾ 9/10</span>
        </span>
      );
    case "bloc":
      return (
        <span className="flex h-9 w-full flex-col overflow-hidden rounded-md bg-muted/60 text-foreground">
          <span className="h-2 w-full bg-primary" />
          <span className="grid flex-1 grid-flow-col place-items-center gap-1">
            <span className="text-[15px] font-extrabold leading-none">28</span>
            <span className="text-[8px] text-primary">9</span>
          </span>
        </span>
      );
    case "segment":
      return (
        <span className={box}>
          <svg viewBox="0 0 48 20" className="h-5 w-12" aria-hidden="true" fill="currentColor">
            {[0, 11, 27, 38].map((x) => (
              <g key={x} transform={`translate(${x} 1)`}>
                <rect x="1.5" y="0" width="5" height="1.6" rx=".8" />
                <rect x="7" y="1.5" width="1.6" height="7" rx=".8" opacity=".25" />
                <rect x="7" y="9.5" width="1.6" height="7" rx=".8" />
                <rect x="1.5" y="16.4" width="5" height="1.6" rx=".8" />
                <rect x="0" y="9.5" width="1.6" height="7" rx=".8" opacity=".25" />
                <rect x="0" y="1.5" width="1.6" height="7" rx=".8" />
                <rect x="1.5" y="8.2" width="5" height="1.6" rx=".8" />
              </g>
            ))}
            <circle cx="23.5" cy="7" r="1.2" /><circle cx="23.5" cy="13" r="1.2" />
          </svg>
        </span>
      );
    case "ring":
      return (
        <span className={box}>
          <svg viewBox="0 0 32 32" className="size-8" aria-hidden="true" fill="none" strokeLinecap="round">
            <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="2.5" opacity=".15" />
            <path d="M16 3a13 13 0 0 1 12.4 17" className="stroke-primary" strokeWidth="2.5" />
            <text x="16" y="18.5" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none">10:42</text>
          </svg>
        </span>
      );
    case "ticks":
      return (
        <span className={box}>
          <svg viewBox="0 0 36 30" className="h-7 w-8" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3">
            {TICK_PTS.map(([x, y], i) => (
              // marks round a rounded rect, pointing inwards: lit up to 2 o'clock, a fade, then faint
              <path key={i} d={`M${x} ${y}l${x <= 4 ? 2 : x >= 32 ? -2 : 0} ${y <= 4 ? 2 : y >= 26 ? -2 : 0}`} opacity={i <= 6 ? 1 : i <= 10 ? 0.45 : 0.18} />
            ))}
            <text x="18" y="19" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="currentColor" stroke="none" style={{ fontStretch: "condensed" }}>10:42</text>
          </svg>
        </span>
      );
    case "dither":
      return (
        <span className={cn(box, "overflow-hidden font-mono text-[4px] font-bold leading-[5px] whitespace-pre")} aria-hidden="true">
          {DITHER_THUMB.map((row, i) => <span key={i} className="block">{row}</span>)}
        </span>
      );
    case "stack":
      return (
        <span className={cn(box, "font-mono text-[12px] font-light leading-[0.9]")}>
          <span>10<br /><span className="text-primary">42</span></span>
        </span>
      );
  }
}

function SwitchRow({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-[13px]">{label}</label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function ZoneInput({ id, value, listId, placeholder, onCommit, trailing }: { id: string; value: string; listId: string; placeholder?: string; onCommit: (v: string) => void; trailing?: ReactNode }) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  const commit = (v: string) => {
    const z = v.trim();
    if (z === "" ) { setBad(false); onCommit(""); return; }
    if (isZone(z)) { setBad(false); onCommit(z); } else setBad(true);
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        list={listId}
        size="sm"
        value={draft}
        invalid={bad}
        placeholder={placeholder}
        aria-label={placeholder ?? t("Time zone")}
        onChange={(e) => { setDraft(e.target.value); if (isZone(e.target.value.trim())) { setBad(false); onCommit(e.target.value.trim()); } }}
        onBlur={() => commit(draft)}
      />
      {trailing}
    </div>
  );
}

/** `weatherFields` draws the weather widget's source / city / unit fields (item-form.tsx owns them) for the weather style. */
export function ClockOptionsForm({ value, onChange, weatherFields }: { value: ClockOptions | undefined; onChange: (next: ClockOptions | undefined) => void; weatherFields?: (value: WeatherOptions | undefined, onChange: (w: WeatherOptions) => void) => ReactNode }) {
  useLanguage();
  const o = value ?? {};
  const uid = useId();
  const zones = useMemo(zoneList, []);
  const listId = `${uid}-zones`;
  const style: ClockStyle = o.style ?? "digital";
  const set = (patch: Partial<ClockOptions>) => {
    const next: ClockOptions = { ...o, ...patch };
    for (const k of Object.keys(next) as (keyof ClockOptions)[]) {
      const v = next[k];
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
    }
    onChange(Object.keys(next).length ? next : undefined);
  };
  const worldZones = o.zones ?? [];

  return (
    <div className="flex flex-col gap-3">
      <datalist id={listId}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
      <Field label={t("Clock style")} id={`${uid}-style`}>
        <div role="radiogroup" aria-label={t("Clock style")} className="grid grid-cols-3 gap-2">
          {CLOCK_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={style === s}
              onClick={() => set({ style: s === "digital" ? undefined : s })}
              className={cn("flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[12px] transition-colors hover:bg-muted", style === s && "border-primary bg-primary/10 font-medium")}
            >
              <Thumb style={s} />
              {t(STYLE_NAME[s])}
            </button>
          ))}
        </div>
      </Field>

      {style === "weather" && weatherFields && (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          {weatherFields(o.weather, (w) => set({ weather: Object.keys(w).length ? w : undefined }))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SwitchRow id={`${uid}-sec`} label={t("Seconds")} checked={o.seconds ?? true} onChange={(v) => set({ seconds: v })} />
        <SwitchRow id={`${uid}-h12`} label={t("12-hour")} checked={o.hour12 ?? false} onChange={(v) => set({ hour12: v || undefined })} />
        <SwitchRow id={`${uid}-date`} label={t("Show date")} checked={o.showDate ?? true} onChange={(v) => set({ showDate: v })} />
      </div>

      {style !== "world" && (
        <Field label={t("Time zone")} id={`${uid}-tz`} hint={t("Leave empty to use the phone's time zone. Example: Asia/Tokyo.")}>
          <ZoneInput id={`${uid}-tz`} listId={listId} value={o.timeZone ?? ""} placeholder={t("Phone time zone")} onCommit={(v) => set({ timeZone: v })} />
        </Field>
      )}

      {style === "world" && (
        <Field label={t("Time zones ({n}/4)", { n: worldZones.length })} id={`${uid}-z0`} hint={t("Up to 4 time zones. The first one is the main clock.")}>
          <div className="flex flex-col gap-2">
            {worldZones.map((z, i) => (
              <ZoneInput
                key={`${i}-${z}`}
                id={i === 0 ? `${uid}-z0` : `${uid}-z${i}`}
                listId={listId}
                value={z}
                placeholder={t("Time zone {n}", { n: i + 1 })}
                onCommit={(v) => set({ zones: v ? worldZones.map((x, j) => (j === i ? v : x)) : worldZones.filter((_, j) => j !== i) })}
                trailing={<Button size="sm" variant="ghost" icon={<Trash />} aria-label={t("Remove time zone {n}", { n: i + 1 })} onClick={() => set({ zones: worldZones.filter((_, j) => j !== i) })} />}
              />
            ))}
            {worldZones.length < 4 && (
              <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => set({ zones: [...worldZones, FALLBACK_ZONES.find((z) => !worldZones.includes(z) && zones.includes(z)) ?? "UTC"] })}>{t("Add time zone")}</Button>
            )}
          </div>
        </Field>
      )}

      <Field label={t("Caption")} id={`${uid}-label`} optional={t("Optional")}>
        <Input id={`${uid}-label`} size="sm" value={o.label ?? ""} maxLength={40} placeholder={t("E.g. Tokyo")} onChange={(e) => set({ label: e.target.value })} />
      </Field>
    </div>
  );
}
