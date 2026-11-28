import { SizeGrid, StyleChips } from "@/components/visual-options";
import { useEffect, useState } from "react";
import { IconAlertTriangle as AlertTriangle, IconBan as Ban, IconCopy as Copy, IconMinus as Minus, IconPlus as Plus, IconTrash as Trash } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Button } from "@/components/ui/knowns/button";
import { Field, Input } from "@/components/ui/knowns/input";
import { Switch } from "@/components/ui/knowns/switch";
import { Select } from "@/components/ui/knowns/select";
import { Textarea } from "@/components/ui/knowns/textarea";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { ColorField } from "@/components/color-field";
import { Icon } from "@/components/icon";
import { ClockOptionsForm } from "@/components/clock-options";
import { AppPickerButton } from "@/components/app-picker";
import { QuotaOptionsForm } from "@/components/quota-options";
import { MetricOptionsForm } from "@/components/metric-options";
import { PluginStylePicker } from "@/components/plugin-style";
import { HotkeyField } from "@/components/hotkey-field";
import { MacroEditor } from "@/components/macro-editor";
import { ScreenshotToolFields, effectiveTool, toolName, useScreenshotTools } from "@/components/screenshot-fields";
import type { ScreenshotChoice } from "@shared/screenshot";
import { LiveFields } from "@/components/live-fields";
import { IconPicker } from "@/components/icon-picker";
import {
  ACTION_ICON, ACTION_SHORT, MEDIA_LABEL, PROVIDER_LABEL, SCREENSHOT_LABEL, VOLUME_LABEL, WIDGET_LABEL, defaultAction, tileName,
} from "@/lib/layout";
import { cn } from "@/lib/utils";
import { t, translationsOf, useLanguage } from "@/lib/i18n";
import { EntityPicker } from "@/components/entity-picker";
import { baseUrls, curlPush, useWebhook } from "@/lib/webhook";
import { api } from "@/api";
import { useHassServices } from "@/lib/hass";
import { Slider } from "@/components/ui/knowns/slider";
import { useSounds } from "@/lib/sounds";
import { FieldInput } from "@/components/plugins-panel";
import { pluginSizes, useEnabledPlugins } from "@/lib/plugins";
import type { PluginField, PluginInfo, PluginRef } from "@/types";
import { ACTION_TYPES, AI_PROVIDERS, WIDGET_KINDS, METRIC_WIDGETS, type MetricWidget, type EntityOptions, type GeoPlace, type PushOptions, type WeatherOptions, type QuotaOptions, type MacApp, type Action, type ActionType, type AiProvider, type Item, type Page, type WidgetKind } from "@/types";

