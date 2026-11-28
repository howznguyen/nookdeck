//go:build windows || linux

// Nookdeck in the tray, for Windows and Linux: an app that controls the Nookdeck agent (specs desktop-apps A1-A7, linux-support
// L6-L9). The agent keeps running as its per-user service (a scheduled task, a systemd user unit or an autostart entry), so quitting
// this app never stops the phone panel. This file is the part both systems share; main_<os>.go and sys_<os>.go are the rest.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"fyne.io/systray"
	"github.com/howznguyen/nookdeck/apps/desktop/internal/core"
)

var version = "dev"

var (
	lang   string
	logMu  sync.Mutex
	logOut *os.File
)

func logf(format string, args ...any) {
	logMu.Lock()
	defer logMu.Unlock()
	if logOut != nil {
		fmt.Fprintf(logOut, time.Now().Format("2006-01-02 15:04:05 ")+format+"\n", args...)
	}
}

func openLog() {
	p := filepath.Join(paths().SvcDir(), "tray.log")
	os.MkdirAll(filepath.Dir(p), 0o755)
	if st, err := os.Stat(p); err == nil && st.Size() > 256<<10 {
		os.Remove(p)
	}
	logOut, _ = os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
}

// setupOnce installs or adopts the agent (A2), then runs the system's own follow-up (Windows: the firewall rule). It returns the
// exit code for --setup.
// quietSetup: `--setup --quiet`, run by a silent install (the tray's own update): no message box at all, the log only.
// updatedRun: `--updated`, the tray started by that install: the firewall rule is not offered on this start (it was offered at the
// first install; pairing offers it again when it is still missing).
var quietSetup, updatedRun bool

func setupOnce(tray bool) int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	res := core.EnsureAgent(ctx, paths(), bundledAgent(), ops())
	logf("setup: %s exe=%s port=%d version=%q err=%v", res.Action, res.Exe, res.Port, strings.TrimSpace(res.Version), res.Err)
	if res.Err != nil {
		if !tray && !quietSetup {
			messageBox(core.T(lang, "app.name"), core.T(lang, "error.setupFailed", "error", res.Err.Error()), false)
		}
		return 1
	}
	// the firewall rule: on a first install, and on a normal tray start; never during or right after an update
	if !quietSetup && !updatedRun && (tray || res.Action == core.ActionInstalled) {
		afterSetup(ctx, res.Exe)
	}
	state.mu.Lock()
	state.exe, state.port = res.Exe, res.Port
	state.mu.Unlock()
	return 0
}

// ---------- state shared between the poller and the menu ----------

var state struct {
	mu       sync.Mutex
	exe      string
	port     int
	phones   int
	st       core.State
	busy     string // a status key while Start/Stop/Restart/setup run
	update   core.Update
	checking bool
	unreach  bool
	firewall bool // the doctor's Firewall item says phones cannot connect (Windows)
	android  *core.UsbPhone // an Android phone on the USB cable that waits for setup (nil: none)
	androidK string         // how: setup, update, allow
}

func client() *core.Client {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.port == 0 {
		state.port = 7420
	}
	return core.NewClient(state.port)
}

func agentExe() string {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.exe == "" {
		state.exe = paths().Exe()
	}
	return state.exe
}

func manageURL() string { return client().ManageURL() }

// ---------- the menu (A6) ----------

var (
	mStatus, mPhones, mPair, mManage, mFirewall, mAndroid, mToggle, mRestart, mUpdate, mUpdateNow, mLogin *systray.MenuItem
	mHelp, mDoctor, mLogs, mDocs, mSite, mVersion, mQuit                                        *systray.MenuItem
	mStar, mKofi                                                                                *systray.MenuItem
	pair                                                                                        *core.PairServer
)

func t(key string, vars ...string) string { return core.T(lang, key, vars...) }

