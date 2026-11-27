package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestLanguagesAreComplete(t *testing.T) {
	en := Keys("en")
	if len(en) < 60 {
		t.Fatalf("english has only %d keys", len(en))
	}
	for _, l := range []string{"vi", "zh", "fr", "pt"} {
		have := map[string]bool{}
		for _, k := range Keys(l) {
			have[k] = true
		}
		for _, k := range en {
			if !have[k] {
				t.Errorf("%s misses %s", l, k)
			}
		}
	}
	for loc, want := range map[string]string{"vi-VN": "vi", "zh-Hans-CN": "zh", "en_US": "en", "fr-FR": "fr", "fr_CA.UTF-8": "fr", "pt-BR": "pt", "pt_BR.UTF-8": "pt", "pt-PT": "pt", "de-DE": "en", "": "en"} {
		if got := Lang(loc); got != want {
			t.Errorf("Lang(%q) = %q, want %q", loc, got, want)
		}
	}
	if Phones("fr", 0) != "Aucun téléphone connecté" || Phones("fr", 1) != "1 téléphone connecté" || Phones("fr", 3) != "3 téléphones connectés" {
		t.Error("fr plurals")
	}
	if Phones("pt", 1) != "1 celular conectado" || Phones("pt", 3) != "3 celulares conectados" || T("pt", "menu.version", "version", "1.2.3") != "Versão 1.2.3" {
		t.Error("pt plurals")
	}
	if got := T("vi", "menu.version", "version", "1.2.3"); got != "Phiên bản 1.2.3" {
		t.Errorf("vi version: %q", got)
	}
	if T("en", "no.such.key") != "no.such.key" {
		t.Error("a missing key falls back to the key")
	}
	if Phones("en", 0) != "No phones connected" || Phones("en", 1) != "1 phone connected" || Phones("en", 3) != "3 phones connected" {
		t.Error("plural")
	}
}

func TestVersionsAndLauncher(t *testing.T) {
	if !Newer("nookdeck 0.3.1 (abc)", "nookdeck 0.3.0 (def-dirty)") || Newer("nookdeck 0.3.0", "nookdeck 0.3.0 (x)") || Newer("nookdeck 0.2.9", "nookdeck 0.10.0") {
		t.Error("Newer")
	}
	if !Newer("nookdeck 0.1.0", "") || Newer("", "nookdeck 0.1.0") {
		t.Error("unparseable")
	}
	vbs := `sh.Run "cmd /s /c ""C:\Users\a b\AppData\Local\Nookdeck\bin\nookdeck.exe"" --port 7421 >> x.log 2>> y.log", 0, False`
	if PortFromLauncher(vbs) != 7421 || PortFromLauncher("no port") != 7420 {
		t.Error("port")
	}
	if got := ProgramFromLauncher(`sh.Run "cmd /s /c ""C:\Nook\bin\nookdeck.exe"" >> x"`); got != `C:\Nook\bin\nookdeck.exe` {
		t.Errorf("program %q", got)
	}
	// the launcher from 0.7.0 on: cmd's console is hosted by a headless conhost (no Windows Terminal window)
	headless := `sh.Run "conhost.exe --headless cmd /s /c ""C:\Users\a b\AppData\Local\Nookdeck\bin\nookdeck.exe"" --port 7422 >> x.log 2>> y.log", 0, False`
	if got := ProgramFromLauncher(headless); got != `C:\Users\a b\AppData\Local\Nookdeck\bin\nookdeck.exe` || PortFromLauncher(headless) != 7422 {
		t.Errorf("headless launcher: %q %d", got, PortFromLauncher(headless))
	}
	// 0.7.1: the cmd line sits in a variable (Windows 11 writes it to run.cmd)
	v071 := "c = \"cmd /s /c \"\"\"\"C:\\Users\\Tuan Long\\AppData\\Local\\Nookdeck\\bin\\nookdeck.exe\"\" --port 7423 >> x.log 2>> y.log\"\"\"\r\nsh.Run c, 0, False"
	if got := ProgramFromLauncher(v071); got != `C:\Users\Tuan Long\AppData\Local\Nookdeck\bin\nookdeck.exe` || PortFromLauncher(v071) != 7423 {
		t.Errorf("0.7.1 launcher: %q %d", got, PortFromLauncher(v071))
	}
}