export function ItemForm({ item, page, pages, accent, screenshotDefault, onChange, onDuplicate, onDelete, onResize, onWidgetKind, onMoveToPage }: {
  item: Item;
  page: Page;
  pages: Page[];
  /** Theme accent: the swatch colour for items with no colour of their own. */
  accent?: string;
  /** The screen's screenshot tool (theme.screen.screenshot), which a screenshot button uses unless it picks its own. */
  screenshotDefault?: ScreenshotChoice;
  onChange: (next: Item) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Moves the tile to another screen; "full" means that screen has no room and a tile to swap with must be picked. */
  onMoveToPage?: (pageId: string, swapWith?: string) => "ok" | "full" | "error";
  /** Applies a new span; returns an error message when it does not fit. */
  onResize: (w: number, h: number) => string | null;
  /** Changes the widget kind and applies its default size. */
  onWidgetKind: (kind: WidgetKind) => void;
}) {
  useLanguage();
  const [sizeError, setSizeError] = useState<string | null>(null);
  useEffect(() => setSizeError(null), [item.id]);
  const [armed, setArmed] = useState(false);
  useEffect(() => setArmed(false), [item.id]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const set = (patch: Record<string, unknown>) => onChange({ ...item, ...patch } as Item);
  // Plugin tile ids must be unique across ALL screens (the agent rejects the layout otherwise); other ids only per screen.
  const pluginTile = item.kind === "widget" && item.widget === "plugin";
  const idTaken = page.items.some((o) => o.id === item.id && o !== item);
  const idTakenElsewhere = pluginTile && pages.some((p) => p !== page && p.items.some((o) => o.id === item.id));

  const setKind = (kind: string) => {
    if (kind === item.kind) return;
    const base = { id: item.id, w: item.w, h: item.h, color: item.color };
    const next = kind === "widget"
      ? { ...base, kind: "widget", widget: "clock" }
      : { ...base, kind: "button", label: t("New button"), action: defaultAction("open") };
    onChange(JSON.parse(JSON.stringify(next)) as Item);
  };

  const plugins = useEnabledPlugins();
  // A plugin tile only comes in the sizes its manifest lists.
  const allowedSizes: [number, number][] = item.kind === "widget" && item.widget === "plugin" ? pluginSizes(findPluginWidget(plugins, item.plugin)?.widget.sizes ?? []) : item.kind === "widget" && item.widget === "onair" ? [[1, 1], [2, 1], [2, 2]] : [];
  const w = item.w ?? 1;
  const h = item.h ?? 1;
  const resize = (nw: number, nh: number) => setSizeError(onResize(nw, nh));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1.5">
        <SegmentedControl
          size="sm"
          aria-label={t("Tile type")}
          value={item.kind}
          onValueChange={setKind}
          options={[{ value: "button", label: t("Button") }, { value: "widget", label: "Widget" }]}
        />
        <span className="flex-1 text-xs tabular-nums text-muted-foreground" title={t("Position on the grid (column, row)")}>{t("Tile")} ({(item.x ?? 0) + 1}, {(item.y ?? 0) + 1})</span>
        <Button size="sm" variant="secondary" icon={<Copy />} onClick={onDuplicate} aria-label={t("Duplicate")} title={t("Duplicate")} />
        <Button size="sm" variant="destructive" icon={<Trash />} onClick={() => (armed ? onDelete() : setArmed(true))}>{armed ? t("Sure?") : t("Delete")}</Button>
      </div>

      {onMoveToPage && pages.length > 1 && <MoveToScreen item={item} page={page} pages={pages} onMove={onMoveToPage} />}

      <Section title={t("Display")}>
        {item.kind === "widget" ? (
          <>
            <Field label="Widget" id="f-widget">
              <Select id="f-widget" value={item.widget} onChange={(e) => onWidgetKind(e.target.value as WidgetKind)}
                options={[...WIDGET_KINDS.filter((w) => w !== "entity" || item.widget === "entity"), ...(item.widget === "plugin" ? (["plugin"] as WidgetKind[]) : [])].map((w) => ({ value: w, label: t(WIDGET_LABEL[w] ?? w) }))} />
            </Field>
            {item.widget === "plugin" && <PluginWidgetForm item={item} plugins={plugins} onChange={(plugin) => set({ plugin })} />}
            {item.widget === "clock" && <ClockOptionsForm value={item.clock} onChange={(clock) => set({ clock })} weatherFields={(w, onW) => <WeatherForm value={w} onChange={onW} noShow />} />}
            {(METRIC_WIDGETS as readonly string[]).includes(item.widget) && (
              <MetricOptionsForm widget={item.widget as MetricWidget} value={item.metric} onChange={(metric) => set({ metric })} />
            )}
            {item.widget === "weather" && <WeatherForm value={item.weather} onChange={(weather) => set({ weather })} />}
            {item.widget === "value" && <ValueForm value={item.push} onChange={(push) => set({ push })} />}
            {item.widget === "onair" && (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="f-onair-tap" className="text-[13px] font-medium">{t("Tap turns On Air on or off")} <span className="block font-normal text-xs text-muted-foreground">{t("Off: the tile only shows the state. Its sources are set in Plugins > On Air.")}</span></label>
                <Switch id="f-onair-tap" checked={item.action?.type === "onair"} onCheckedChange={(v) => set({ action: v ? { type: "onair", mode: "toggle" } : undefined })} aria-label={t("Tap turns On Air on or off")} />
              </div>
            )}
            {item.widget === "entity" && <EntityForm value={item.entity} onChange={(entity) => set({ entity })} />}
            {item.widget === "quota" && <QuotaOptionsForm provider={item.provider ?? "claude"} value={item.quota} onChange={(quota) => set({ quota })} />}
            {item.widget === "quota" && (
              <Field label={t("AI tool")} id="f-provider" hint={t("Which tool's quota this tile shows.")}>
                <Select id="f-provider" value={item.provider ?? "claude"} onChange={(e) => set({ provider: e.target.value as AiProvider, quota: item.quota ? { ...item.quota, account: undefined } : undefined })}
                  options={AI_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] ?? p }))} />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label={t("Button name")} id="f-label">
              <Input id="f-label" value={item.label} placeholder={t("E.g. Screenshot")} onChange={(e) => set({ label: e.target.value })} />
            </Field>
            <Field label={t("Icon")} id="f-icon">
              <IconPicker value={item.icon} onChange={(v) => set({ icon: v })} />
            </Field>
          </>
        )}
        <Field label={t("Color")} id="f-color">
          <ColorField value={item.color} onChange={(v) => set({ color: v })} />
        </Field>
        {allowedSizes.length > 0 ? (
          <Field label={t("Size")} id="f-size" hint={item.kind === "widget" && item.widget === "onair" ? t("The sizes the On Air tile supports.") : t("The sizes this plugin tile supports.")}>
            <Select id="f-size" value={`${w}x${h}`} onChange={(e) => { const [nw, nh] = e.target.value.split("x").map(Number); resize(nw!, nh!); }}
              options={[...(allowedSizes.some(([sw, sh]) => sw === w && sh === h) ? [] : [{ value: `${w}x${h}`, label: `${w}×${h} (${t("not supported")})` }]), ...allowedSizes.map(([sw, sh]) => ({ value: `${sw}x${sh}`, label: `${sw}×${sh}` }))]} />
          </Field>
        ) : (
        <>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Width (tiles)")} id="f-w">
            <Stepper id="f-w" value={w} min={1} max={page.columns} onChange={(v) => resize(v, h)} />
          </Field>
          <Field label={t("Height (tiles)")} id="f-h">
            <Stepper id="f-h" value={h} min={1} max={page.rows} onChange={(v) => resize(w, v)} />
          </Field>
        </div>
        <SizeGrid w={w} h={h} maxW={page.columns} maxH={page.rows} onPick={resize} />
        </>
        )}
        {sizeError && <p role="alert" className="-mt-1.5 text-xs text-destructive">{sizeError}</p>}
        <p className="-mt-1.5 text-xs text-muted-foreground">{t("Drag a tile corner on the phone to resize, drag the tile to move it.")}</p>
      </Section>

      <Section title={t("Tile style")}>
        <Field label={t("Fill style")} id="f-style" hint={t("Soft, Solid and Outline use the item colour (or the theme accent).")}>
          <StyleChips label={t("Fill style")} value={item.style ?? ""} onChange={(v) => set({ style: v || undefined })} color={item.color ?? accent ?? "#22d3ee"} />
        </Field>
        <Field label={t("Text color")} id="f-text-color">
          <ColorField id="f-text-color" value={item.textColor} onChange={(v) => set({ textColor: v })} noneLabel={t("Follow theme")} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="f-hide" className="text-[13px] font-medium">{t("Hide label")} <span className="font-normal text-muted-foreground">{t("(show icon only)")}</span></label>
          <Switch id="f-hide" checked={!!item.hideLabel} onCheckedChange={(v) => set({ hideLabel: v || undefined })} aria-label={t("Hide label")} />
        </div>
      </Section>

      {item.kind === "button" && (
        <Section title={t("On press")}>
          <ActionFields
            action={item.action}
            pages={pages}
            screenshotDefault={screenshotDefault}
            onChange={(a) => set({ action: a })}
            onPickApp={(app) => {
              const patch: Record<string, unknown> = { action: { type: "open", target: `bundle:${app.bundleId}` } };
              if (!item.icon) patch.icon = `app:${app.bundleId}`;
              if (!item.label.trim() || item.label === "New button" || translationsOf("New button").includes(item.label)) patch.label = app.name;
              set(patch);
            }}
          />
        </Section>
      )}

      <Field label={t("Tile ID")} id="f-id" hint={t("The phone sends this ID when pressed. Only change it if needed.")}
        error={!item.id ? t("ID cannot be empty") : idTaken ? t("ID already used on this screen") : idTakenElsewhere ? t("A plugin tile ID must be different on every screen") : undefined}>
        <Input id="f-id" value={item.id} onChange={(e) => set({ id: e.target.value })} />
      </Field>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(title)}</h3>
      {children}
    </section>
  );
}