func onReady() {
	state.st = core.StateStopped
	systray.SetIcon(icon(core.StateStopped))
	systray.SetTooltip(t("tray.tooltip.stopped"))
	mStatus = systray.AddMenuItem(t("status.settingUp"), "")
	mStatus.Disable()
	mPhones = systray.AddMenuItem(core.Phones(lang, 0), "")
	mPhones.Disable()
	systray.AddSeparator()
	mPair = systray.AddMenuItem(t("menu.pair"), "")
	mManage = systray.AddMenuItem(t("menu.openManage"), "")
	mFirewall = systray.AddMenuItem(t("menu.allowPhones"), "") // Windows: shown while the firewall keeps phones out
	mFirewall.Hide()
	mAndroid = systray.AddMenuItem(t("menu.androidSetup", "model", ""), "") // shown while an Android phone on the cable waits for setup
	mAndroid.Hide()
	systray.AddSeparator()
	mToggle = systray.AddMenuItem(t("menu.stop"), "")
	mRestart = systray.AddMenuItem(t("menu.restart"), "")
	systray.AddSeparator()
	mUpdate = systray.AddMenuItem(t("menu.checkUpdates"), "")
	mUpdateNow = systray.AddMenuItem(t("menu.updateNow"), "")
	mUpdateNow.Hide()
	mLogin = systray.AddMenuItemCheckbox(t("menu.openAtLogin"), "", loginItemEnabled())
	mHelp = systray.AddMenuItem(t("menu.help"), "")
	mDoctor = mHelp.AddSubMenuItem(t("menu.help.permissions"), "")
	mLogs = mHelp.AddSubMenuItem(t("menu.help.logs"), "")
	mDocs = mHelp.AddSubMenuItem(t("menu.help.docs"), "")
	mSite = mHelp.AddSubMenuItem(t("menu.help.website"), "")
	systray.AddSeparator()
	mStar = systray.AddMenuItem(t("menu.star"), "")
	mKofi = systray.AddMenuItem(t("menu.kofi"), "")
	systray.AddSeparator()
	mVersion = systray.AddMenuItem(t("menu.version", "version", version), "")
	mVersion.Disable()
	mQuit = systray.AddMenuItem(t("menu.quit"), t("menu.quit.hint"))

	go func() { // install or adopt first, then poll
		setBusy("status.settingUp")
		if setupOnce(true) != 0 {
			notice(t("error.setupFailed", "error", "see tray.log"))
		}
		setBusy("")
		close(agentReady)
		poll()
		tick := time.NewTicker(5 * time.Second)
		for range tick.C {
			poll()
		}
	}()
	go func() {
		for {
			select {
			case <-mPair.ClickedCh:
				go openPair()
			case <-mManage.ClickedCh:
				openURL(manageURL())
			case <-mFirewall.ClickedCh:
				go fixFirewall()
			case <-mAndroid.ClickedCh:
				go setupAndroid()
			case <-mToggle.ClickedCh:
				go toggle()
			case <-mRestart.ClickedCh:
				go control("restart", "status.restarting", "error.restartFailed")
			case <-mUpdate.ClickedCh:
				go checkUpdate(true)
			case <-mUpdateNow.ClickedCh:
				go updateFromMenu()
			case <-mLogin.ClickedCh:
				on := !mLogin.Checked()
				if err := setLoginItem(on); err != nil {
					notice(t("error.loginItemFailed", "error", err.Error()))
				} else if on {
					mLogin.Check()
				} else {
					mLogin.Uncheck()
				}
			case <-mDoctor.ClickedCh:
				openDoctor()
			case <-mLogs.ClickedCh:
				openFolder(paths().LogDir())
			case <-mDocs.ClickedCh:
				openURL("https://github.com/howznguyen/nookdeck#readme")
			case <-mSite.ClickedCh:
				openURL("https://nookdeck.app")
			case <-mStar.ClickedCh:
				openURL("https://github.com/howznguyen/nookdeck")
			case <-mKofi.ClickedCh:
				openURL("https://ko-fi.com/howznguyen")
			case <-mQuit.ClickedCh:
				if pair != nil {
					pair.Close()
				}
				systray.Quit()
				return
			}
		}
	}()
	go func() {
		time.Sleep(20 * time.Second)
		checkUpdate(false)
		for range time.Tick(6 * time.Hour) {
			checkUpdate(false)
		}
	}()
	platformReady()
}

func notice(text string) { logf("notice: %s", text); go messageBox(t("app.name"), text, false) }

