/**
 * The `card` renderer (spec release 0.5, D2): a small JSON tree of built-in parts that the deck draws with the theme.
 * The ONE definition of the shapes, the limits and the check, used by the agent (live data and manifest previews), the deck
 * (which never trusts what it receives) and plugin authors (`@nookdeck/plugin` re-exports the types and the builders).
 * Pure: no imports, and no syntax Safari 12 cannot parse after the web build.
 */

export type CardTone = "default" | "muted" | "accent" | "ok" | "warn" | "bad";
export type CardGap = 0 | 1 | 2 | 3;
export type CardAlign = "start" | "center" | "end" | "between";
export type CardArgs = Record<string, string | number | boolean>;

/** One day with a dot in a `month` part. */
export interface CardMark { date: string; tone?: CardTone }
/** One event of a `week` part. `day` counts from the week's `start`; a timed event needs `start`, an all-day one has neither time. */
export interface CardWeekEvent { day: number; title: string; start?: string; end?: string; allDay?: boolean; tone?: CardTone }

export type CardNode =
  /** stack "auto" (C3): drawn as a column when the row's own box is about square or taller (width < 1.4 x height). It takes the free space. */
  | { t: "row"; gap?: CardGap; align?: CardAlign; grow?: boolean; stack?: "auto"; children: CardNode[] }
  | { t: "col"; gap?: CardGap; align?: CardAlign; grow?: boolean; children: CardNode[] }
  | { t: "text"; text: string; size?: "s" | "m" | "l"; tone?: CardTone; bold?: boolean }
  | { t: "number"; value: string | number; unit?: string; size?: "m" | "l" | "xl"; tone?: CardTone }
  | { t: "pill"; text: string; tone?: CardTone }
  /** 0..1 */
  | { t: "progress"; value: number; tone?: CardTone }
  /** A ring chart (C3). value 0..1; icon or text in the centre (text wins), label under it. arc "gauge": 270 degrees, open at the bottom. */
  | { t: "ring"; value: number; tone?: CardTone; icon?: string; text?: string; label?: string; size?: "s" | "m" | "l"; arc?: "full" | "gauge" }
  /** at most 60 points */
  | { t: "sparkline"; points: number[]; tone?: CardTone }
  /** an icon name the deck ships */
  | { t: "icon"; name: string; tone?: CardTone }
  /** data:image/png or data:image/jpeg, base64 */
  | { t: "image"; src: string; fit?: "cover" | "contain" }
  /** layout "tile" (C3): the icon above a label of up to two lines, filling its share of the free space */
  | { t: "button"; label: string; icon?: string; action: string; args?: CardArgs; tone?: CardTone; active?: boolean; layout?: "tile" }
  /** A month grid (C4), read-only. month "YYYY-MM"; today and selected "YYYY-MM-DD", from the computer's clock; weekStart 0 Sunday, 1 Monday (default). */
  | { t: "month"; month: string; today?: string; selected?: string; weekStart?: 0 | 1; marks?: CardMark[] }
  /** Up to seven days from `start` (C4), read-only: a time grid, or a list per day when it is too short. more[i]: events of day i that were left out. */
  | { t: "week"; start: string; days?: number; today?: string; now?: string; hour24?: boolean; from?: number; to?: number; events: CardWeekEvent[]; more?: number[] }
  /**
   * A market row (Nookdeck 0.7.4): symbol, a muted name, a price, a change chip and a week's or a day's chart. The deck lays it out
   * for its width (a name beside the symbol goes first, then the chart, then the chip) and lines the columns up with the card's other tickers. The
   * chart is drawn neutral (it may cover another period than the change): colour is the chip's. hero: a big row with a taller chart and `note` under
   * it, taking the card's free space. The plugin formats `price` and `change` ("$59,521", "−3.48%"); `tone` colours the chip.
   */
  | { t: "ticker"; symbol: string; name?: string; price: string; change?: string; tone?: CardTone; points?: number[]; note?: string; hero?: boolean }
  | { t: "spacer" };

/** The `data` of a card widget. */
export interface CardData { root: CardNode }

export const CARD_LIMITS = {
  /** the root is depth 1 */
  depth: 6,
  nodes: 60,
  /** any one text: text, number value, unit, pill, button label, a string arg */
  text: 200,
  /** bytes of the card as JSON, image sources left out */
  bytes: 32 * 1024,
  /** characters of all image sources of one card together (data URL included) */
  imageBytes: 200 * 1024,
  points: 60,
  args: 20,
  ringText: 6,
  ringLabel: 40,
  marks: 62,
  weekEvents: 40,
  eventTitle: 80,
  weekMore: 999,
  tickerSymbol: 16,
  tickerName: 60,
  tickerPrice: 40,
  tickerChange: 20,
  tickerNote: 80,
} as const;

