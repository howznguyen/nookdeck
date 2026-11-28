# Writing Nookdeck plugins

A plugin adds tiles and buttons to Nookdeck. It is a folder (usually a GitHub repo) with a `nookdeck.json` file. This guide starts with **no-code plugins**, which need no JavaScript, and then covers [plugins with code](#plugins-with-code).

## Quick start

1. Copy [`nookdeck-plugins/plugins/crypto-price`](https://github.com/howznguyen/nookdeck-plugins/tree/main/plugins/crypto-price).
2. Change `id`, `name` and the widget.
3. In the manage page open **Plugins**, paste the folder path (or a GitHub address, or an https link to the `nookdeck.json`), read the access list and press **Allow and turn on**.
4. Add your tile to a screen.

## The manifest

```json
{
  "id": "dev.alice.crypto",
  "name": "Crypto price",
  "version": "1.0.0",
  "nookdeck": ">=0.2.0",
  "author": "alice",
  "description": "Live price of a coin",
  "icon": "icon.svg",
  "permissions": { "network": ["api.coingecko.com"] },
  "widgets": [ ... ],
  "actions": [ ... ]
}
```

| Field | Notes |
|---|---|
| `id` | Reverse-DNS style, `dev.<author>.<name>`. `core.*` is reserved for Nookdeck. |
| `version` | Exact version. Each install is pinned to a version and a hash of the package. |
| `nookdeck` | The Nookdeck versions the plugin works with. |
| `permissions` | Everything the plugin may touch. See below. |
| `os` | Optional: `["darwin"]`, `["win32"]`, `["linux"]` or several of them. Leave it out when the plugin works on every system. |
| `widgets`, `actions` | What the plugin adds. |

### One system only

Set `"os": ["darwin"]` for a plugin that needs a Mac. On another system the install (also `nookdeck plugin dev`) is refused with "This plugin works on macOS only" (the message names your list), a copy that is already there is shown disabled with the same reason, and the Store shows a macOS badge. Nookdeck before 0.5.0 ignores the field, so also set `"nookdeck": ">=0.5.0"`; the same goes for a `card` widget. A Nookdeck run from source counts as a development build and accepts any minimum.

## Permissions

The user sees this list before the plugin turns on, and nothing runs until they agree. An update that asks for more needs a new OK.

| Key | Meaning |
|---|---|
| `network` | A list of hosts the plugin may call. Calls to any other host fail. A WebSocket address goes in the same list with its scheme and port, like `ws://127.0.0.1:4455` (see [WebSockets](#websockets)). |
| `shell` | Run commands on the computer (needed by `command` sources). |
| `keyboard` | Press keys and type text. |
| `storage` | Keep the plugin's own data. |
| `onair` | Turn On Air on while the plugin reports it is live or recording (see [On Air](#on-air)). |
| `notify` | Show notifications on the phones, with an optional sound (see [Notifications](#notifications)). |

Ask for the least you need. Plugins from a link or a folder are shown as **Unreviewed**.

## Widgets

A widget is a tile. It describes where its data comes from and how to show it.

```json
{
  "id": "price",
  "name": "Price",
  "render": "stat",
  "sizes": ["2x1", "2x2"],
  "settings": [{ "key": "coin", "type": "string", "label": "Coin id", "default": "bitcoin" }],
  "source": {
    "http": { "url": "https://api.coingecko.com/api/v3/simple/price?ids={{coin}}&vs_currencies=usd", "every": 60 },
    "map": { "value": "$.{{coin}}.usd", "unit": "USD", "label": "{{coin}}" }
  }
}
```

`{{key}}` inserts a setting. `every` is the refresh time in seconds.

**Commands never get `{{key}}`.** A `shell` macro step or a `command` source that contains `{{...}}` is rejected at install: a value with a quote, `;` or `$(...)` would run as code. The command reads its settings from the environment instead, as `NOOKDECK_SETTING_<KEY>` (key in capitals): `printf '%s' "$NOOKDECK_SETTING_TEXT" | pbcopy` on macOS/Linux, `$env:NOOKDECK_SETTING_TEXT` in PowerShell. Always put the variable in double quotes in sh.

### Sources

- `http`: GET a URL, then `map` the JSON with dot paths (`$.a.b`). The host must be in `permissions.network`.
- `command`: run a command (needs `shell`). The output is read as JSON or plain text.

### Renderers

The phone draws your data with a built-in renderer. No plugin code runs on the phone.

| `render` | `data` |
|---|---|
| `stat` | `{ value, unit?, label?, delta?, color?, points? }`, `points` up to 60 numbers (the `spark` style draws them) |
| `gauge` | `{ value 0-100, label?, color? }` |
| `text` | `{ title?, body }` |
| `list` | `{ items: [{ title, subtitle?, value?, icon? }] }`, up to 20 items |
| `chart` | `{ points: number[], label?, unit? }`, up to 120 points |
| `image` | `{ url (https or data:), fit? }` |
| `status` | `{ state: ok / warn / error / off, label, title?, value?, unit?, detail?, points? }`: `title` up to 40 characters, `value` up to 12, `unit` up to 8, `detail` up to 60, `points` up to 60 numbers |
| `card` | `{ root }`, a tree of parts you lay out yourself (see [Cards](#cards)) |

If the data does not fit the renderer, the tile shows a neutral error instead of breaking.

### Styles

Each renderer can be drawn in more than one way. The person who adds your tile picks one in the tile's **Style** list. The first style of each renderer is its default.

| `render` | Styles |
|---|---|
| `stat` | `plain`, `spark` (a sparkline, only when `data.points` exist), `big` |
| `gauge` | `arc`, `ring`, `half`, `bar` |
| `text` | `plain`, `minimal` |
| `list` | `rows`, `compact` |
| `chart` | `line`, `area`, `bars`, `dots` |
| `image` | `cover`, `contain` |
| `status` | `card`, `pill`, `dot` |

A widget can suggest a style with `"style"` in its manifest entry, for example `{ "id": "history", "render": "chart", "style": "area", ... }`. It must be one of the renderer's styles. The tile's own choice wins, then your suggestion, then the default. The manage page marks the suggestion "Suggested". The table lives in `web/shared/plugin-styles.ts`.

### Cards

`card` is the renderer for a tile you design: rows, columns, texts, numbers, buttons. You send a tree of parts; the phone draws them with the current theme. There is no HTML, CSS or script, so a card cannot run anything on the phone. A card has no styles.

| `t` | Fields (`?` = optional) |
|---|---|
| `row`, `col` | `children`, `gap?` 0-3 (default 1), `align?` `start` / `center` / `end` / `between` (along the row or column), `grow?` (takes the free space). A `row` also takes `stack?` `"auto"` (see below; needs Nookdeck 0.5.1) |
| `text` | `text`, `size?` `s` / `m` / `l`, `tone?`, `bold?` |
| `number` | `value` (number or text, such as `"12:30"`), `unit?`, `size?` `m` / `l` / `xl` (default `l`), `tone?` |
| `pill` | `text`, `tone?` |
| `progress` | `value` 0 to 1, `tone?` |
| `ring` | `value` 0 to 1, `tone?` (colour of the arc), `icon?` or `text?` in the centre (`text` up to 6 characters, such as `"95"` or `"18:16"`; it wins over `icon`), `label?` under the ring (up to 40 characters), `size?` `s` / `m` / `l` (default `m`), `arc?` `full` (default) / `gauge` (270 degrees, open at the bottom). Needs Nookdeck 0.5.1 |
| `sparkline` | `points` (up to 60 numbers), `tone?` |
| `ticker` | A market row: `symbol` (up to 16 characters), `price` (your formatted text, such as `"$59,521"`), `name?`, `change?` (such as `"−3.48%"`, drawn as a soft chip coloured by `tone?`), `points?` (up to 60 numbers, drawn as a thin neutral chart: it may cover another period than the change, so colour is the chip's), `hero?` (a big row with a taller chart that takes the free space) and `note?` under a hero's chart (up to 80 characters). The phone fits it to its width (a name beside the symbol goes first, then the chart, then the chip) and lines up the columns of a card's tickers. Needs Nookdeck 0.7.4 |
| `icon` | `name` (see **Icons** below), `tone?` |
| `image` | `src` (`data:image/png;base64,...` or `data:image/jpeg;base64,...` only), `fit?` `cover` / `contain` |
| `button` | `action` (the id of one of your `actions`), `label?` and/or `icon?`, `args?`, `tone?`, `active?` (drawn filled), `layout?` `"tile"` (see below; needs Nookdeck 0.5.1) |
| `month` | `month` `"2026-11"`, `today?` and `selected?` `"2026-11-25"`, `weekStart?` 0 (Sunday) or 1 (Monday, default), `marks?` up to 62 of `{ date, tone? }` (see **Calendars** below; needs Nookdeck 0.5.1) |
| `week` | `start` `"2026-11-23"`, `events` up to 40, `days?` 1-7 (default 7), `today?`, `now?` `"16:20"`, `hour24?` (default true), `from?` 0-23, `to?` 1-24, `more?` (see **Calendars** below; needs Nookdeck 0.5.1) |
| `spacer` | none; takes the free space |

`tone` is `default`, `muted`, `accent` (the tile's colour), `ok`, `warn` or `bad`.

**Limits.** At most 6 levels and 60 parts; a text (any string you show, and each string in `args`) up to 200 characters; `args` up to 20 keys; the card as JSON up to 32 KB not counting image `src` strings; all image `src` strings of one card together up to 204800 characters. Unknown parts and unknown fields are refused. A card that breaks a rule is not drawn: the tile shows the reason (it starts with `card:`). Check it yourself with `validateCard(data)`.

**Rings.** Rings share the free space equally and stay round: put two to four in a `row`, or two rows of two in a `col`, for a battery-widget look. `size` is how much of its share a ring fills (`s` 60%, `m` 80%, `l` all of it), and rings of the same size are drawn equally big. The arc moves smoothly when `value` changes. For `tone`, `default` is the theme's accent and `accent` the tile's colour. On a tile too small for them, the labels under all the rings are left out. A Nookdeck before 0.5.1 refuses a card with a ring, so set `"nookdeck": ">=0.5.1"`.

```ts
const battery = (name: string, level: number, icon: string) =>
  card.ring(level / 100, { icon, label: `${level}%`, tone: level <= 20 ? "bad" : "ok" });

card.root(card.row([
  card.row([battery("Mac", 95, "laptop"), battery("Keys", 62, "keyboard")], { gap: 1, grow: true }),
  card.row([battery("Mouse", 18, "mouse"), battery("Buds", 80, "headphones")], { gap: 1, grow: true }),
], { stack: "auto", gap: 1 })); // two rows of two on a square tile, four in a line on a wide one
```

**One card for wide and square tiles.** A row can choose its direction itself: with `stack: "auto"` it is drawn as a column when its box is about square or taller (narrower than 1.4 times its height), and as a row otherwise. Such a row takes the free space. With one ring among other parts, the ring is as large as the row is high when they are side by side (unless you give it a `size`), and takes the space the others leave when stacked. Rows without `stack` never change direction.

```ts
card.root(card.row([
  card.ring(0.73, { text: "18:16", arc: "full" }),
  card.col([card.text("Focus", { bold: true }), card.button("Pause", "toggle", { icon: "pause" })], { gap: 1 }),
], { stack: "auto", gap: 2 }));
```

**Tile buttons.** `layout: "tile"` puts the icon above a label of up to two lines, centred, and lets the button fill its share of the free space: use it for a panel of controls. Buttons in a row get equal widths, and rows of them share the height. The icon grows with the button, and gets smaller again to leave a long label its second line (on short buttons the labels get a little smaller too); with no label it is a big icon. On a short tile (such as 2x1) the card's tile buttons put icon and label side by side, and on a very narrow one they show icons alone. Buttons without `layout` are not changed.

```ts
const key = (label: string, action: string, icon: string, active = false) => card.button(label, action, { icon, active, layout: "tile" });

card.root(card.col([
  card.row([key("Dark mode", "toggle-dark", "moon", true), key("Keep awake", "keep-awake", "coffee")], { gap: 1, grow: true }),
  card.row([key("Lock", "lock", "lock"), key("Display off", "display-off", "monitor")], { gap: 1, grow: true }),
], { gap: 1, grow: true }));
```

**Calendars.** `month` and `week` are read-only calendars that the phone draws itself. Each counts as **one** of the 60 parts, takes the free space, fits itself to it and is never left out. A Nookdeck before 0.5.1 refuses a card with one, so set `"nookdeck": ">=0.5.1"`. Dates and times are the computer's: `today` and `now` come from your card, never from the phone's clock. Month and weekday names are in the phone's language.

- `month` shows the month's name, weekday letters and its weeks. `today` has a ring and `selected` is filled. A day with entries in `marks` has dots, one for each, at most three, coloured by `tone`; marks outside the month are not shown. On a small tile the dots move onto the days' circles, then the name is left out. In a `row`, a month is about as wide as it is high (at most 45% of the row), and it and the columns beside it start at the top.
- `week` shows `days` days from `start`. Each of its `events` is `{ day, title, start?, end?, allDay?, tone? }`: `day` counts from `start` (0 is the first), `title` is up to 80 characters, times are `"HH:MM"` and `end` may be `"24:00"`. An all-day event (`allDay: true`) has no times; any other needs `start`, and without `end` it lasts an hour. `end` must be after `start`: split an event that goes over midnight, one for each day. Give events that are over `tone: "muted"`.
  When no event has a time (all of them are all-day, or there are none), there are no hours: under the days comes one line for each event, with its day and full title ("Tue 24 · Culture Day"). The same event on days that follow each other is one line with both ends. The part is then only as high as its lines, so what the card has after it comes right under them, and `from` and `to` are not used.
- With room for at least 18 px an hour, a week is a time grid with a strip for all-day events (two lines) and a line at `now`. It shows the hours the events span, at least six, unless you set `from` and `to`; an event partly outside them is cut off at the edge. Events that overlap sit side by side, two at most (one in a narrow column).
- With less room it is a list for each day: all-day events first, then the time and the title.
- What does not fit is counted as **+n** under its day, and muted events give way first. `more` adds your own count for each day, `[0, 3]` for three events of the second day that you did not send (a card holds 40).

```ts
card.root(card.row([
  card.month("2026-11", { today: "2026-11-25", selected: "2026-11-25", marks: [{ date: "2026-11-27", tone: "ok" }] }),
  card.col([card.text("Wed 25 Nov", { bold: true }), card.text("Nothing today", { tone: "muted" })], { grow: true }),
], { gap: 2, grow: true }));

card.root(card.week("2026-11-23", [
  { day: 0, start: "09:30", end: "10:00", title: "Plan", tone: "muted" },
  { day: 3, allDay: true, title: "Release", tone: "accent" },
], { today: "2026-11-25", now: "16:20" }));
```

**Icons.** `icon` in a card (the `icon` part, a button's and a ring's) takes a built-in name: [Tabler](https://tabler.io/icons) names, and a few brand marks. Older short names such as `laptop`, `monitor` and `battery` work too. The full Tabler catalog is not available in cards. Any other name is drawn as a dim square; `nookdeck plugin dev` warns about names in your previews, and the plugin log (`nookdeck plugin logs <id>`) about names in live cards.

<!-- card-icons:start -->
`activity` `adjustments-horizontal` `alarm` `alert-triangle` `arrow-back-up` `arrow-down` `arrow-down-left` `arrow-forward-up` `arrow-left` `arrow-right` `arrow-up` `arrows-shuffle` `ban` `battery-4` `bell` `bell-off` `bluetooth` `bolt` `bookmark` `brand-apple` `brand-chrome` `brand-discord` `brand-figma` `brand-github` `brand-google` `brand-notion` `brand-slack` `brand-spotify` `brand-telegram` `brand-twitch` `brand-vscode` `brand-x` `brand-youtube` `brightness` `bulb` `calendar` `calendar-check` `calendar-event` `camera` `check` `chevron-left` `chevron-right` `circle-check` `circle-x` `clipboard` `clock` `code` `coffee` `command` `copy` `cpu` `device-desktop` `device-floppy` `device-gamepad-2` `device-laptop` `device-speaker` `download` `external-link` `file` `file-text` `flag` `folder` `folder-open` `gauge` `headphones` `heart` `home` `keyboard` `layout-dashboard` `layout-grid` `link` `lock` `lock-open` `mail` `maximize` `message` `message-circle` `microphone` `microphone-off` `minimize` `minus` `moon` `mouse` `music` `photo` `player-pause` `player-play` `player-skip-back` `player-skip-forward` `player-stop` `player-track-next` `player-track-prev` `plus` `power` `radio` `refresh` `repeat` `robot` `rocket` `scissors` `screen-share` `search` `server` `settings` `shopping-cart` `sparkles` `stack-2` `star` `sun` `terminal-2` `trash` `typography` `upload` `video` `volume` `volume-2` `volume-3` `wifi` `world` `x` `zoom-in` `zoom-out`

Brands: `antigravity` `claude` `claude-code` `codex` `gemini` `grok` `opencode`
<!-- card-icons:end -->

**Fitting.** The same card is drawn at every tile size, unless your provider [looks at the tile's size](#tile-size). The text gets smaller to fit, including until button labels show in full (one label too long for any size keeps the whole card at the smallest text, so keep labels short; when a button with an icon has no room for its label, the buttons with icons show their icons alone); if it still does not fit, the last parts of a column are left out. So put the important parts first.

**Buttons.** A tap runs your own action with that id, through the same path as a plugin button in the layout. `args` reach `ctx.actions.handle` as the action's settings, so **declare every key in the action's `settings`**: undeclared keys are dropped, a value that does not fit its type is refused, and `secret` fields only come from the plugin's saved settings. The handler gets the plugin-wide settings plus these values (and the action's defaults), not the settings of the tile that was tapped; put what you need to tell tiles apart in `args`. The agent only accepts a button that is on the card it sent (or the one just before). After the action the agent asks your tiles for fresh data, so the card shows the new state; you can also call `ctx.widgets.push`. If the handler throws, the phone shows the message.

In `nookdeck.json`:

```json
{
  "main": "index.ts",
  "widgets": [{ "id": "timer", "name": "Focus timer", "render": "card", "sizes": ["2x2", "4x2"],
    "preview": { "root": { "t": "col", "children": [{ "t": "number", "value": "25:00", "size": "xl" }] } } }],
  "actions": [{ "id": "toggle", "name": "Start or pause",
    "settings": [{ "key": "to", "type": "select", "label": "To", "options": ["run", "pause"] }] }]
}
```

In `index.ts`:

```ts
import { card, type PluginContext } from "@nookdeck/plugin";

let running = false;

export function activate(ctx: PluginContext) {
  const view = () => ({
    render: "card" as const,
    data: card.root(card.col([
      card.row([card.icon("clock", { tone: "accent" }), card.text("Focus", { bold: true }), card.spacer(),
        card.pill(running ? "running" : "paused", { tone: running ? "ok" : "warn" })]),
      card.number("25:00", { size: "xl" }),
      card.progress(running ? 0.4 : 0, { tone: "ok" }),
      card.button(running ? "Pause" : "Start", "toggle", { args: { to: running ? "pause" : "run" }, active: running }),
    ], { gap: 2, align: "between", grow: true })),
  });
  ctx.widgets.provide("timer", view, { every: 60 });
  ctx.actions.handle("toggle", (settings) => {
    running = settings.to === "run";
    ctx.widgets.push("timer", view());
  });
}
```

The builders are `card.root`, `row`, `col`, `text`, `number`, `pill`, `progress`, `ring(value, options?)`, `month(month, options?)`, `week(start, events, options?)`, `ticker(symbol, price, options?)`, `sparkline`, `icon`, `image`, `button(label, action, options?)` and `spacer`. `row` and `col` skip `false`, `null` and `undefined` children, so `cond && card.text("...")` works. `sparkline` keeps the last 60 points. The types are `CardNode` and `CardData`.

A widget with an `http` or `command` source can use `card` too, if its mapped data is a `{ root }`.

## Tile size

A code plugin's provider is called once for each tile of the widget, with the tile's size in grid cells as its second argument, so two tiles of one widget can show different cards:

```ts
ctx.widgets.provide("timer", (settings, tile) => ({
  render: "card",
  data: tile.w >= 4 ? wideCard() : tile.h >= 2 ? squareCard() : smallCard(),
}));

// a push can do the same: the function is called once for each tile of the widget
ctx.widgets.push("timer", (tile) => ({ render: "card", data: tile.w >= 4 ? wideCard() : smallCard() }));
```

From Nookdeck 0.7 the function given to `push` also gets the tile's settings as its second argument, the same `settings` its provider gets, so tiles of one widget with different settings (one scene each, say) can each show their own state: `ctx.widgets.push("scene", (tile, settings) => sceneCard(settings.scene))`.

`tile` is `{ w, h }` (type `TileSize`): the cells the tile takes in the layout, not pixels, and the same however the phone is turned. The function given to `push` may be `async`; if it throws for one tile, that tile keeps what it shows and the plugin log says why. Pushes of a widget arrive in the order you made them. While a function push is still under way, only the newest later push waits for it; the ones in between are dropped. The function has 20 seconds for each tile: after that the tile is skipped for this push, the plugin log says so, and a result that comes later is ignored. A plain update given to `push` goes to every tile, as before, and a provider that takes only `settings` works unchanged. `http` and `command` widgets are not told the size. Needs Nookdeck 0.5.1: before it, `tile` is `undefined` and `push` takes only an update, so set `"nookdeck": ">=0.5.1"`.

## Show a tile on a web page

The demo build (`nookdeck-demo.tgz` on each release, from Nookdeck 0.5.2) has `tile.html`: one plugin tile, drawn by the real deck, so a website can show your widget without drawing it again. Serve the files of the archive from one folder, put `tile.html` in an iframe, and give the iframe the tile's pixel size. The tile fills it, and the page around the tile is transparent.

1. Wait for the frame to post `{ type: "nookdeck-tile-ready" }` (check that `event.source` is your iframe).
2. Post the tile to the frame. Send again whenever something changes; the last message wins.

```js
frame.contentWindow.postMessage({
  type: "nookdeck-tile",
  render: "card",            // card, stat, gauge, text, list, chart, image or status
  data: { root: { t: "ring", value: 0.4, text: "24:00" } },
  w: 2, h: 2,                // the tile's size in grid cells, whole numbers from 1 to 24
  // all optional:
  style: "big",              // a display style of the renderer
  theme: "dev.nookdeck.nookdeck", // a built-in theme pack's id, or a theme object (as in a layout)
  mode: "light",             // "light" or "dark"
  lang: "vi",                // "en" (default), "vi" or "zh"
}, "*");
```

- **Size.** You choose the pixels; a cell on a phone is about 90 to 120 px, with a 10 px gap, so a `w` x `h` tile with a 100 px cell is `100 * w + 10 * (w - 1)` px wide. The frame never asks to be resized.
- **Theme.** A pack id (`dev.nookdeck.nookdeck` or `dev.nookdeck.nookdeck-classic`) gives that pack's look for `mode` (dark without one). For any other look send the theme object itself. An unknown id gives the default look. Background images and theme package fonts and CSS are not loaded.
- **Checks.** A message with a missing, wrong or extra field is ignored. `data` goes through the same checks as on your computer, and data that fails them shows the tile's error.
- **Nothing runs.** Card buttons do nothing, and the page makes no network requests, so an `image` widget needs a `data:image` URL here (an `https` one shows an error).
- If you sandbox the iframe, give it `allow-scripts allow-same-origin`.

## Settings

Each widget and action can declare settings. The manage page shows them as a form.

| `type` | Field |
|---|---|
| `string` | Text |
| `number` | Number |
| `boolean` | Switch |
| `select` | Choice (add `options`, or `optionsFrom` for a list from your code, see [Choices from your code](#choices-from-your-code)) |
| `secret` | Password. Stored on the computer, never sent to phones, and never shown again after saving. |
| `entity` | A Home Assistant entity id |

A plugin can also list plugin-wide fields under `settings`, and the Plugins tab shows them under **Settings**.

## Actions

An action is a button behaviour: a `macro` (the same steps as the Automation tab) or an `http` request. In a layout, a button uses `{ "type": "plugin", "plugin": "<id>", "action": "<id>", "settings": { } }`.

## Using a plugin in a layout

```json
{ "kind": "widget", "widget": "plugin", "plugin": { "id": "dev.alice.crypto", "widget": "price", "settings": { "coin": "ethereum" } } }
```

If the plugin is off or removed, its tiles show a neutral placeholder. Nothing else changes.

## Themes and layout packs

Looks of their own are **theme packs**, not plugins: see [Writing Nookdeck themes](themes.md). A plugin can still ship small `themes` and `layouts`. Each shows an **Apply** or **Add screens** button on its card in the Plugins tab. They change your draft, and you press **Save** to keep them.

## Plugins with code

Use code when a widget needs logic a `source` cannot express: several requests, parsing, state, or reacting to a button press. A code plugin sets `"main"` in `nookdeck.json` to its entry file and exports `activate(ctx)`.

```ts
import { definePlugin } from "@nookdeck/plugin";

export default definePlugin({
  activate(ctx) {
    ctx.widgets.provide("stars", async (settings) => {
      const res = await ctx.net.fetch(`https://api.github.com/repos/${settings.repo}`);
      const repo = await res.json();
      return { render: "stat", data: { value: repo.stargazers_count, label: String(settings.repo) } };
    }, { every: 300 });
    ctx.actions.handle("open", async () => { /* ... */ });
  },
});
```

### How it runs

Each code plugin runs in its own process, started by the agent, so a crash or a slow plugin cannot stop Nookdeck. The agent talks to it over JSON-RPC and draws its data with the same built-in renderers as no-code plugins: no plugin code runs on the phone. In the manage page, open the plugin's page to see whether it is running, stopped or crashed, read its last 50 log lines, and restart or stop it.

### The context (`ctx`)

| Member | Needs | What it does |
|---|---|---|
| `ctx.id` | | The plugin id |
| `ctx.log(...)` | | Writes to the plugin's log (shown in manage) |
| `ctx.settings.get()` | | The plugin-wide settings: what the user saved, and the manifest `default` of every field they left empty (Nookdeck 0.7.4). `ctx.settings.onChange(fn)` runs after they change |
| `ctx.storage.get/set` | `storage` | The plugin's own saved data |
| `ctx.net.fetch(url, init?)` | `network` hosts | `fetch`, limited to the hosts you list |
| `ctx.net.websocket(url, { protocols? })` | `network` ws origins | A WebSocket to an origin you list. See [WebSockets](#websockets) |
| `ctx.settings.options(id, fn)` | | Supplies the choices of a `select` with `optionsFrom: id` |
| `ctx.notify?.(title, { body?, level?, sound? })` | `notify` | Shows a notification on every phone. See [Notifications](#notifications) |
| `ctx.onair?.set(kind, on, since?)` | `onair` | Tells On Air you are live (`"stream"`) or recording (`"record"`). Present only when granted |
| `ctx.shell?.run(cmd)` | `shell` | Run a command, get `{ code, stdout }`. Present only when granted |
| `ctx.keys?.hotkey / type` | `keyboard` | Press keys and type text. Present only when granted |
| `ctx.widgets.provide(id, fn, { every })` | | Supply a widget's data now and every `every` seconds |
| `ctx.widgets.push(id, update)` | | Push new data when something changes |
| `ctx.actions.handle(id, fn)` | | Handle a button press |

`ctx.shell`, `ctx.keys`, `ctx.onair` and `ctx.notify` exist only when the user granted that permission. A call that is not allowed (a host you did not list, storage without `storage`) rejects with a `PluginPermissionError`. A widget provider or an action handler receives the plugin-wide settings overlaid with the tile's own settings. The exact types are in `src/plugins/api.ts`, re-exported by `@nookdeck/plugin` (`PluginContext`, `PluginModule`, `WidgetUpdate`).

### No dependencies

A plugin is one self-contained package. It has no `node_modules` and the agent never installs packages for it. It may import only `@nookdeck/plugin` (the agent's own copy, so it always matches), Node built-ins and its own files. If you use a library, bundle it into one file and point `main` at that file:

```bash
bun build src/index.ts --outfile index.js --target bun --external @nookdeck/plugin
```

An import of any other package stops the plugin with a message that says so. Theme packs follow the same rule: no code and no remote files, only what is in the folder.

### Limits

| What | Limit |
|---|---|
| `net.fetch` | 5 MB response, 15 s, 5 redirects, only your listed hosts (checked on every redirect) |
| `net.websocket` | 4 open sockets, 1 MB per message either way, text frames only, 10 s to connect, only your listed origins, no redirects |
| Choices (`optionsFrom`) | 200 per list, 200 characters each |
| `notify` | 6 a minute; title up to 120 characters, body up to 500 |
| `shell.run` | 30 s |
| `storage` | 1 MB in total |
| Widget refresh | `every` defaults to 60 s, minimum 5 s |
| After a crash | restarts after 0.5, 2, 10, then 60 s; marked failed after 8 crashes in a row |
| Idle | a plugin with no calls for 5 minutes is stopped and starts again on the next call, unless it has a WebSocket open or the `onair` or `notify` permission (those start with the agent and keep running) |

### WebSockets

For a program that speaks WebSocket (OBS Studio, a home server, a chat bridge), list its origin in `permissions.network` with the scheme, host and port, then open it from your code:

```json
"permissions": { "network": ["ws://127.0.0.1:4455", "ws://localhost:4455"] }
```

```ts
const ws = await ctx.net.websocket("ws://127.0.0.1:4455", { protocols: ["obswebsocket.json"] });
ws.onMessage((text) => { /* one text frame */ });
ws.onClose((code, reason) => { /* reconnect later */ });
ws.send(JSON.stringify({ op: 1, d: {} }));
ws.close();
```

- Scheme, host and port must match an entry exactly. There are no wildcards, `127.0.0.1` and `localhost` are different entries, and a host name entry (for `net.fetch`) does not allow a WebSocket.
- The connection runs in the agent, which checks the address. A redirect answer is not followed.
- Frames the server sends before you call `onMessage` are kept for you.
- A message over 1 MB or a binary frame closes the socket, and `onClose` gets 1009 or 1003.
- When the plugin stops, is turned off or is removed, its sockets are closed. When it starts again, open them again in `activate`.
- A plugin with an open socket is not stopped for being idle, so it can keep a connection and push tile updates with `ctx.widgets.push`.

The install screen shows each origin as "Connect to 127.0.0.1:4455".

### Choices from your code

A `select` whose choices are only known at run time (OBS scenes, a list from an API) takes `optionsFrom` instead of `options`:

```json
{ "key": "scene", "type": "select", "label": "Scene", "optionsFrom": "scenes" }
```

```ts
ctx.settings.options("scenes", async (settings) => (await listScenes()).map((s) => s.name));
```

The manage page calls the provider when the form opens, with the values the form has so far over the saved plugin settings. Secrets come from the saved settings only. The list may hold up to 200 strings: other values, empty strings and duplicates are dropped. If the provider throws (the program is not running, for example), the field becomes a text box with the saved value and your error message, so the owner can still type a name. A saved value that is not in the list stays selectable.

### On Air

A plugin with `"onair": true` in its permissions gets `ctx.onair`:

```ts
ctx.onair.set("stream", true, startedAtMs); // live
ctx.onair.set("record", false);             // recording stopped
```

These feed On Air's OBS sources (live and recording). The owner can turn that source off in the On Air settings. When the plugin stops, is turned off or loses the permission, its On Air state is cleared. A plugin with `onair` starts when the agent starts, not only when a phone shows one of its tiles, so On Air works with no phone open. The install screen says "Turn On Air on".

### Notifications

A plugin with `"notify": true` in its permissions gets `ctx.notify`. The notification shows as a toast on every phone and in the notification list, like one from the notify webhook:

```ts
await ctx.notify?.("Time for a glass of water", { body: "3 of 8 today", sound: "chime" });
```

- `level` is `info` (default), `warn` or `alert`, and colours the toast.
- `sound` is `chime`, `soft` or `birds`. The phone plays it once with the toast. A browser plays sound only after the page has been tapped once, so a phone that was never touched since it loaded shows the toast without sound.
- More than 6 notifications in a minute are refused (the call rejects). Keep reminders rare.
- A plugin with `notify` starts with the agent and is never stopped as idle, so a reminder or a timer's end comes on time while the phones sleep. Phones that were asleep find it in their notification list.
- Needs Nookdeck 0.7.

### Permissions and trust

Plugins that ask for `shell` or `keyboard` run code that can control the computer, so the manage page marks them **Runs trusted code** and the install dialog says so. Ask for the least you need, and list each host exactly. Secrets go in settings of type `secret`, which stay on the computer.

### Dev loop

1. `nookdeck plugin new my-plugin` creates a folder from the template.
2. `nookdeck plugin dev my-plugin` links the folder and reloads on every save.
3. Read the log lines in the plugin's page in manage.
4. `nookdeck plugin pack` makes a zip and its sha256 for release.

### Publishing

Put the plugin in a GitHub repo and tell people the address; it installs directly. To be listed in the Store, open a PR to [howznguyen/nookdeck-plugins](https://github.com/howznguyen/nookdeck-plugins) (see below). The three tiers (Community, Verified, Core) are described in [CONTRIBUTING.md](../CONTRIBUTING.md#plugins).

### Samples

- [`github-stars`](https://github.com/howznguyen/nookdeck-plugins/tree/main/plugins/github-stars): code, `net.fetch` to api.github.com, a stat and a chart.
- [`uptime-ping`](https://github.com/howznguyen/nookdeck-plugins/tree/main/plugins/uptime-ping): code, checks a URL, `status` renderer.
- [`clipboard-snippets`](https://github.com/howznguyen/nookdeck-plugins/tree/main/plugins/clipboard-snippets): no code, actions with the `shell` permission.

## Share it

Put the folder in a GitHub repo. Others install it from the link. Say what it needs access to in the README, since that is the first thing people ask.

To be listed in the Store, open a PR to [howznguyen/nookdeck-plugins](https://github.com/howznguyen/nookdeck-plugins) that adds your entry to `plugins.json`. The registry comes with the Store; until then, sharing your GitHub URL is enough, because it installs directly.