// fakeSys is a Windows machine in memory.
type fakeSys struct {
	files    map[string]string
	versions map[string]string // exe -> --version output
	runs     []string
	stopped  []string
	failRun  map[string]int
	down     bool // the agent does not answer on its port
}

func (f *fakeSys) ops() Ops {
	return Ops{
		Exists: func(p string) bool { _, ok := f.files[p]; return ok },
		ReadFile: func(p string) (string, error) {
			s, ok := f.files[p]
			if !ok {
				return "", os.ErrNotExist
			}
			return s, nil
		},
		Copy: func(src, dst string) error {
			f.files[dst] = f.files[src]
			f.versions[dst] = f.versions[src]
			return nil
		},
		Run: func(_ context.Context, exe string, args ...string) (string, int) {
			cmd := exe + " " + strings.Join(args, " ")
			f.runs = append(f.runs, cmd)
			if len(args) == 1 && args[0] == "--version" {
				v, ok := f.versions[exe]
				if !ok {
					return "", 127
				}
				return v, 0
			}
			for k, c := range f.failRun {
				if strings.Contains(cmd, k) {
					return "boom", c
				}
			}
			return "ok", 0
		},
		StopService: func(_ context.Context, exe string) error { f.stopped = append(f.stopped, exe); return nil },
		Running:     func(context.Context, int) bool { return !f.down },
		Logf:        func(string, ...any) {},
	}
}

func newSys() (*fakeSys, Paths) {
	p := Paths{Local: `C:\L`, Home: `C:\H`}
	f := &fakeSys{files: map[string]string{`B\nookdeck.exe`: "bundled"}, versions: map[string]string{`B\nookdeck.exe`: "nookdeck 0.4.0 (abc)"}, failRun: map[string]int{}}
	return f, p
}

func has(runs []string, sub string) bool {
	for _, r := range runs {
		if strings.Contains(r, sub) {
			return true
		}
	}
	return false
}

func TestEnsureAgentFresh(t *testing.T) {
	f, p := newSys()
	r := EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops())
	if r.Err != nil || r.Action != ActionInstalled || r.Port != 7420 || r.Exe != p.Exe() {
		t.Fatalf("%+v", r)
	}
	if _, ok := f.files[p.Exe()]; !ok {
		t.Error("agent not copied")
	}
	if !has(f.runs, "migrate --no-service") || !has(f.runs, "service install") {
		t.Errorf("steps: %v", f.runs)
	}
	if len(f.stopped) != 0 {
		t.Error("nothing to stop on a fresh install")
	}
}