function ActionFields({ action, pages, screenshotDefault, onChange, onPickApp }: { action: Action | undefined; pages: Page[]; screenshotDefault?: ScreenshotChoice; onChange: (a: Action | undefined) => void; onPickApp: (app: MacApp) => void }) {
  useLanguage();
  const a = action;
  const patch = (p: Record<string, string>) => onChange({ ...a, ...p } as Action);
  return (
    <>
      <div role="radiogroup" aria-label={t("Action type")} className="grid grid-cols-4 gap-1.5">
        <ActionChip label={t("None")} selected={!a} onClick={() => onChange(undefined)} icon={<Ban className="size-[18px]" />} />
        {a?.type === "plugin" && <ActionChip label={t(ACTION_SHORT.plugin)} selected onClick={() => undefined} icon={<Icon name={ACTION_ICON.plugin} size={18} />} />}
        {ACTION_TYPES.map((at: ActionType) => (
          <ActionChip key={at} label={t(ACTION_SHORT[at])} selected={a?.type === at} onClick={() => a?.type !== at && onChange(defaultAction(at, pages[0]?.id))} icon={<Icon name={ACTION_ICON[at]} size={18} />} />
        ))}
      </div>

      {a?.type === "plugin" && <PluginActionForm action={a} onChange={onChange} />}
      {a?.type === "open" && (
        <>
          <Field label={t("App")} id="f-app" hint={t("Pick an app installed on the computer.")}>
            <AppPickerButton target={a.target} onPick={onPickApp} />
          </Field>
          <Field label={t("Open what?")} id="f-open" hint={t("A web address, a file/folder path or an app name.")}>
            <Input id="f-open" value={a.target} placeholder={t("https://... or an app name (Safari)")} onChange={(e) => patch({ target: e.target.value })} />
          </Field>
        </>
      )}
      {a?.type === "hotkey" && <HotkeyField value={a.keys} onChange={(keys) => patch({ keys })} />}
      {a?.type === "type" && (
        <Field label={t("Text to type")} id="f-text" hint={t("Typed into the field currently focused on the computer.")}>
          <Input id="f-text" value={a.text} placeholder={t("Text to type")} onChange={(e) => patch({ text: e.target.value })} />
        </Field>
      )}
      {a?.type === "shell" && (
        <>
          <Field label={t("Command")} id="f-cmd">
            <Input id="f-cmd" value={a.command} placeholder={t("e.g. open -a Calculator")} onChange={(e) => patch({ command: e.target.value })} />
          </Field>
          <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>
            {t("The command runs directly on this computer, with your permissions. Only enter commands you trust.")}
          </Alert>
        </>
      )}
      {a?.type === "media" && (
        <Field label={t("Music control")} id="f-media">
          <SegmentedControl aria-label={t("Music control")} value={a.command} onValueChange={(v) => patch({ command: v })}
            options={[
              { value: "previous", label: t("Previous") },
              { value: "playpause", label: t("Play/Pause") },
              { value: "next", label: t("Next") },
            ]} />
          <span className="text-xs text-muted-foreground">{t(MEDIA_LABEL[a.command])}</span>
        </Field>
      )}
      {a?.type === "volume" && (
        <Field label={t("Volume")} id="f-vol">
          <SegmentedControl aria-label={t("Volume")} value={a.command} onValueChange={(v) => patch({ command: v })}
            options={[
              { value: "down", label: t("Down") },
              { value: "mute", label: t("Mute") },
              { value: "up", label: t("Up") },
            ]} />
          <span className="text-xs text-muted-foreground">{t(VOLUME_LABEL[a.command])}</span>
        </Field>
      )}
      {a?.type === "sound" && <SoundFields action={a} onChange={(next) => onChange(next)} />}
      {a?.type === "lock" && <p className="text-xs text-muted-foreground">{t("Locks the computer the right way for its system: the lock shortcut on macOS, the lock screen on Windows and Linux.")}</p>}
      {a?.type === "screenshot" && <ScreenshotFields action={a} screenDefault={screenshotDefault} onChange={(next) => onChange(next)} />}
      {a?.type === "sound-stop" && <p className="text-xs text-muted-foreground">{t("Press this button to stop all playing sounds (on the computer and the phone).")}</p>}
      {a?.type === "macro" && <MacroEditor steps={a.steps} pages={pages} onChange={(steps) => onChange({ type: "macro", steps })} />}
      {a?.type === "hass" && <HassFields action={a} onChange={(next) => onChange(next)} />}
      {(a?.type === "onair" || a?.type === "mic" || a?.type === "camera") && <LiveFields action={a} onChange={(next) => onChange(next)} />}
      {a?.type === "page" && (
        <Field label={t("Go to screen")} id="f-page" error={pages.some((p) => p.id === a.page) ? undefined : t("This screen no longer exists")}>
          <Select id="f-page" value={a.page} onChange={(e) => patch({ page: e.target.value })}
            options={[
              ...pages.map((p) => ({ value: p.id, label: `${p.name || p.id} (${p.id})` })),
              ...(pages.some((p) => p.id === a.page) ? [] : [{ value: a.page, label: t("{id} (does not exist)", { id: a.page }) }]),
            ]} />
        </Field>
      )}
    </>
  );
}