func setBusy(key string) {
	state.mu.Lock()
	state.busy = key
	state.mu.Unlock()
	render()
}

// The permission checks start several OS probes on the agent (four PowerShell processes on Windows), so they are asked for at most
// once a minute and the last answer is kept in between; the status dot only uses them for "needs attention" (issue #15).
const doctorEvery = time.Minute

var (
	doctorMu     sync.Mutex // poll runs from the ticker and after an action
	lastDoctor   *core.Doctor
	lastDoctorAt time.Time
)

// currentDoctor is the last answer of the permission checks (nil before the first one).
func currentDoctor() *core.Doctor {
	doctorMu.Lock()
	defer doctorMu.Unlock()
	return lastDoctor
}

// refreshDoctor runs the checks again now (after the tray changed the firewall) and shows the result.
func refreshDoctor() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if d, err := client().DoctorFresh(ctx); err == nil {
		doctorMu.Lock()
		lastDoctor, lastDoctorAt = &d, time.Now()
		doctorMu.Unlock()
	}
	poll()
}

// poll asks the agent (cheap: the device list), the permission checks once a minute, and the Task Scheduler only when the agent does not answer.
func poll() {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	c := client()
	ds, err := c.Devices(ctx)
	reachable := err == nil
	var doc *core.Doctor
	if reachable {
		doctorMu.Lock()
		if time.Since(lastDoctorAt) >= doctorEvery {
			lastDoctorAt = time.Now()
			dctx, dcancel := context.WithTimeout(context.Background(), 20*time.Second)
			if d, err := c.Doctor(dctx); err == nil {
				lastDoctor = &d
			}
			dcancel()
		}
		doc = lastDoctor
		doctorMu.Unlock()
	}
	running := false
	if !reachable {
		running = serviceRunning(ctx)
	}
	state.mu.Lock()
	state.st = core.StateOf(reachable, running, doc)
	state.unreach = !reachable
	state.firewall = reachable && firewallFixable && core.FirewallProblem(doc) != nil
	state.phones = core.Online(ds)
	state.mu.Unlock()
	pollAndroid(reachable)
	render()
}

// pollAndroid asks the agent which Android phone on the cable waits for setup (what its USB watcher saw last: no adb runs here).
func pollAndroid(reachable bool) {
	var p *core.UsbPhone
	kind := ""
	if reachable {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		if s, err := client().AndroidPeek(ctx); err == nil && s.Adb != nil {
			p, kind = core.AndroidOffer(s)
		}
		cancel()
	}
	state.mu.Lock()
	state.android, state.androidK = p, kind
	state.mu.Unlock()
}

// setupAndroid installs the app on the phone, links it through the cable, pairs it and opens the deck, then says how it went.
func setupAndroid() {
	state.mu.Lock()
	p, kind := state.android, state.androidK
	state.mu.Unlock()
	if p == nil || kind == "allow" {
		return
	}
	setBusy("status.androidSetup")
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	model, err := client().AndroidSetup(ctx, p.Serial)
	cancel()
	setBusy("")
	name := core.PhoneName(lang, p)
	if err != nil {
		notice(t("android.failed", "model", name, "error", err.Error()))
	} else {
		if model == "" {
			model = name
		}
		notice(t("android.done", "model", model))
	}
	poll()
}