func TestEnsureAgentAdoptsAndUpdates(t *testing.T) {
	// a CLI install, same version: nothing is touched, the port and data are kept
	f, p := newSys()
	f.files[p.Exe()] = "cli"
	f.versions[p.Exe()] = "nookdeck 0.4.0 (zzz)"
	f.files[p.Launcher()] = `cmd /s /c ""` + p.Exe() + `"" --port 7430 >> x`
	r := EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops())
	if r.Err != nil || r.Action != ActionAdopted || r.Port != 7430 || f.files[p.Exe()] != "cli" {
		t.Fatalf("adopt: %+v files=%v", r, f.files[p.Exe()])
	}
	if has(f.runs, "service install") || has(f.runs, "service restart") || len(f.stopped) != 0 {
		t.Errorf("an adopted install is left alone: %v", f.runs)
	}
	// the bundled agent is newer: stop, replace, migrate, restart (not install: the service exists), same port
	f, p = newSys()
	f.files[p.Exe()] = "old"
	f.versions[p.Exe()] = "nookdeck 0.3.0 (old)"
	f.files[p.Launcher()] = `cmd /s /c ""` + p.Exe() + `"" --port 7430 >> x`
	r = EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops())
	if r.Err != nil || r.Action != ActionUpdated || f.files[p.Exe()] != "bundled" || len(f.stopped) != 1 {
		t.Fatalf("update: %+v", r)
	}
	if !has(f.runs, "service restart") || has(f.runs, "service install") {
		t.Errorf("update steps: %v", f.runs)
	}
	// an older bundled agent never downgrades
	f, p = newSys()
	f.versions[`B\nookdeck.exe`] = "nookdeck 0.2.0"
	f.files[p.Exe()], f.versions[p.Exe()] = "new", "nookdeck 0.3.0"
	f.files[p.Launcher()] = `cmd /s /c ""` + p.Exe() + `"" >> x`
	if r = EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops()); r.Action != ActionAdopted || f.files[p.Exe()] != "new" {
		t.Errorf("downgrade: %+v", r)
	}
	// a service that runs a program somewhere else (a dev build, a custom install) is the agent; its file is not overwritten
	f, p = newSys()
	f.files[`D:\mine\nookdeck.exe`], f.versions[`D:\mine\nookdeck.exe`] = "mine", "nookdeck 0.1.0"
	f.files[p.Launcher()] = `cmd /s /c ""D:\mine\nookdeck.exe"" >> x`
	r = EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops())
	if r.Exe != `D:\mine\nookdeck.exe` || r.Action != ActionAdopted || f.files[`D:\mine\nookdeck.exe`] != "mine" {
		t.Errorf("custom install: %+v", r)
	}
}

func TestEnsureAgentFailures(t *testing.T) {
	f, p := newSys()
	f.failRun["service install"] = 3
	if r := EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops()); r.Err == nil || !strings.Contains(r.Err.Error(), "service install failed") {
		t.Errorf("want a service error: %+v", r)
	}
	f, p = newSys()
	delete(f.files, `B\nookdeck.exe`)
	delete(f.versions, `B\nookdeck.exe`)
	if r := EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops()); r.Err == nil {
		t.Error("no bundled agent and no install must be an error")
	}
}

func TestFirewallHelpers(t *testing.T) {
	if !FirewallOK("Allow") || !FirewallOK("Allow,Allow") || FirewallOK("") || FirewallOK("Allow,Block") || FirewallOK("Block") {
		t.Error("FirewallOK")
	}
	s := FirewallScript(`C:\a'b\nookdeck.exe`)
	if !strings.Contains(s, `'C:\a''b\nookdeck.exe'`) {
		t.Errorf("script is not quoted: %s", s)
	}
	c := FirewallAddCommand(`C:\n\nookdeck.exe`)
	if !strings.Contains(c, "remoteip=localsubnet") || !strings.Contains(c, `program="C:\n\nookdeck.exe"`) || !strings.Contains(c, "action=allow") {
		t.Errorf("rule: %s", c)
	}
}

func fakeAgent(t *testing.T) *Client {
	t.Helper()
	mux := http.NewServeMux()
	need := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("x-nookdeck") != "1" {
				http.Error(w, "no", 403)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/api/devices", need(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `[{"id":"a","name":"Pixel","online":true},{"id":"b","name":"Old","online":false},{"id":"c","name":"iPhone","online":true}]`)
	}))
	mux.HandleFunc("/api/pairing", need(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("all") != "1" {
			t.Error("the app asks for every address")
		}
		fmt.Fprint(w, `{"addresses":[{"id":"lan","kind":"lan","host":"192.168.1.5","label":"Wi-Fi · 192.168.1.5","url":"http://192.168.1.5:7420/?pin=123456"}],"defaultAddress":"lan","pin":"123456","url":"x","port":7420}`)
	}))
	mux.HandleFunc("/api/pairing/regenerate", need(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "post", 405)
			return
		}
		fmt.Fprint(w, `{"addresses":[],"defaultAddress":"","pin":"654321","url":"x","port":7420}`)
	}))
	mux.HandleFunc("/api/doctor", need(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"version":"0.4.0","items":[{"id":"firewall","title":"Firewall","status":"missing","detail":""}]}`)
	}))
	mux.HandleFunc("/api/update", need(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"current":"0.4.0","latest":"0.5.0","available":true,"enabled":true}`)
	}))
	ts := httptest.NewServer(mux)
	t.Cleanup(ts.Close)
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(ts.URL, "http://"))
	n, _ := strconv.Atoi(port)
	return &Client{Port: n, HTTP: ts.Client()}
}