function ActionChip({ label, icon, selected, onClick }: { label: string; icon: React.ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        selected && "border-primary/60 bg-primary/10 text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Stepper({ id, value, min, max, onChange }: { id: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button size="md" variant="secondary" icon={<Minus />} disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t("Decrease")} />
      <Input id={id} type="number" min={min} max={max} value={value} className="text-center"
        onChange={(e) => {
          const n = Math.round(Number(e.target.value));
          if (Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }} />
      <Button size="md" variant="secondary" icon={<Plus />} disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t("Increase")} />
    </div>
  );
}

function ScreenshotFields({ action, screenDefault, onChange }: { action: Extract<Action, { type: "screenshot" }>; screenDefault?: ScreenshotChoice; onChange: (a: Action) => void }) {
  const info = useScreenshotTools();
  const inherited = effectiveTool(undefined, screenDefault, info);
  const tool = effectiveTool(action, screenDefault, info);
  const mode = action.mode;
  return (
    <>
      <ScreenshotToolFields id="f-shot-tool" value={action} inherited={inherited}
        inheritLabel={t("Screen default ({name})", { name: toolName(inherited) })}
        onChange={(c) => onChange({ type: "screenshot", ...(mode ? { mode } : {}), ...c })} />
      {tool !== "hotkey" && tool !== "command" && (
        <Field label={t("Capture")} id="f-shot">
          <SegmentedControl aria-label={t("Capture")} value={mode ?? "region"}
            onValueChange={(v) => { const { mode: _m, ...rest } = action; onChange(v === "region" ? rest : { ...rest, mode: v as "screen" | "window" }); }}
            options={(["region", "screen", "window"] as const).map((m) => ({ value: m, label: t(SCREENSHOT_LABEL[m]!) }))} />
        </Field>
      )}
    </>
  );
}

function SoundFields({ action, onChange }: { action: Extract<Action, { type: "sound" }>; onChange: (a: Action) => void }) {
  useLanguage();
  const { sounds, error } = useSounds();
  const set = (p: Partial<Extract<Action, { type: "sound" }>>) => onChange({ ...action, ...p });
  const known = !action.sound || (sounds ?? []).some((s) => s.id === action.sound);
  return (
    <>
      <Field label={t("Sound clip")} id="f-snd" hint={error ? t("Could not load the sound library from the agent.") : t("Upload clips in the Sounds tab.")}
        error={sounds && !known ? t("This clip is no longer in the library") : undefined}>
        <Select id="f-snd" value={action.sound} onChange={(e) => set({ sound: e.target.value })}
          options={[
            { value: "", label: sounds ? t("Choose a clip...") : t("Loading...") },
            ...(sounds ?? []).map((s) => ({ value: s.id, label: s.name })),
            ...(sounds && !known ? [{ value: action.sound, label: t("{id} (does not exist)", { id: action.sound }) }] : []),
          ]} />
      </Field>
      <Field label={t("Play on")} id="f-snd-on">
        <SegmentedControl size="sm" aria-label={t("Play on")} value={action.on ?? "mac"} onValueChange={(v) => set({ on: v as "mac" | "phone" | "both" })}
          options={[{ value: "mac", label: t("Computer") }, { value: "phone", label: t("Phone") }, { value: "both", label: t("Both") }]} />
      </Field>
      <Slider label={t("Volume")} aria-label={t("Clip volume")} min={0} max={100} step={5} value={action.volume ?? 100} onValueChange={(v) => set({ volume: v })} formatValue={(v) => `${v}%`} />
      <Field label={t("When pressed again")} id="f-snd-mode">
        <SegmentedControl size="sm" aria-label={t("When pressed again")} value={action.mode ?? "restart"} onValueChange={(v) => set({ mode: v as "overlap" | "restart" | "toggle" })}
          options={[{ value: "restart", label: t("Restart") }, { value: "overlap", label: t("Overlap") }, { value: "toggle", label: t("Stop") }]} />
      </Field>
    </>
  );
}