const TONES = ["default", "muted", "accent", "ok", "warn", "bad"];
const ALIGNS = ["start", "center", "end", "between"];
const FIELDS: Record<string, string[]> = {
  row: ["gap", "align", "grow", "stack", "children"],
  col: ["gap", "align", "grow", "children"],
  text: ["text", "size", "tone", "bold"],
  number: ["value", "unit", "size", "tone"],
  pill: ["text", "tone"],
  progress: ["value", "tone"],
  sparkline: ["points", "tone"],
  ring: ["value", "tone", "icon", "text", "label", "size", "arc"],
  icon: ["name", "tone"],
  image: ["src", "fit"],
  button: ["label", "icon", "action", "args", "tone", "active", "layout"],
  month: ["month", "today", "selected", "weekStart", "marks"],
  week: ["start", "days", "today", "now", "hour24", "from", "to", "events", "more"],
  ticker: ["symbol", "name", "price", "change", "tone", "points", "note", "hero"],
  spacer: [],
};
const DAY_RE = /^[12]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_RE = /^[12]\d{3}-(0[1-9]|1[0-2])$/;
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ICON_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$/;
const ACTION_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const ARG_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const IMAGE_RE = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

class CardError extends Error {}
const bad = (m: string): never => { throw new CardError(m); };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && isFinite(v);

interface Ctx { nodes: number; images: number }

function str(v: unknown, where: string, max: number = CARD_LIMITS.text): string {
  if (typeof v !== "string") return bad(`${where} must be text`);
  if (v.length > max) bad(`${where} is longer than ${max} characters`);
  return v;
}

function oneOf<T>(v: unknown, list: readonly unknown[], where: string): T {
  if (list.indexOf(v) < 0) bad(`${where} must be one of ${list.join(", ")}`);
  return v as T;
}

function bool(v: unknown, where: string): boolean {
  if (typeof v !== "boolean") bad(`${where} must be true or false`);
  return v as boolean;
}

/** A date that is in the calendar: "2026-02-30" is not. */
function dayText(v: unknown, where: string): string {
  if (typeof v === "string" && DAY_RE.test(v)) {
    const d = new Date(Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8)));
    if (d.getUTCDate() === +v.slice(8)) return v;
  }
  return bad(`${where} must be a date like "2026-11-25"`);
}

/** "HH:MM"; `last` also takes "24:00", the end of the day. */
function timeText(v: unknown, where: string, last?: boolean): string {
  if (typeof v === "string" && (TIME_RE.test(v) || (last && v === "24:00"))) return v;
  return bad(`${where} must be a time like "09:30"`);
}

function whole(v: unknown, where: string, min: number, max: number): number {
  if (!finite(v) || Math.floor(v) !== v || v < min || v > max) bad(`${where} must be a whole number from ${min} to ${max}`);
  return v as number;
}

/** An entry of `marks` or `events`: an object with no fields but these. */
function entry(v: unknown, where: string, fields: readonly string[]): Record<string, unknown> {
  if (!isObj(v)) return bad(`${where} must be an object`);
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) if (v[keys[i]!] !== undefined && fields.indexOf(keys[i]!) < 0) bad(`${where}: "${keys[i]!.slice(0, 20)}" is not one of its fields`);
  return v;
}

function mark(v: unknown, where: string): CardMark {
  const m = entry(v, where, ["date", "tone"]);
  const out: CardMark = { date: dayText(m.date, `${where}.date`) };
  if (m.tone !== undefined) out.tone = oneOf(m.tone, TONES, `${where}.tone`);
  return out;
}

function weekEvent(v: unknown, where: string, days: number): CardWeekEvent {
  const e = entry(v, where, ["day", "title", "start", "end", "allDay", "tone"]);
  const out: CardWeekEvent = { day: whole(e.day, `${where}.day`, 0, days - 1), title: str(e.title, `${where}.title`, CARD_LIMITS.eventTitle) };
  if (e.allDay !== undefined) out.allDay = bool(e.allDay, `${where}.allDay`);
  if (out.allDay) {
    if (e.start !== undefined || e.end !== undefined) bad(`${where}: an all-day event has no start or end`);
  } else {
    out.start = timeText(e.start, `${where}.start`);
    if (e.end !== undefined) {
      out.end = timeText(e.end, `${where}.end`, true);
      if (out.end <= out.start) bad(`${where}.end must be after its start (split an event that goes over midnight, one for each day)`);
    }
  }
  if (e.tone !== undefined) out.tone = oneOf(e.tone, TONES, `${where}.tone`);
  return out;
}