// render shows the state: tray icon and tooltip, the status line, the phone count and the labels of Start/Stop.
func render() {
	state.mu.Lock()
	st, phones, busy, up, unreach, fw := state.st, state.phones, state.busy, state.update, state.unreach, state.firewall
	state.mu.Unlock()
	if mStatus == nil {
		return
	}
	if fw {
		mFirewall.Show()
	} else {
		mFirewall.Hide()
	}
	state.mu.Lock()
	ap, ak := state.android, state.androidK
	state.mu.Unlock()
	if ap == nil {
		mAndroid.Hide()
	} else {
		mAndroid.SetTitle(t(map[string]string{"setup": "menu.androidSetup", "update": "menu.androidUpdate", "allow": "menu.androidAllow"}[ak], "model", core.PhoneName(lang, ap)))
		if ak == "allow" || busy != "" {
			mAndroid.Disable()
		} else {
			mAndroid.Enable()
		}
		mAndroid.Show()
	}
	line := map[core.State]string{core.StateRunning: "status.running", core.StateStopped: "status.stopped", core.StateAttention: "status.needsPermission"}[st]
	if st == core.StateAttention && unreach {
		line = "status.unreachable" // the task runs but nothing answers: starting up or crashed
	}
	if busy != "" {
		line = busy
	}
	mStatus.SetTitle("● " + t(line))
	systray.SetIcon(icon(st))
	systray.SetTooltip(t("tray.tooltip." + string(st)))
	mPhones.SetTitle(core.Phones(lang, phones))
	if st == core.StateStopped {
		mToggle.SetTitle(t("menu.start"))
		mRestart.Disable()
	} else {
		mToggle.SetTitle(t("menu.stop"))
		mRestart.Enable()
	}
	if busy != "" {
		mToggle.Disable()
		mRestart.Disable()
	} else {
		mToggle.Enable()
	}
	if up.Available && up.Latest != nil {
		mUpdate.SetTitle(t("menu.updateAvailable", "version", *up.Latest))
		mUpdateNow.SetTitle(t("menu.installUpdate", "version", *up.Latest))
		mUpdateNow.Show()
	}
}

func toggle() {
	state.mu.Lock()
	stopped := state.st == core.StateStopped
	state.mu.Unlock()
	if stopped {
		control("start", "status.starting", "error.startFailed")
	} else {
		control("stop", "status.stopping", "error.stopFailed")
	}
}

// control runs `nookdeck service <verb>`; Start/Stop/Restart are the agent's own commands, the same as in a terminal.
func control(verb, busyKey, errKey string) {
	setBusy(busyKey)
	defer func() { setBusy(""); poll() }()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if out, code := run(ctx, agentExe(), "service", verb); code != 0 {
		// an agent from before start/stop existed: do it through the system (Task Scheduler, systemctl)
		switch verb {
		case "stop":
			stopService(ctx, agentExe())
			return
		case "start":
			if startService(ctx) {
				return
			}
		}
		notice(t(errKey, "error", strings.TrimSpace(out)))
	}
}

// agentReady is closed once the first setup (install, update or adopt) has finished, whatever its result.
var agentReady = make(chan struct{})

var pairMu sync.Mutex

// pairServer starts the local page server (pairing, and on Linux the "turn the tray on" page) once.
func pairServer() (*core.PairServer, error) {
	pairMu.Lock()
	defer pairMu.Unlock()
	if pair == nil {
		p, err := core.StartPairServer(client(), lang)
		if err != nil {
			return nil, err
		}
		configurePair(p)
		p.OnUpdateChoice = updateChoice
		p.OnOpenURL = openURL
		pair = p
	}
	return pair, nil
}

func openPair() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	state.mu.Lock()
	stopped := state.st == core.StateStopped
	state.mu.Unlock()
	if stopped {
		notice(t("pair.notRunning"))
		return
	}
	if _, err := pairServer(); err != nil {
		notice(t("error.generic", "error", err.Error()))
		return
	}
	go beforePair(ctx)
	openAppWindow(pair.URL(), 460, 760)
}

func checkUpdate(user bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if user {
		mUpdate.SetTitle(t("menu.checking"))
	}
	u, err := client().Update(ctx, user)
	if err != nil || u.Error != "" {
		if user {
			mUpdate.SetTitle(t("menu.checkUpdates"))
			notice(t("error.updateCheckFailed"))
		}
		return
	}
	state.mu.Lock()
	state.update = u
	state.mu.Unlock()
	if u.Available {
		render()
		if u.Latest != nil && updateAsk().ShouldAsk(*u.Latest, user) {
			showUpdate(u, user)
		}
		return
	}
	mUpdateNow.Hide()
	if user {
		notice(t("menu.upToDate", "version", u.Current))
	}
	mUpdate.SetTitle(t("menu.checkUpdates"))
}

var (
	askOnce sync.Once
	asker   *core.UpdateAsk
)