const DETAIL_DOMAINS = new Set(["climate", "light", "fan", "cover", "vacuum"]);

function EntityForm({ value, onChange }: { value: EntityOptions | undefined; onChange: (e: EntityOptions) => void }) {
  useLanguage();
  const v: EntityOptions = value ?? { id: "" };
  const set = (p: Partial<EntityOptions>) => {
    const next = { ...v, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (k !== "id" && (next[k] === undefined || next[k] === "")) delete next[k];
    onChange({ ...next, id: String(next.id ?? "") } as EntityOptions);
  };
  return (
    <>
      <Field label={t("Home Assistant entity")} id="f-ent" hint={t("Lights, switches, sensors... taken from the connected Home Assistant.")}>
        <EntityPicker value={v.id} onChange={(id) => set({ id })} />
      </Field>
      <Field label={t("Display name")} id="f-ent-name" hint={t("Leave empty to use the name from Home Assistant.")}>
        <Input id="f-ent-name" value={v.name ?? ""} maxLength={60} placeholder={t("E.g. Kitchen light")} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {v.id.startsWith("camera.") ? (
        <>
          <Slider label={t("New picture every")} aria-label={t("New picture every")} min={5} max={60} step={5} value={v.refresh ?? 10} onValueChange={(x) => set({ refresh: x === 10 ? undefined : x })} formatValue={(x) => `${x} s`} />
          <p className="-mt-2 text-[11.5px] text-muted-foreground">{t("Still pictures, only while the tile is on screen. Tap the tile for a large view that updates every 2 seconds.")}</p>
        </>
      ) : <>
      <Field label={t("Display")} id="f-ent-show">
        <Select id="f-ent-show" value={v.show ?? "auto"} onChange={(e) => set({ show: e.target.value === "auto" ? undefined : (e.target.value as EntityOptions["show"]) })}
          options={[{ value: "auto", label: t("Automatic") }, { value: "toggle", label: t("Switch") }, { value: "state", label: t("State") }, { value: "value", label: t("Value") }]} />
      </Field>
      {DETAIL_DOMAINS.has(v.id.split(".")[0] ?? "") && (
        <>
          <Field label={t("On press")} id="f-ent-tap" hint={t("The control panel has all the adjustments (temperature, brightness, speed...).")}>
            <SegmentedControl size="sm" aria-label={t("On press")} value={v.tap ?? "sheet"} onValueChange={(x) => set({ tap: x === "sheet" ? undefined : (x as "sheet" | "toggle") })}
              options={[{ value: "sheet", label: t("Open control panel") }, { value: "toggle", label: t("On / off") }]} />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="f-ent-inline" className="text-[13px]">{t("Show controls on the tile")}</label>
            <Switch id="f-ent-inline" checked={!!v.inlineControls} onCheckedChange={(inlineControls) => set({ inlineControls: inlineControls || undefined })} aria-label={t("Show controls on the tile")} />
          </div>
          <p className="-mt-2 text-[11.5px] text-muted-foreground">{t("Only shown when the tile is big enough (2×1 or larger).")}</p>
        </>
      )}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="f-ent-ro" className="text-[13px]">{t("View only (pressing does not control)")}</label>
        <Switch id="f-ent-ro" checked={!!v.readOnly} onCheckedChange={(readOnly) => set({ readOnly: readOnly || undefined })} aria-label={t("View only")} />
      </div>
      </>}
    </>
  );
}

function HassFields({ action, onChange }: { action: Extract<Action, { type: "hass" }>; onChange: (a: Action) => void }) {
  useLanguage();
  const { data: services, missing } = useHassServices();
  const [raw, setRaw] = useState(() => (action.data ? JSON.stringify(action.data, null, 2) : ""));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  const set = (p: Partial<Extract<Action, { type: "hass" }>>) => {
    const next = { ...action, ...p };
    if (!next.entityId) delete next.entityId;
    onChange(next);
  };
  const known = !action.service || !services || services.some((s) => s.id === action.service);
  const svc = services?.find((s) => s.id === action.service);
  const setData = (text: string) => {
    setRaw(text);
    if (!text.trim()) {
      setJsonErr(null);
      const { data: _d, ...rest } = action;
      return onChange(rest);
    }
    if (text.length > 2048) return setJsonErr(t("Data is larger than 2 KB."));
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return setJsonErr(t("Must be a JSON object, for example {\"brightness\": 120}."));
      setJsonErr(null);
      set({ data: parsed as Record<string, unknown> });
    } catch {
      setJsonErr(t("Invalid JSON."));
    }
  };
  return (
    <>
      <Field label={t("Service")} id="f-svc" hint={svc?.description ?? (missing ? t("Home Assistant is not connected: type it as domain.service.") : t("Example: light.toggle, scene.turn_on"))}
        error={!known ? t("This service is not in Home Assistant") : undefined}>
        {services && services.length > 0 ? (
          <Select id="f-svc" value={action.service} onChange={(e) => set({ service: e.target.value })}
            options={[{ value: "", label: t("Choose a service...") }, ...services.map((s) => ({ value: s.id, label: s.name ? `${s.id} · ${s.name}` : s.id })), ...(known ? [] : [{ value: action.service, label: t("{id} (does not exist)", { id: action.service }) }])]} />
        ) : (
          <Input id="f-svc" value={action.service} placeholder="light.toggle" onChange={(e) => set({ service: e.target.value.trim() })} />
        )}
      </Field>
      <Field label={t("Entity (optional)")} id="f-svc-ent" hint={t("The entity the service acts on.")}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1"><EntityPicker value={action.entityId ?? ""} onChange={(entityId) => set({ entityId })} /></div>
          {action.entityId && <Button size="sm" variant="secondary" onClick={() => set({ entityId: undefined })}>{t("Clear")}</Button>}
        </div>
      </Field>
      <Field label={t("JSON data (optional)")} id="f-svc-data" hint={t("Extra parameters for the service, up to 2 KB.")} error={jsonErr ?? undefined}>
        <Textarea id="f-svc-data" rows={4} value={raw} placeholder={'{"brightness": 120}'} className="font-mono text-xs" onChange={(e) => setData(e.target.value)} />
      </Field>
    </>
  );
}