function node(v: unknown, where: string, depth: number, ctx: Ctx): CardNode {
  if (!isObj(v)) return bad(`${where} must be an object`);
  if (depth > CARD_LIMITS.depth) bad(`the card is nested more than ${CARD_LIMITS.depth} levels`);
  if (++ctx.nodes > CARD_LIMITS.nodes) bad(`the card has more than ${CARD_LIMITS.nodes} parts`);
  const t = v.t;
  if (typeof t !== "string" || !Object.prototype.hasOwnProperty.call(FIELDS, t)) return bad(`${where}: unknown part "${String(t).slice(0, 20)}"`);
  const allowed = FIELDS[t]!;
  const keys = Object.keys(v);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (k !== "t" && v[k] !== undefined && allowed.indexOf(k) < 0) bad(`${where}: "${k.slice(0, 20)}" is not a field of ${t}`);
  }
  const out: Record<string, unknown> = { t };
  const has = (k: string): boolean => v[k] !== undefined;
  const tone = (): void => { if (has("tone")) out.tone = oneOf(v.tone, TONES, `${where}.tone`); };
  if (t === "row" || t === "col") {
    if (has("gap")) out.gap = oneOf(v.gap, [0, 1, 2, 3], `${where}.gap`);
    if (has("align")) out.align = oneOf(v.align, ALIGNS, `${where}.align`);
    if (has("grow")) out.grow = bool(v.grow, `${where}.grow`);
    if (has("stack")) out.stack = oneOf(v.stack, ["auto"], `${where}.stack`);
    const list = v.children;
    if (!Array.isArray(list)) return bad(`${where}.children must be a list`);
    if (list.length > CARD_LIMITS.nodes) bad(`the card has more than ${CARD_LIMITS.nodes} parts`);
    out.children = list.map((c, i) => node(c, `${where}.children[${i}]`, depth + 1, ctx));
  } else if (t === "text") {
    out.text = str(v.text, `${where}.text`);
    if (has("size")) out.size = oneOf(v.size, ["s", "m", "l"], `${where}.size`);
    if (has("bold")) out.bold = bool(v.bold, `${where}.bold`);
    tone();
  } else if (t === "number") {
    out.value = finite(v.value) ? v.value : typeof v.value === "string" ? str(v.value, `${where}.value`) : bad(`${where}.value must be a number or text`);
    if (has("unit")) out.unit = str(v.unit, `${where}.unit`);
    if (has("size")) out.size = oneOf(v.size, ["m", "l", "xl"], `${where}.size`);
    tone();
  } else if (t === "pill") {
    out.text = str(v.text, `${where}.text`);
    tone();
  } else if (t === "progress") {
    if (!finite(v.value)) bad(`${where}.value must be a number from 0 to 1`);
    out.value = Math.min(1, Math.max(0, v.value as number));
    tone();
  } else if (t === "ring") {
    if (!finite(v.value)) bad(`${where}.value must be a number from 0 to 1`);
    out.value = Math.min(1, Math.max(0, v.value as number));
    if (has("icon")) {
      if (typeof v.icon !== "string" || !ICON_RE.test(v.icon)) bad(`${where}.icon must be an icon name`);
      out.icon = v.icon;
    }
    if (has("text")) out.text = str(v.text, `${where}.text`, CARD_LIMITS.ringText);
    if (has("label")) out.label = str(v.label, `${where}.label`, CARD_LIMITS.ringLabel);
    if (has("size")) out.size = oneOf(v.size, ["s", "m", "l"], `${where}.size`);
    if (has("arc")) out.arc = oneOf(v.arc, ["full", "gauge"], `${where}.arc`);
    tone();
  } else if (t === "month") {
    if (typeof v.month !== "string" || !MONTH_RE.test(v.month)) bad(`${where}.month must be a month like "2026-11"`);
    out.month = v.month;
    if (has("today")) out.today = dayText(v.today, `${where}.today`);
    if (has("selected")) out.selected = dayText(v.selected, `${where}.selected`);
    if (has("weekStart")) out.weekStart = oneOf(v.weekStart, [0, 1], `${where}.weekStart`);
    if (has("marks")) {
      const list = v.marks;
      if (!Array.isArray(list) || list.length > CARD_LIMITS.marks) return bad(`${where}.marks must be a list of at most ${CARD_LIMITS.marks}`);
      out.marks = list.map((m, i) => mark(m, `${where}.marks[${i}]`));
    }
  } else if (t === "week") {
    out.start = dayText(v.start, `${where}.start`);
    const days = has("days") ? whole(v.days, `${where}.days`, 1, 7) : 7;
    if (has("days")) out.days = days;
    if (has("today")) out.today = dayText(v.today, `${where}.today`);
    if (has("now")) out.now = timeText(v.now, `${where}.now`);
    if (has("hour24")) out.hour24 = bool(v.hour24, `${where}.hour24`);
    if (has("from")) out.from = whole(v.from, `${where}.from`, 0, 23);
    if (has("to")) out.to = whole(v.to, `${where}.to`, 1, 24);
    if (has("from") && has("to") && (out.from as number) >= (out.to as number)) bad(`${where}.to must be after from`);
    const list = v.events;
    if (!Array.isArray(list) || list.length > CARD_LIMITS.weekEvents) return bad(`${where}.events must be a list of at most ${CARD_LIMITS.weekEvents}`);
    out.events = list.map((e, i) => weekEvent(e, `${where}.events[${i}]`, days));
    if (has("more")) {
      const more = v.more;
      if (!Array.isArray(more) || more.length > days) return bad(`${where}.more must be a list of at most one number for each day`);
      out.more = more.map((n, i) => whole(n, `${where}.more[${i}]`, 0, CARD_LIMITS.weekMore));
    }
  } else if (t === "ticker") {
    out.symbol = str(v.symbol, `${where}.symbol`, CARD_LIMITS.tickerSymbol);
    if (!out.symbol) bad(`${where}.symbol must not be empty`);
    if (has("name")) out.name = str(v.name, `${where}.name`, CARD_LIMITS.tickerName);
    out.price = str(v.price, `${where}.price`, CARD_LIMITS.tickerPrice);
    if (has("change")) out.change = str(v.change, `${where}.change`, CARD_LIMITS.tickerChange);
    if (has("points")) {
      const p = v.points;
      if (!Array.isArray(p) || p.length > CARD_LIMITS.points || !p.every(finite)) bad(`${where}.points must be at most ${CARD_LIMITS.points} numbers`);
      out.points = (p as number[]).slice();
    }
    if (has("note")) out.note = str(v.note, `${where}.note`, CARD_LIMITS.tickerNote);
    if (has("hero")) out.hero = bool(v.hero, `${where}.hero`);
    tone();
  } else if (t === "sparkline") {
    const p = v.points;
    if (!Array.isArray(p) || p.length > CARD_LIMITS.points || !p.every(finite)) bad(`${where}.points must be at most ${CARD_LIMITS.points} numbers`);
    out.points = (p as number[]).slice();
    tone();
  } else if (t === "icon") {
    if (typeof v.name !== "string" || !ICON_RE.test(v.name)) bad(`${where}.name must be an icon name`);
    out.name = v.name;
    tone();
  } else if (t === "image") {
    const src = v.src;
    if (typeof src !== "string") return bad(`${where}.src must be a data:image/png or data:image/jpeg address`);
    ctx.images += src.length;
    if (ctx.images > CARD_LIMITS.imageBytes) bad(`the card's images are larger than ${CARD_LIMITS.imageBytes / 1024} KB`);
    if (!IMAGE_RE.test(src)) bad(`${where}.src must be a base64 data:image/png or data:image/jpeg address`);
    out.src = src;
    if (has("fit")) out.fit = oneOf(v.fit, ["cover", "contain"], `${where}.fit`);
  } else if (t === "button") {
    out.label = str(v.label, `${where}.label`);
    if (has("icon")) {
      if (typeof v.icon !== "string" || !ICON_RE.test(v.icon)) bad(`${where}.icon must be an icon name`);
      out.icon = v.icon;
    }
    if (!out.label && !out.icon) bad(`${where} needs a label or an icon`);
    if (typeof v.action !== "string" || !ACTION_RE.test(v.action)) bad(`${where}.action must be the id of one of the plugin's actions`);
    out.action = v.action;
    if (has("args")) out.args = cardArgs(v.args, `${where}.args`);
    if (has("active")) out.active = bool(v.active, `${where}.active`);
    if (has("layout")) out.layout = oneOf(v.layout, ["tile"], `${where}.layout`);
    tone();
  }
  return out as unknown as CardNode;
}