// updateAsk remembers which versions were asked about in this run, and the skipped one (in ~/.nookdeck).
func updateAsk() *core.UpdateAsk {
	askOnce.Do(func() { asker = &core.UpdateAsk{SkipFile: filepath.Join(paths().DataDir(), "tray-update-skip")} })
	return asker
}

// showUpdate opens the "new version" window: Install and restart, Later, Skip this version. An install that cannot replace itself
// (selfUpdate) offers the download page instead.
func showUpdate(u core.Update, user bool) {
	p, err := pairServer()
	if err != nil {
		logf("update window: %v", err)
		return
	}
	// the agent's check is cached for a day; GitHub may already have a newer release. Ask the agent again then, so the window's
	// title and its notes name the same version (the notes only cover current < version <= offered anyway).
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if rel, err := core.FetchLatestRelease(ctx, &http.Client{Timeout: 10 * time.Second}); err == nil {
		if core.NeedsRecheck(*u.Latest, rel.Tag) {
			u2, err := client().Update(ctx, true)
			if err == nil && u2.Error == "" && u2.Available && u2.Latest != nil && core.Newer(*u2.Latest, *u.Latest) {
				logf("update: the agent offered %s, GitHub has %s; re-checked: %s", *u.Latest, rel.Tag, *u2.Latest)
				state.mu.Lock()
				state.update = u2
				state.mu.Unlock()
				render()
				if !user && !updateAsk().ShouldAsk(*u2.Latest, false) {
					return // skipped, or already asked in this run
				}
				u = u2
			} else {
				logf("update: re-check kept %s (GitHub %s): %v", *u.Latest, rel.Tag, err)
			}
		}
	}
	if p.WindowOpen(*u.Latest) {
		logf("update %s: its window is already open", *u.Latest)
		return
	}
	ok, where := selfUpdate()
	logf("update %s available: asking (self-update %v)", *u.Latest, ok)
	openAppWindow(p.ShowUpdate(core.UpdateDialog{Version: *u.Latest, Current: u.Current, Manual: !ok, Path: where}), 560, 540)
}

// updateFromMenu is "Update now" in the menu: the update window opens on its progress view, then the update runs.
func updateFromMenu() {
	state.mu.Lock()
	u := state.update
	state.mu.Unlock()
	if u.Latest == nil {
		return
	}
	if ok, _ := selfUpdate(); ok {
		if p, err := pairServer(); err == nil {
			p.SetUpdateState(core.UpdateState{Stage: "downloading", Version: *u.Latest})
			openAppWindow(p.ShowUpdate(core.UpdateDialog{Version: *u.Latest, Current: u.Current}), 560, 540)
		}
	}
	updateNow()
}

// updateState shows an update step in the update window (when the page server runs).
func updateState(s core.UpdateState) {
	pairMu.Lock()
	p := pair
	pairMu.Unlock()
	if p != nil {
		p.SetUpdateState(s)
	}
}

// downloadContext is an update's download context: the update window's Cancel cancels it (see PairServer.DownloadContext).
func downloadContext(parent context.Context) (context.Context, func()) {
	pairMu.Lock()
	p := pair
	pairMu.Unlock()
	if p == nil {
		return context.WithCancel(parent)
	}
	return p.DownloadContext(parent)
}

// cancelled: the download stopped because the person pressed Cancel (not a timeout); the window is already back to its question.
func cancelled(dl, parent context.Context) bool {
	return errors.Is(dl.Err(), context.Canceled) && parent.Err() == nil
}

// updateProgress feeds the download progress to the update window.
func updateProgress(version string) core.Progress {
	return func(stage string, done, total int64) {
		updateState(core.UpdateState{Stage: stage, Version: version, Done: done, Total: total})
	}
}

// updateFailed shows the error in the update window and as a notice (the window may have been closed).
func updateFailed(version, msg string) {
	updateState(core.UpdateState{Stage: "error", Version: version, Error: msg})
	notice(t("error.updateFailed", "error", msg))
}

func updateChoice(v, choice string) {
	logf("update %s: %s", v, choice)
	switch choice {
	case "install":
		updateNow()
	case "download":
		openURL(core.ReleasePage(v))
	case "skip":
		if err := updateAsk().Skip(v); err != nil {
			logf("skip %s: %v", v, err)
		}
	}
}