/** `noShow`: the weather-style clock only ever shows the current conditions, so it has no Display choice. */
function WeatherForm({ value, onChange, noShow }: { value: WeatherOptions | undefined; onChange: (w: WeatherOptions) => void; noShow?: boolean }) {
  useLanguage();
  const v = value ?? {};
  const set = (p: Partial<WeatherOptions>) => {
    const next = { ...v, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === "") delete next[k];
    onChange(next as WeatherOptions);
  };
  const source = v.source ?? "auto";
  return (
    <>
      <Field label={t("Source")} id="f-w-src" hint={t("Automatic: uses Home Assistant when connected, otherwise Open-Meteo (no key needed).")}>
        <SegmentedControl size="sm" aria-label={t("Weather source")} value={source} onValueChange={(x) => set({ source: x as WeatherOptions["source"] })}
          options={[{ value: "auto", label: t("Automatic") }, { value: "hass", label: "Home Assistant" }, { value: "open-meteo", label: "Open-Meteo" }]} />
      </Field>
      {source !== "open-meteo" && (
        <Field label={t("Weather entity (Home Assistant)")} id="f-w-ent">
          <EntityPicker value={v.entity ?? ""} domain="weather" onChange={(entity) => set({ entity })} />
        </Field>
      )}
      {source !== "hass" && <CityField place={v.location} onChange={(location) => set({ location })} />}
      {!noShow && (
        <Field label={t("Display")} id="f-w-show">
          <Select id="f-w-show" value={v.show ?? "auto"} onChange={(e) => set({ show: e.target.value as WeatherOptions["show"] })}
            options={[{ value: "auto", label: t("Automatic by tile size") }, { value: "now", label: t("Now") }, { value: "hourly", label: t("Hourly") }, { value: "daily", label: t("Daily") }]} />
        </Field>
      )}
      <Field label={t("Unit")} id="f-w-units">
        <Select id="f-w-units" value={v.units ?? ""} onChange={(e) => set({ units: (e.target.value || undefined) as WeatherOptions["units"] })}
          options={[{ value: "", label: t("Use the theme unit") }, { value: "metric", label: "°C, km/h" }, { value: "imperial", label: "°F, mph" }]} />
      </Field>
    </>
  );
}