func TestClientAndState(t *testing.T) {
	c := fakeAgent(t)
	ctx := context.Background()
	ds, err := c.Devices(ctx)
	if err != nil || Online(ds) != 2 {
		t.Fatalf("devices %v %v", ds, err)
	}
	p, err := c.Pairing(ctx)
	if err != nil || p.PIN != "123456" || len(p.Addresses) != 1 {
		t.Fatalf("pairing %+v %v", p, err)
	}
	d, _ := c.Doctor(ctx)
	if StateOf(true, false, &d) != StateAttention || StateOf(true, false, nil) != StateRunning || StateOf(false, false, nil) != StateStopped || StateOf(false, true, nil) != StateAttention {
		t.Error("StateOf")
	}
	u, _ := c.Update(ctx, true)
	if !u.Available || u.Latest == nil || *u.Latest != "0.5.0" {
		t.Errorf("update %+v", u)
	}
	if _, err := (&Client{Port: 1, HTTP: &http.Client{}}).Devices(ctx); err == nil {
		t.Error("unreachable agent must be an error")
	}
}

func TestPairServer(t *testing.T) {
	c := fakeAgent(t)
	ps, err := StartPairServer(c, "vi")
	if err != nil {
		t.Fatal(err)
	}
	defer ps.Close()
	get := func(url string, hdr map[string]string) (int, string, string) {
		req, _ := http.NewRequest("GET", url, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b), res.Header.Get("content-type")
	}
	code, body, ct := get(ps.URL(), nil)
	if code != 200 || !strings.Contains(ct, "text/html") || !strings.Contains(body, "Ghép đôi điện thoại") || !strings.Contains(body, `lang="vi"`) {
		t.Fatalf("page %d %.80s", code, body)
	}
	if code, body, _ := get(ps.URL()+"pairing", nil); code != 200 || !strings.Contains(body, `"pin":"123456"`) {
		t.Errorf("pairing proxy %d %s", code, body)
	}
	// a wrong token and a rebinding Host get nothing
	if code, _, _ := get(strings.Replace(ps.URL(), "/"+ps.token+"/", "/nope/", 1), nil); code != 404 {
		t.Errorf("bad token %d", code)
	}
	req, _ := http.NewRequest("GET", ps.URL(), nil)
	req.Host = "evil.example"
	if res, _ := http.DefaultClient.Do(req); res == nil || res.StatusCode != 403 {
		t.Error("a foreign Host must be refused")
	}
	// the QR is a real PNG, and only for a pairing link
	code, png, ct := get(ps.URL()+"qr.png?u=http%3A%2F%2F192.168.1.5%3A7420%2F%3Fpin%3D123456", nil)
	if code != 200 || ct != "image/png" || !strings.HasPrefix(png, "\x89PNG") {
		t.Errorf("qr %d %s", code, ct)
	}
	if code, _, _ := get(ps.URL()+"qr.png?u=http%3A%2F%2Fevil.example%2F", nil); code != 400 {
		t.Errorf("an arbitrary text is not turned into a QR: %d", code)
	}
	// new PIN goes through as POST
	req, _ = http.NewRequest("POST", ps.URL()+"pairing", nil)
	res, _ := http.DefaultClient.Do(req)
	b, _ := io.ReadAll(res.Body)
	if !strings.Contains(string(b), "654321") {
		t.Errorf("regenerate: %s", b)
	}
}

func TestPairPageEscapes(t *testing.T) {
	for _, l := range []string{"en", "vi", "zh", "fr", "pt"} {
		if p := PairPage(l); strings.Contains(p, "__TX__") || strings.Contains(p, "__LANG__") || !strings.Contains(p, "pair.title") {
			t.Errorf("%s: placeholders left", l)
		}
	}
}

