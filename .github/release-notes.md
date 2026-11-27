## Nookdeck 0.7.3

Upgrading: use **Install and restart** in the app, run the install command below again, or `nookdeck update`.

### New

- **Report a problem shows the network.** The report now says where Nookdeck listens, the computer's networks, and every address that reached it since Nookdeck started: opened the page, wrong PINs, paired, connected as which phone. "Nobody" means the phone never reached the computer (another network, a router that keeps Wi-Fi devices apart, the firewall); "another network" means two routers. Addresses stay masked; each one says which network of the computer it shares. Windows is named by its real version (Windows 11, build 26100).
- **No QR scanner on the phone?** The Devices tab shows the address to type in the phone's browser, in large print, under the QR code.
- **Android: the screen turns off.** Browsers on Android cannot keep the screen on for a page on the local network, so the phone now says once how to make it stay on in its own settings.

### Fixed

- OpenCode 2.4: the usage limits of a Go plan and the recent sessions show again (thanks to @ngannguyen-nvn, #16).
- Windows: an older Nookdeck (0.6.0 to 0.7.1) can still show "Unknown constant userprofile" when you uninstall it. Install this version over it first, then uninstall.

## Nookdeck 0.7.2

Upgrading: use **Install and restart** in the app, run the install command below again, or `nookdeck update`.

### Fixed

- **Windows: phones that could not connect while the check said the firewall was fine.** The firewall check looked at Private networks only, and any rule for Nookdeck counted. It now checks the network your PC is really on: a rule made by Windows' own popup for Private networks only, a BLOCK rule, and "Block all incoming connections" on Public networks are all reported, with the fix. Tailscale and other VPNs no longer hide a Public Wi-Fi, and a Public network whose firewall lets phones in is no longer flagged.
- **Windows: "Allow phones to connect…" in the tray menu** appears while the firewall keeps phones out. It replaces Nookdeck's rule with one for every network type (one administrator prompt), or opens the firewall settings when "Block all incoming connections" is on.
- Windows: uninstalling stopped with "Unknown constant userprofile".
- macOS: the Now Playing helper could keep running after Nookdeck was stopped abruptly. It now always stops with Nookdeck.

## Nookdeck 0.7.1

Upgrading: use **Install and restart** in the app, run the install command below again, or `nookdeck update`. If Nookdeck on Windows is stuck stopped after 0.7.0, the tray cannot check for updates: download and run `Nookdeck-Setup.exe` from [nookdeck.app/download](https://nookdeck.app/download) once.

### Fixed

- **Windows: Nookdeck stayed stopped after 0.7.0** when the Windows user name has a space (for example `C:\Users\Tuan Long`), and Start in the tray did nothing. The 0.7.0 launcher ran the agent through a hidden console host that lost the quotes around such paths, so the agent never started. The launcher now starts it on every user folder, still with no console window, and an existing launcher is fixed when the update restarts the agent.

## Nookdeck 0.7.0: On Air, OBS and five languages

Upgrading: use **Install and restart** in the app, run the install command below again, or `nookdeck update`.

### New

- **On Air.** A tile that turns red while you are live, recording or in a call, with what turned it on and for how long. It lights up from:
  - the microphone or the camera being used by any app (Zoom, Meet, Teams, Discord...);
  - an On Air button on the phone;
  - `POST /api/onair` with your webhook key and an optional label and timeout, for Streamlabs, vMix, scripts or Home Assistant;
  - OBS streaming or recording, through the OBS plugin.

  Any spare phone can also become a full-screen **ON AIR** sign by the door (Screen & alarms).
- **Mic and Camera buttons.** Mic mutes the computer's microphone for every app and shows when it is muted. Camera turns the camera off and on in Zoom, Google Meet or Teams with the app's own shortcut, bringing the meeting window forward first.
- **OBS Studio plugin** in the Store: scenes, record, stream, mute, sources, virtual camera and replay buffer, each showing OBS's live state, and usable in macros ("Go live": scene, wait, stream, unmute). It connects to OBS's own WebSocket server (Tools > WebSocket Server Settings).
- **More Store plugins:** a water reminder (glasses, a daily goal, reminders on the phone) and stocks (your own free Twelve Data key). Pomodoro can play a sound and notify you when a phase ends.
- **Screenshot button that works everywhere.** It opens the system screenshot tool, or your own app: Snapzy, CleanShot X or Shottr on the Mac, ShareX or Greenshot on Windows, or any shortcut or command. Installed apps are picked automatically.
- **French and Brazilian Portuguese** for the app, the phone, the menu bar and tray apps, `nookdeck doctor` and nookdeck.app.
- **Updates show what's new.** The update window lists the changes since your version, then shows the download, the check and the restart.
- **Several Claude accounts and Codex profiles** in the AI quota; each tile picks one. A signed-out account says "Sign in again" instead of showing old numbers.
- Swipe around from the last screen back to the first, hide the page dots, put the phone to sleep when a button locks the computer, and long song titles shrink to fit.
- The weather has a default city on the Weather page, and the phone preview on the manage page matches the size of your connected phone.
- **For plugin authors:** WebSockets to the hosts a plugin declares, settings whose choices come from the plugin, notifications to the phone, and On Air. See [docs/plugins.md](https://github.com/howznguyen/nookdeck/blob/main/docs/plugins.md).

### Fixed

- Windows and Linux: **Lock computer** sent the macOS shortcut (on Windows it opened Quick Assist). It now locks the computer.
- The Screenshot button did nothing on Windows and on Macs where another app owns the screenshot shortcuts.
- Windows: the agent could run in an empty console window (when Windows Terminal is the default terminal), and closing it stopped Nookdeck. It now starts with no window at all.
- Windows: an update no longer opens a second setup window; the update window shows every step and installs silently.
- Each GitHub release now shows only its own notes.

## Nookdeck 0.6.1

Upgrading: run the install command below again, or `nookdeck update`, or use **Install and restart** in the app.

### Fixed

- **Windows: high CPU from PowerShell** ([#15](https://github.com/howznguyen/nookdeck/issues/15)). The tray app asked for the permission checks every 5 seconds, each check started four PowerShell processes, and the ones it gave up on kept running, so they piled up. Now the agent runs one check at a time and reuses its answer for 30 seconds, and the tray app asks once a minute. On a test PC this went from about 42 PowerShell processes a minute to 7.

### New

- **Theme previews before you install.** Opening a theme in the store draws your own screen in that theme, and switching variants updates it live. The theme is downloaded to a cache and checked like an install; Install then reuses it.

## Nookdeck 0.6.0: Linux, and updates in one click

Upgrading: run the install command below again, or `nookdeck update`, or use **Check for updates** in the app. On a Mac, this is the last time you install the app by hand: from 0.6.0 on, the app updates itself.

### New

- **Linux (experimental).** Ubuntu 22.04 and 24.04, Debian 12 and 13, on x86_64 or ARM64:
  - Install the `.deb` (`sudo apt install ./nookdeck_*_amd64.deb`) and open **Nookdeck** from the app menu. A tray app sets everything up and lets you pair a phone, open the manage page, restart and update.
  - The install command works too, with no `sudo`. `.rpm` and a tarball are also there.
  - Keys and typing use `xdotool` on X11, and `ydotool` or `wtype` on Wayland. `nookdeck doctor` tells you what is missing and how to fix it.
  - Debian with GNOME needs the AppIndicator extension to show tray icons. Everything else also works from the manage page.
- **The app tells you when an update is out**, and offers **Install and restart**, **Later** or **Skip this version**:
  - **Mac:** the app downloads the new version, checks that it is the real one (same signature as the app you have), replaces itself and opens again. Your phones reconnect on their own, and the Accessibility permission stays.
  - **Windows:** the same choice, then the installer runs quietly and the app starts again.
  - **Linux:** the same choice for the `.deb` and `.rpm` installs.

### Fixed

- Windows: opening Nookdeck from the Start menu or the desktop shortcut while it already runs did nothing. It now opens the manage page.

## Nookdeck 0.5.3

Upgrading: run the install command below again, or `nookdeck update`, or use **Check for updates** in the app.

- Fixed: an iPhone on iOS 15 or 16 could stay on **Disconnected / Waiting for layout** when the deck has many app icons or uploaded images. Big icon sets now reach the phone in parts.
- **Report a problem** (manage page > About) builds one report for a GitHub issue: version, system, permission checks, phones, connection drops and the end of the error log. Personal details (home folder, computer name, IP addresses, PIN, tokens) are masked, and you see the report before anything is sent.
- **`nookdeck phone-check`** opens a test page for a phone that cannot connect and tells why (message size, compression, close code). The output is saved to `~/.nookdeck/logs/phone-check.log`.
- When the phone loses the connection, the deck now shows the reason code next to "disconnected".

## Nookdeck 0.5.2

Upgrading: run the install command below again, or `nookdeck update`, or use **Check for updates** in the app.

- **Plugin tiles on web pages.** `nookdeck-demo.tgz` now has a `tile.html` page that draws one plugin tile with the real deck renderer from a `postMessage`, so the website can show live previews of every plugin. Guide: [docs/plugins.md](https://github.com/howznguyen/nookdeck/blob/main/docs/plugins.md).
- Fixed: plugin tiles that show an image could draw blank.

## Nookdeck 0.5.1: rings, calendars and better-looking plugins

Upgrading: run the install command below again, or `nookdeck update`, or use **Check for updates** in the app.

### New

- **More card parts for plugins:** ring charts (a full circle or a gauge), a month calendar, a week calendar with an hour grid, and large tile buttons with the icon above the label. Rows can stack on square tiles and sit side by side on wide ones. Guide: [docs/plugins.md](https://github.com/howznguyen/nookdeck/blob/main/docs/plugins.md#cards).
- **Plugins know their tile size**, so one plugin can look right on a small tile and on a big one.
- **The Store plugins got a redesign:**
  - **Batteries:** rings like the iOS Batteries widget, for the Mac, AirPods, Magic devices and other Bluetooth headphones that report a level (for example Sony WH-1000XM4).
  - **Mac controls** and **Apple Shortcuts:** big tile buttons that fill the card; each shortcut gets an icon that matches its name.
  - **Pomodoro:** a ring timer with a large Start/Pause button.
  - **Calendar:** a month beside your agenda on 4x3 and 4x4 tiles, and a week view on wide tiles.

### Fixed

- macOS: the background service now names itself when macOS asks for Bluetooth or Automation access for a plugin. The first time a plugin needs it, allow it in the prompt (or later in **System Settings > Privacy & Security**).
- A plugin card that names an icon the phone does not have is reported by `nookdeck plugin dev` and in the plugin log.

## Nookdeck 0.5.0: plugin cards, Mac plugins and screen care

Upgrading: run the install command below again, or `nookdeck update`, or use **Check for updates** in the app.

### New

- **Plugin cards.** A plugin tile can now be a small card made of built-in parts: text, numbers, pills, progress bars, sparklines, icons, images and buttons. The phone draws it with your theme. No plugin code, HTML or CSS ever runs on the phone, and card buttons can only run the plugin's own declared actions. Guide: [docs/plugins.md](https://github.com/howznguyen/nookdeck/blob/main/docs/plugins.md#cards).
- **New plugins in the Store**, built on cards:
  - **Apple Shortcuts** (macOS): run your shortcuts from the phone. The README has recipes for turning a Focus on or off and setting the display brightness.
  - **Mac controls** (macOS): dark mode, keep awake, display off and lock.
  - **Batteries** (macOS): the Mac's battery, Magic Keyboard, Mouse and Trackpad, and AirPods.
  - **Pomodoro**: a focus timer that keeps time on the computer, so it carries on while the phone sleeps.
  - **Calendar**: upcoming events from Google, iCloud or Outlook calendar links. The links stay on the computer.
- **Plugins for one system.** A plugin can say it works on macOS only (or Windows, or Linux). It is refused with a clear message elsewhere, and the Store shows a badge.
- **Home Assistant cameras.** Put a `camera.*` entity on a screen to see a still picture that refreshes while it is shown; tap it for a larger view. The Home Assistant token stays on the computer.
- **Screen care**, for a phone that stays on all day (**Screen** in the management page): **Burn-in shift** moves the panel by a couple of pixels now and then, and **Night dim** dims it during the hours you choose. While dimmed, the first tap only wakes the panel and never presses a tile.
- **Star and support.** Star on GitHub and Support on Ko-fi in the menu bar and tray apps and on the About page. A one-time reminder shows after a few days of use, and can be turned off.

### Fixed

- The panel's screen timer no longer runs while the page is hidden.

## Nookdeck 0.4.0: desktop apps and themes

Upgrading: run the install command below again, or `nookdeck update`. Or install the new app (below).

### New

- **Desktop apps.** A menu bar app for macOS (`Nookdeck.dmg`) and a tray app for Windows (`Nookdeck-Setup.exe`). They start and stop Nookdeck, show its state, open the management page and the pairing QR, and adopt an agent that is already installed, so your layout, phones and permissions stay as they are. The command-line install keeps working.
- **Themes.** A theme is a pack of looks: pick one under **Theme**, and it is saved at once (with Undo). Each pack can have light and dark variants, an **Auto** mode that follows the phone, and options such as Catppuccin's accent colour. In the box: Nookdeck, Nookdeck Classic (the old presets) and, from the Store, Catppuccin, Tokyo Night, Night Owl, One Dark Pro, JellyFish, SynthWave '84, Cyberpunk, Terminal, Brutalist, Blueprint, Sketchbook, Pixel and Aurora. Browse them with live previews at [nookdeck.app/themes](https://nookdeck.app/themes).
- **More to customize.** Fonts, background gradients and images, frosted tiles, borders, shadows, state and chart colours, icon style, and a look for one screen only.
- **Make your own theme.** **Export this look** turns your settings into a theme pack. Packs can bring fonts, icons and their own CSS (checked on install, with no network access and no code). Guide: [docs/themes.md](https://github.com/howznguyen/nookdeck/blob/main/docs/themes.md). If a theme ever makes the phone unreadable, open `/?theme=off` on the phone or run `nookdeck theme reset`.
- **Plugin tile styles.** Every plugin tile has a **Style** picker (for example line, area, bars or dots for a chart), and tiles look right at every size. A richer status card shows a title, a big value, a detail line and a sparkline: see Uptime ping 1.1.0.
- **Plugins page.** Discover shows cover cards with each plugin's live tile, and filters by what a plugin may do.

### Fixed

- Text always fits its tile, whatever the theme's font: clocks, numbers, ring charts and button labels.
- The page dots at the bottom of the phone screen could not be tapped.
- The robot vacuum's Start, Pause and Dock buttons were stacked and cut off.
- Now Playing lost its volume control on some tile sizes.
- `nookdeck install` (Homebrew) could leave the background service stopped when it ran while Nookdeck was running.
- Permissions page: **Open Settings** answered "not found"; a Claude rate limit was shown as a blocked Keychain; the firewall row was named "Windows Firewall" on a Mac.
- The menu bar icon was drawn as a dot.

## Nookdeck 0.3.1

Upgrading: run the install command below again, or `nookdeck update`.

- **Plugins with code install from GitHub**, from the Store or a repository link. The whole plugin folder is downloaded and checked (size limits, no links or paths outside the folder), and Store installs stay pinned to the reviewed files. GitHub stars and Uptime ping are now in the Store.
- **Wi-Fi first when pairing:** the pairing window and the installer QR use this computer's Wi-Fi or Ethernet address by default; the `.local` name and Tailscale are one pick away.
- **Install links:** `http://localhost:7420/manage#plugins?add=<plugin id>` opens a Store plugin's Add dialog (nookdeck.app/plugins uses it). Nothing installs without your OK.
- **`nookdeck install`:** puts the program in its stable place and sets up the login service, for Homebrew and other package managers.
- Fixed: `nookdeck plugin dev <folder>` and `plugin pack <folder>` used the current folder when no flag was given; the doctor no longer crashes when the home folder cannot be found.

## Nookdeck 0.3.0: plugins with code, and a plugin Store

Coming from PhoneDesk? The install command moves everything over (see the 0.2.0 notes).

### New

- **Plugin Store:** Plugins now has Discover, Installed and Updates tabs. Browse the community registry ([nookdeck-plugins](https://github.com/howznguyen/nookdeck-plugins)), see a live preview of each tile, read what a plugin may do, and press **Add**. Store installs are pinned to the reviewed version: if the files differ, nothing is installed. Grid and list views, search, and "Add tile to a screen" in one click.
- **Plugins with code:** a plugin can ship a small TypeScript or JavaScript file. It runs in its own process, so a crash or a hang never takes Nookdeck down, and it restarts with back-off. Everything it does outside (network, shell, keys, storage) goes through Nookdeck and is limited to what you approved. Build one with the `@nookdeck/plugin` types and `nookdeck plugin new`, `nookdeck plugin dev` and `nookdeck plugin pack`: see the [plugin guide](https://github.com/howznguyen/nookdeck/blob/main/docs/plugins.md).
- **Built-in plugins:** Weather and AI usage now run on the same plugin system. Your layouts keep working unchanged.
- **Safer removal:** removing a plugin lists where it is used, can take its tiles off your screens, and can be undone.
- **Sidebar:** Built-in and Community plugins fold into short groups.

### Fixed

- Shell steps in plugins receive settings as environment variables, never pasted into the command.
- Plugins can only import `@nookdeck/plugin`, built-ins and their own files; nothing is fetched from npm at run time.
- The Screens preview shows each plugin's own sample data instead of invented numbers.
- Built-in AI usage and Weather tiles placed as plugin tiles draw correctly on the phone.

### Install statistics

The app itself sends nothing. The website and the installer keep anonymous install counts (OS, version, country); opt out with `NOOKDECK_NO_ANALYTICS=1`. Details in [PRIVACY.md](https://github.com/howznguyen/nookdeck/blob/main/PRIVACY.md#install-statistics-website-and-installer).

## Install

**macOS** (Apple silicon or Intel), in Terminal, no `sudo`:

```sh
curl -fsSL https://nookdeck.app/scripts/install | bash
```

**Windows 10/11** (x64, experimental), in PowerShell:

```powershell
irm https://nookdeck.app/scripts/install.ps1 | iex
```

The installer downloads the right file below, checks it against `SHA256SUMS`, installs it for your user, starts
Nookdeck and prints the phone URL, a pairing PIN and a QR code. Open the URL on a phone on the same Wi-Fi (or scan
the QR with the Camera app), and add the page to the home screen.

- **Update:** run the same command again. Your layout, paired phones and settings are kept.
- **Uninstall:** `curl -fsSL https://nookdeck.app/scripts/uninstall | bash`
  (Windows: `irm https://nookdeck.app/scripts/uninstall.ps1 | iex`). Your data is kept;
  on macOS add `-s -- --purge` after `bash` to delete it too.
- **Manage your panel:** `http://localhost:7420/manage/` on the computer.

## Files

| File | For |
|---|---|
| `nookdeck-darwin-arm64.gz` / `nookdeck-darwin-arm64` | macOS on Apple silicon (M1 and later) |
| `nookdeck-darwin-x64.gz` / `nookdeck-darwin-x64` | macOS on Intel |
| `nookdeck-windows-x64.exe.gz` / `nookdeck-windows-x64.exe` | Windows 10/11 x64 |
| `Nookdeck.dmg` | The macOS menu bar app (Apple silicon and Intel): open it and drag Nookdeck to Applications |
| `Nookdeck-Setup.exe` | The Windows tray app and installer. Not code-signed yet: SmartScreen may ask, choose **More info**, then **Run anyway** |
| `nookdeck-demo.tgz` | The phone screen as static files, for previewing themes without Nookdeck (used by nookdeck.app) |
| `SHA256SUMS` | Checksums of every file |

The `.gz` files are the same programs compressed (about a third of the size); the installers use them. To install by
hand: download the file for your machine, check it with `shasum -a 256 -c SHA256SUMS --ignore-missing`, unpack it with
`gunzip`, make it executable (`chmod +x`) and run it. The macOS binaries are signed with the Nookdeck release identity (self-signed, not notarized): a file downloaded in a
browser needs `xattr -d com.apple.quarantine <file>` first.

Full guide: [README](https://github.com/howznguyen/nookdeck#readme) · Tiếng Việt: [README.vi](https://github.com/howznguyen/nookdeck/blob/main/README.vi.md) · 中文: [README.zh](https://github.com/howznguyen/nookdeck/blob/main/README.zh.md)