export function CityField({ place, onChange }: { place: WeatherOptions["location"]; onChange: (p: { name: string; lat: number; lon: number } | undefined) => void }) {
  useLanguage();
  const [q, setQ] = useState("");
  const [found, setFound] = useState<GeoPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      setFound(await api.geocode(q.trim()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field label={t("City")} id="f-w-city" hint={place ? t("In use: {name} ({lat}, {lon}). Only the coordinates are sent to Open-Meteo.", { name: place.name, lat: place.lat.toFixed(2), lon: place.lon.toFixed(2) }) : t("Search for a city name to get its coordinates.")} error={err ?? undefined}>
      <div className="flex gap-2">
        <Input id="f-w-city" value={q} placeholder={t("London, Tokyo...")} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
        <Button variant="secondary" loading={busy} onClick={() => void search()}>{t("Search")}</Button>
        {place && <Button variant="secondary" onClick={() => onChange(undefined)}>{t("Clear")}</Button>}
      </div>
      {found && (found.length === 0 ? <p className="text-xs text-muted-foreground">{t("No city found.")}</p> : (
        <ul className="flex flex-col rounded-lg border">
          {found.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <button type="button" className="flex w-full flex-col px-2.5 py-1.5 text-left hover:bg-muted" onClick={() => { onChange({ name: p.name, lat: p.lat, lon: p.lon }); setFound(null); setQ(""); }}>
                <span className="text-[13px] font-medium">{p.name}</span>
                <span className="text-[11.5px] text-muted-foreground">{[p.detail, `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </Field>
  );
}

function ValueForm({ value, onChange }: { value: PushOptions | undefined; onChange: (p: PushOptions) => void }) {
  const v: PushOptions = value ?? { key: "" };
  useLanguage();
  const { info } = useWebhook();
  const set = (p: Partial<PushOptions>) => {
    const next = { ...v, ...p } as Record<string, unknown>;
    for (const k of Object.keys(next)) if (k !== "key" && (next[k] === undefined || next[k] === "")) delete next[k];
    onChange(next as unknown as PushOptions);
  };
  const keyOk = /^[a-z0-9][a-z0-9_.-]{0,47}$/.test(v.key);
  const cmd = curlPush(baseUrls(info)[0]!, keyOk ? v.key : t("<key>"));
  return (
    <>
      <Field label={t("Key")} id="f-push-key" hint={t("Lowercase letters, digits, _ . - (up to 48). This is the last part of the webhook path.")} error={keyOk ? undefined : t("Invalid key")}>
        <Input id="f-push-key" value={v.key} maxLength={48} placeholder={t("room-temperature")} onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/\s+/g, "-") })} />
      </Field>
      <Field label={t("Label")} id="f-push-label"><Input id="f-push-label" value={v.label ?? ""} maxLength={40} placeholder={t("Room temperature")} onChange={(e) => set({ label: e.target.value })} /></Field>
      <Field label={t("Unit")} id="f-push-unit"><Input id="f-push-unit" value={v.unit ?? ""} maxLength={12} placeholder="°C" onChange={(e) => set({ unit: e.target.value })} /></Field>
      <Field label={t("Test command (curl)")} id="f-push-curl" hint={t("Set WEBHOOK_KEY to the key from Integrations > Webhook.")}>
        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg bg-muted px-2.5 py-1.5 text-[11.5px]">{cmd}</code>
          <Button size="xs" variant="secondary" aria-label={t("Copy command")} icon={<Copy />} onClick={() => void navigator.clipboard?.writeText(cmd)} />
        </div>
      </Field>
    </>
  );
}

/** "Move to screen…": pick another screen; when it is full, pick the tile to trade places with. */
function MoveToScreen({ item, page, pages, onMove }: { item: Item; page: Page; pages: Page[]; onMove: (pageId: string, swapWith?: string) => "ok" | "full" | "error" }) {
  useLanguage();
  const [target, setTarget] = useState<Page | null>(null);
  const others = pages.filter((p) => p.id !== page.id);
  const tryMove = (p: Page) => { if (onMove(p.id) === "full") setTarget(p); };
  return (
    <div className="flex flex-col gap-2">
      <Select
        id="f-move"
        aria-label={t("Move to screen…")}
        value=""
        placeholder={t("Move to screen…")}
        onChange={(e) => { const p = others.find((x) => x.id === e.target.value); if (p) tryMove(p); }}
        options={others.map((p) => ({ value: p.id, label: p.name }))}
      />
      {target && (
        <div className="flex flex-col gap-2 rounded-xl border p-3">
          <p className="text-[13px] font-medium">{t("{name} is full. Pick a tile to swap with:", { name: target.name })}</p>
          <div className="grid gap-1 rounded-lg bg-muted/30 p-1.5" style={{ gridTemplateColumns: `repeat(${target.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${target.rows}, 26px)` }} role="group" aria-label={t("Tiles on {name}", { name: target.name })}>
            {target.items.map((o) => (
              <button key={o.id} type="button" title={tileName(o)} onClick={() => { const r = onMove(target.id, o.id); if (r !== "full") setTarget(null); }}
                className="min-w-0 truncate rounded-[5px] border bg-card px-1 text-[10.5px] transition-colors hover:border-primary hover:bg-primary/10"
                style={{ gridColumn: `${(o.x ?? 0) + 1} / span ${o.w ?? 1}`, gridRow: `${(o.y ?? 0) + 1} / span ${o.h ?? 1}` }}>{tileName(o)}</button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setTarget(null)}>{t("Cancel")}</Button>
        </div>
      )}
    </div>
  );
}

const findPluginWidget = (plugins: PluginInfo[], ref: { id: string; widget: string } | undefined) => {
  const plugin = plugins.find((p) => p.id === ref?.id);
  const widget = plugin?.widgets.find((w) => w.id === ref?.widget);
  return plugin && widget ? { plugin, widget } : undefined;
};

/** Per-tile settings of a plugin. Secrets are not shown here: they are set once in the Plugins tab and stay on the computer. */
function PluginSettings({ idBase, pluginId, fields, value, onChange }: { idBase: string; pluginId: string; fields: PluginField[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const shown = fields.filter((f) => f.type !== "secret");
  if (!shown.length) return null;
  return (
    <>
      {shown.map((f) => (
        <FieldInput key={f.key} id={`${idBase}-${f.key}`} field={f} value={value[f.key] ?? f.default ?? (f.type === "boolean" ? false : "")} secret="" pluginId={pluginId} settings={value} onSecret={() => undefined} onChange={(v) => onChange({ ...value, [f.key]: v })} />
      ))}
    </>
  );
}

function PluginWidgetForm({ item, plugins, onChange }: { item: Extract<Item, { kind: "widget" }>; plugins: PluginInfo[]; onChange: (p: PluginRef) => void }) {
  const ref = item.plugin;
  const found = findPluginWidget(plugins, ref);
  if (!ref) return <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>{t("This tile has no plugin set.")}</Alert>;
  if (!found) return <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>{t("The plugin {id} is missing or off. The tile shows a placeholder until it is back.", { id: ref.id })}</Alert>;
  const flat = ref.settings ?? {};
  const put = (settings: Record<string, string | number | boolean>) => onChange({ ...ref, settings });
  // The two core plugins keep the richer editors of the legacy tiles; their values stay flat (string, number, boolean).
  if (ref.id === "core.quota") {
    const provider = (typeof flat.provider === "string" && flat.provider ? flat.provider : "claude") as AiProvider;
    const w = typeof flat.windows === "string" && flat.windows ? flat.windows : "all";
    const q: QuotaOptions = {
      ...(typeof flat.chart === "string" && flat.chart ? { chart: flat.chart as QuotaOptions["chart"] } : {}),
      ...(w === "all" ? {} : { windows: w === "main" ? "main" as const : w.split(",").map((x) => x.trim()).filter(Boolean) }),
      ...(flat.showReset === false ? { showReset: false } : {}),
    };
    const fromQuota = (n: QuotaOptions | undefined, prov: AiProvider) => {
      const out: Record<string, string | number | boolean> = { ...flat, provider: prov };
      delete out.chart; delete out.windows; delete out.showReset;
      if (n?.chart) out.chart = n.chart;
      if (n?.windows) out.windows = Array.isArray(n.windows) ? n.windows.join(",") : n.windows;
      if (n?.showReset === false) out.showReset = false;
      return out;
    };
    return (
      <>
        <p className="text-xs text-muted-foreground">{found.plugin.name} · {found.widget.name}</p>
        <QuotaOptionsForm provider={provider} value={Object.keys(q).length ? q : undefined} onChange={(n) => put(fromQuota(n, provider))} />
        <Field label={t("AI tool")} id="f-provider" hint={t("Which tool's quota this tile shows.")}>
          <Select id="f-provider" value={provider} onChange={(e) => { const out = fromQuota(Object.keys(q).length ? q : undefined, e.target.value as AiProvider); delete out.account; put(out); }}
            options={AI_PROVIDERS.map((x) => ({ value: x, label: PROVIDER_LABEL[x] ?? x }))} />
        </Field>
      </>
    );
  }
  if (ref.id === "core.weather") {
    const wo: WeatherOptions = {
      ...(typeof flat.source === "string" && flat.source ? { source: flat.source as WeatherOptions["source"] } : {}),
      ...(typeof flat.entity === "string" && flat.entity ? { entity: flat.entity } : {}),
      ...(typeof flat.lat === "number" && typeof flat.lon === "number" ? { location: { name: typeof flat.locationName === "string" ? flat.locationName : "", lat: flat.lat, lon: flat.lon } } : {}),
      ...(typeof flat.show === "string" && flat.show ? { show: flat.show as WeatherOptions["show"] } : {}),
      ...(typeof flat.units === "string" && flat.units ? { units: flat.units as WeatherOptions["units"] } : {}),
    };
    return (
      <>
        <p className="text-xs text-muted-foreground">{found.plugin.name} · {found.widget.name}</p>
        <WeatherForm value={wo} onChange={(n) => {
          const out: Record<string, string | number | boolean> = {};
          if (n.source) out.source = n.source;
          if (n.entity) out.entity = n.entity;
          if (n.location) { out.locationName = n.location.name; out.lat = n.location.lat; out.lon = n.location.lon; }
          if (n.show) out.show = n.show;
          if (n.units) out.units = n.units;
          put(out);
        }} />
      </>
    );
  }
  return (
    <>
      <p className="text-xs text-muted-foreground">{found.plugin.name} · {found.widget.name}</p>
      <PluginStylePicker render={found.widget.render} value={ref.view?.style} suggested={found.widget.style}
        onChange={(style) => { const { view: _v, ...rest } = ref; onChange(style ? { ...rest, view: { style } } : rest); }} />
      <PluginSettings idBase="f-pl" pluginId={found.plugin.id} fields={found.widget.settings} value={ref.settings ?? {}} onChange={(settings) => onChange({ ...ref, settings })} />
    </>
  );
}

function PluginActionForm({ action: a, onChange }: { action: Extract<Action, { type: "plugin" }>; onChange: (a: Action) => void }) {
  const plugins = useEnabledPlugins();
  const plugin = plugins.find((p) => p.id === a.plugin);
  const def = plugin?.actions.find((x) => x.id === a.action);
  if (!def) return <Alert tone="warning" icon={<AlertTriangle className="size-4" />}>{t("The plugin {id} is missing or off. The button does nothing until it is back.", { id: a.plugin })}</Alert>;
  return (
    <>
      <p className="text-xs text-muted-foreground">{plugin!.name} · {def.name}</p>
      <PluginSettings idBase="f-pla" pluginId={a.plugin} fields={def.settings} value={a.settings ?? {}} onChange={(settings) => onChange({ ...a, settings })} />
    </>
  );
}