/** A button's `args`: up to 20 flat values. Throws; also used for what a phone sends back. */
function cardArgs(v: unknown, where: string): CardArgs {
  if (!isObj(v)) return bad(`${where} must be an object`);
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  if (keys.length > CARD_LIMITS.args) bad(`${where} has more than ${CARD_LIMITS.args} values`);
  const out: CardArgs = {};
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (!ARG_KEY_RE.test(k)) bad(`${where}: "${k.slice(0, 20)}" is not a setting name`);
    const x = v[k];
    if (typeof x === "boolean" || finite(x)) out[k] = x;
    else out[k] = str(x, `${where}.${k}`);
  }
  return out;
}

/** Checks `data` of a card widget. Returns a clean copy, or a short message for the tile and the plugin's author. */
export function validateCard(data: unknown): { data: CardData } | { error: string } {
  try {
    if (!isObj(data)) return bad("a card needs { root }");
    const extra = Object.keys(data).filter((k) => k !== "root" && data[k] !== undefined);
    if (extra.length) bad(`a card has only "root", not "${extra[0]!.slice(0, 20)}"`);
    const ctx: Ctx = { nodes: 0, images: 0 };
    const root = node(data.root, "root", 1, ctx);
    const json = JSON.stringify({ root }, (k, v) => (k === "src" && typeof v === "string" ? "" : v));
    if (new TextEncoder().encode(json).length > CARD_LIMITS.bytes) bad(`the card is larger than ${CARD_LIMITS.bytes / 1024} KB`);
    return { data: { root } };
  } catch (e) {
    if (e instanceof CardError) return { error: `card: ${e.message}` };
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------ builders

type Opts<T extends CardNode["t"], K extends string> = Omit<Extract<CardNode, { t: T }>, "t" | K>;
/** Children may hold false / null / undefined, so `cond && card.text(...)` works. */
export type CardChildren = Array<CardNode | false | null | undefined>;

const make = (t: CardNode["t"], fields: object): any => {
  const out: Record<string, unknown> = { t };
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) out[k] = v;
  return out;
};
const kids = (c: CardChildren): CardNode[] => c.filter((x): x is CardNode => !!x);

type BoxOpts = { gap?: CardGap; align?: CardAlign; grow?: boolean };

/** `return { render: "card", data: card.root(card.col([card.text("Hi")])) }` */
export const card = {
  root: (root: CardNode): CardData => ({ root }),
  row: (children: CardChildren, o: BoxOpts & { stack?: "auto" } = {}): CardNode => make("row", { ...o, children: kids(children) }),
  col: (children: CardChildren, o: BoxOpts = {}): CardNode => make("col", { ...o, children: kids(children) }),
  text: (text: string, o: Opts<"text", "text"> = {}): CardNode => make("text", { ...o, text }),
  number: (value: string | number, o: Opts<"number", "value"> = {}): CardNode => make("number", { ...o, value }),
  pill: (text: string, o: Opts<"pill", "text"> = {}): CardNode => make("pill", { ...o, text }),
  progress: (value: number, o: Opts<"progress", "value"> = {}): CardNode => make("progress", { ...o, value }),
  /** a ring chart: `card.ring(0.95, { icon: "battery", label: "95%", tone: "ok" })` */
  ring: (value: number, o: Opts<"ring", "value"> = {}): CardNode => make("ring", { ...o, value }),
  /** keeps the last 60 points */
  sparkline: (points: number[], o: Opts<"sparkline", "points"> = {}): CardNode => make("sparkline", { ...o, points: points.slice(-CARD_LIMITS.points) }),
  icon: (name: string, o: Opts<"icon", "name"> = {}): CardNode => make("icon", { ...o, name }),
  image: (src: string, o: Opts<"image", "src"> = {}): CardNode => make("image", { ...o, src }),
  button: (label: string, action: string, o: Opts<"button", "label" | "action"> = {}): CardNode => make("button", { ...o, label, action }),
  /** a month grid: `card.month("2026-11", { today: "2026-11-25", marks: [{ date: "2026-11-27", tone: "ok" }] })` */
  month: (month: string, o: Opts<"month", "month"> = {}): CardNode => make("month", { ...o, month }),
  /** days from `start` with their events: `card.week("2026-11-23", [{ day: 0, start: "09:30", end: "10:00", title: "Plan" }])` */
  week: (start: string, events: CardWeekEvent[], o: Opts<"week", "start" | "events"> = {}): CardNode => make("week", { ...o, start, events }),
  /** a market row: `card.ticker("BTC", "$59,521", { name: "Bitcoin", change: "−3.48%", tone: "bad", points })` (Nookdeck 0.7.4); keeps the last 60 points */
  ticker: (symbol: string, price: string, o: Opts<"ticker", "symbol" | "price"> = {}): CardNode =>
    make("ticker", { ...o, symbol, price, points: o.points ? o.points.slice(-CARD_LIMITS.points) : undefined }),
  spacer: (): CardNode => ({ t: "spacer" }),
};