func TestDownloadInstaller(t *testing.T) {
	data := []byte("MZ installer bytes")
	sum := sha256.Sum256(data)
	good := hex.EncodeToString(sum[:])
	for _, tc := range []struct {
		name, sums string
		wantErr    string
	}{
		{"ok", good + "  " + InstallerName + "\n" + strings.Repeat("0", 64) + "  other\n", ""},
		{"wrong hash", strings.Repeat("a", 64) + "  " + InstallerName, "checksum mismatch"},
		{"not listed", good + "  other", "lists no"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case strings.HasSuffix(r.URL.Path, "/SHA256SUMS"):
					fmt.Fprint(w, tc.sums)
				case strings.HasSuffix(r.URL.Path, InstallerName):
					w.Write(data)
				default:
					http.NotFound(w, r)
				}
			}))
			defer ts.Close()
			rt := ts.Client()
			rt.Transport = rewrite{ts.URL, http.DefaultTransport}
			dest := filepath.Join(t.TempDir(), InstallerName)
			var steps []string
			err := DownloadInstaller(context.Background(), rt, "0.5.0", dest, func(stage string, done, total int64) {
				steps = append(steps, fmt.Sprintf("%s %d/%d", stage, done, total))
			})
			if tc.wantErr == "" {
				if err != nil {
					t.Fatal(err)
				}
				if b, _ := os.ReadFile(dest); string(b) != string(data) {
					t.Error("content")
				}
				// starts at 0, ends with every byte of the known size, then the checksum step
				n := len(data)
				if len(steps) < 3 || steps[0] != "downloading 0/0" || steps[len(steps)-2] != fmt.Sprintf("downloading %d/%d", n, n) || steps[len(steps)-1] != fmt.Sprintf("checking %d/%d", n, n) {
					t.Errorf("progress %v", steps)
				}
				return
			}
			if len(steps) > 0 && strings.HasPrefix(steps[len(steps)-1], "checking") && tc.name != "wrong hash" {
				t.Errorf("no checking step for %s: %v", tc.name, steps)
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("want %q, got %v", tc.wantErr, err)
			}
			if _, e := os.Stat(dest); e == nil {
				t.Error("a file with a bad checksum must be deleted")
			}
		})
	}
	if ReleaseURL("v0.5.0", InstallerName) != "https://github.com/howznguyen/nookdeck/releases/download/v0.5.0/Nookdeck-Setup.exe" {
		t.Error("ReleaseURL")
	}
	b, _ := json.Marshal(SumFor("x", "y"))
	_ = b
}

// rewrite sends every request to the test server, whatever host it names.
type rewrite struct {
	base string
	next http.RoundTripper
}

func (r rewrite) RoundTrip(req *http.Request) (*http.Response, error) {
	u := *req.URL
	h := strings.TrimPrefix(r.base, "http://")
	u.Scheme, u.Host = "http", h
	req2 := req.Clone(req.Context())
	req2.URL = &u
	return r.next.RoundTrip(req2)
}

// "adopted" must never leave the deck down: an installed agent that does not answer is started, whatever the version says
func TestEnsureAgentStartsAStoppedAgent(t *testing.T) {
	adopted := func() (*fakeSys, Paths) {
		f, p := newSys()
		f.files[p.Exe()], f.versions[p.Exe()] = "cli", "nookdeck 0.4.0 (zzz)" // same version as the bundled one
		f.files[p.Launcher()] = `cmd /s /c ""` + p.Exe() + `"" --port 7430 >> x`
		return f, p
	}
	// running: untouched
	f, p := adopted()
	if r := EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops()); r.Err != nil || r.Action != ActionAdopted || has(f.runs, "service start") {
		t.Fatalf("a running agent is left alone: %v", f.runs)
	}
	// not answering: started, no reinstall, no copy
	f, p = adopted()
	f.down = true
	r := EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops())
	if r.Err != nil || r.Action != ActionAdopted || !has(f.runs, p.Exe()+" service start") || has(f.runs, "service install") || f.files[p.Exe()] != "cli" {
		t.Fatalf("a stopped agent is started: %+v %v", r, f.runs)
	}
	// `service start` fails (the launcher is gone, an old agent): the install step writes it again and starts it
	f, p = adopted()
	f.down = true
	f.failRun["service start"] = 1
	if r = EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops()); r.Err != nil || !has(f.runs, "service install --port 7430") {
		t.Fatalf("fallback to install: %+v %v", r, f.runs)
	}
	// both fail: an error, never a silent "adopted"
	f, p = adopted()
	f.down = true
	f.failRun["service"] = 1
	if r = EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops()); r.Err == nil {
		t.Fatalf("a deck that stays down is an error: %+v", r)
	}
	// a service that runs another program is started the same way
	f, p = newSys()
	f.files[`D:\mine\nookdeck.exe`], f.versions[`D:\mine\nookdeck.exe`] = "mine", "nookdeck 0.1.0"
	f.files[p.Launcher()] = `cmd /s /c ""D:\mine\nookdeck.exe"" >> x`
	f.down = true
	if r = EnsureAgent(context.Background(), p, `B\nookdeck.exe`, f.ops()); r.Err != nil || !has(f.runs, `D:\mine\nookdeck.exe service start`) {
		t.Errorf("custom install: %+v %v", r, f.runs)
	}
}

func TestFirewallProblem(t *testing.T) {
	var d Doctor
	if err := json.Unmarshal([]byte(`{"items":[{"id":"network","status":"unknown","detail":"x"},{"id":"firewall","status":"denied","detail":"only Private","fix":{"text":"Run as administrator: netsh advfirewall ...","settingsUrl":"windowsdefender://network"}}]}`), &d); err != nil {
		t.Fatal(err)
	}
	it := FirewallProblem(&d)
	if it == nil || it.Fix == nil || it.Fix.SettingsURL != "windowsdefender://network" || !FirewallRuleFixes(it) {
		t.Fatalf("problem %+v", it)
	}
	// "Block all incoming connections": the owner's setting, only opened
	d.Items[1].Fix.Text = "Open Windows Security > Firewall & network protection"
	if FirewallRuleFixes(FirewallProblem(&d)) {
		t.Error("block-all is not fixed by a rule")
	}
	d.Items[1].Status = "ok"
	if FirewallProblem(&d) != nil || FirewallProblem(nil) != nil {
		t.Error("ok / nil")
	}
}

func TestAndroidOffer(t *testing.T) {
	if p, k := AndroidOffer(UsbStatus{}); p != nil || k != "" {
		t.Fatalf("no phones: %v %q", p, k)
	}
	cases := []struct {
		phone UsbPhone
		want  string
	}{
		{UsbPhone{Serial: "a", State: "unauthorized"}, "allow"},
		{UsbPhone{Serial: "a", State: "device"}, "setup"},
		{UsbPhone{Serial: "a", State: "device", App: "0.8.0", SetUp: false}, "setup"},
		{UsbPhone{Serial: "a", State: "device", App: "0.7.0", SetUp: true, AppOld: true}, "update"},
		{UsbPhone{Serial: "a", State: "device", App: "0.8.0", SetUp: true, Linked: true}, ""},
		{UsbPhone{Serial: "a", State: "offline"}, ""},
	}
	for _, c := range cases {
		if _, k := AndroidOffer(UsbStatus{Phones: []UsbPhone{c.phone}}); k != c.want {
			t.Errorf("%+v: got %q, want %q", c.phone, k, c.want)
		}
	}
	// a ready phone after a set-up one is still offered
	p, k := AndroidOffer(UsbStatus{Phones: []UsbPhone{{Serial: "x", State: "device", App: "1", SetUp: true}, {Serial: "y", State: "device"}}})
	if p == nil || p.Serial != "y" || k != "setup" {
		t.Fatalf("second phone: %v %q", p, k)
	}
}
