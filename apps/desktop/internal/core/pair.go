package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

// PairServer serves the pairing window's page on 127.0.0.1 (a random port and a random path token, so no other site or local
// page can read the PIN). The page shows the QR, the PIN and an address picker, and fetches everything from the agent through here.
type PairServer struct {
	client *Client
	lang   string
	// Linux (L9): TrayOn reports whether a tray (StatusNotifierWatcher) is there; TrayCommand installs one. Set before the page is
	// opened; nil TrayOn means the "turn the tray on" page is not served.
	TrayOn      func() bool
	TrayCommand string
	// OnUpdateChoice gets the answer of the "new version" window (install, later, skip, download) for the version it showed.
	OnUpdateChoice func(version, choice string)
	// OnOpenURL opens an https link of the update window (release notes, the release page) in the default browser.
	OnOpenURL func(url string)
	// Notes lists the releases for "What's new" (default FetchReleases; tests set a fake).
	Notes    func(ctx context.Context) ([]Release, error)
	upMu     sync.Mutex
	update   *UpdateDialog // waiting for an answer
	shown    *UpdateDialog // the last one shown (notes and progress outlive the answer)
	state    UpdateState
	cancelDL context.CancelFunc // set while the update's download (or its check) can be cancelled
	answered *UpdateDialog      // the window's dialog after its answer: Cancel brings the question back
	notesFor string
	notes    *notesReply
	alive    map[string]time.Time // version -> last heartbeat of an open update window
	token          string
	ln             net.Listener
	srv            *http.Server
}

// StartPairServer listens and returns the server; URL() is what the window opens.
func StartPairServer(c *Client, lang string) (*PairServer, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	b := make([]byte, 16)
	rand.Read(b)
	p := &PairServer{client: c, lang: lang, token: hex.EncodeToString(b), ln: ln}
	p.srv = &http.Server{Handler: p.Handler(), ReadHeaderTimeout: 5 * time.Second}
	go p.srv.Serve(ln)
	return p, nil
}

func (p *PairServer) URL() string { return "http://" + p.ln.Addr().String() + "/" + p.token + "/" }

// TrayURL is the "turn the tray on" page (Linux without a StatusNotifierWatcher).
func (p *PairServer) TrayURL() string { return p.URL() + "tray" }

// ShowUpdate sets what the "new version" window shows and returns its address.
func (p *PairServer) ShowUpdate(d UpdateDialog) string {
	p.upMu.Lock()
	p.update = &d
	p.shown = &d
	if !p.state.Active() { // a finished or failed run is not shown again; a running one is (the window opens on its progress)
		p.state = UpdateState{}
	}
	p.upMu.Unlock()
	return p.URL() + "update"
}

// WindowOpen reports whether an update window for version is open now (it pinged in the last 5 s).
func (p *PairServer) WindowOpen(version string) bool {
	p.upMu.Lock()
	defer p.upMu.Unlock()
	t, ok := p.alive[version]
	return ok && time.Since(t) < 5*time.Second
}

// UpdateState is where an update started from the window is: Stage "" (not started), "downloading" (Done and Total bytes; Total
// 0 = unknown), "checking", "installing" (Password: the system may ask for it, Linux), "done" or "error" (Error says why).
type UpdateState struct {
	Stage    string `json:"stage"`
	Version  string `json:"version,omitempty"`
	Done     int64  `json:"done,omitempty"`
	Total    int64  `json:"total,omitempty"`
	Password bool   `json:"password,omitempty"`
	Error    string `json:"error,omitempty"`
}

// Active: an update is downloading, checking or installing.
func (s UpdateState) Active() bool {
	return s.Stage == "downloading" || s.Stage == "checking" || s.Stage == "installing"
}

// SetUpdateState is what the update window shows while it installs (polled by the page).
// DownloadContext is the context of an update's download: the window's Cancel cancels it. stop() ends that (call it when the
// download is over, before installing: an install cannot be cancelled).
func (p *PairServer) DownloadContext(parent context.Context) (ctx context.Context, stop func()) {
	ctx, cancel := context.WithCancel(parent)
	p.upMu.Lock()
	p.cancelDL = cancel
	p.upMu.Unlock()
	return ctx, func() {
		p.upMu.Lock()
		p.cancelDL = nil
		p.upMu.Unlock()
		cancel()
	}
}

func (p *PairServer) SetUpdateState(s UpdateState) {
	p.upMu.Lock()
	p.state = s
	p.upMu.Unlock()
}

// UpdateProgress adapts SetUpdateState to DownloadAsset's progress callback.
func (p *PairServer) UpdateProgress(version string) Progress {
	return func(stage string, done, total int64) {
		p.SetUpdateState(UpdateState{Stage: stage, Version: version, Done: done, Total: total})
	}
}

type notesReply struct {
	Sections []NoteSection `json:"sections"`
	More     bool          `json:"more"`
	Page     string        `json:"page"`
}

// notesFor fetches and keeps the notes of the version shown (once per version; a failed fetch is tried again next time).
func (p *PairServer) releaseNotes(ctx context.Context, d UpdateDialog) (*notesReply, error) {
	p.upMu.Lock()
	if p.notes != nil && p.notesFor == d.Version+"|"+d.Current {
		n := p.notes
		p.upMu.Unlock()
		return n, nil
	}
	p.upMu.Unlock()
	fetch := p.Notes
	if fetch == nil {
		fetch = func(ctx context.Context) ([]Release, error) { return FetchReleases(ctx, &http.Client{Timeout: 10 * time.Second}) }
	}
	rs, err := fetch(ctx)
	if err != nil {
		return nil, err
	}
	secs, more, page := NotesFromReleases(rs, d.Current, d.Version, 3)
	n := &notesReply{Sections: secs, More: more, Page: page}
	if n.Sections == nil {
		n.Sections = []NoteSection{}
	}
	p.upMu.Lock()
	p.notes, p.notesFor = n, d.Version+"|"+d.Current
	p.upMu.Unlock()
	return n, nil
}

func (p *PairServer) shownUpdate() *UpdateDialog {
	p.upMu.Lock()
	defer p.upMu.Unlock()
	return p.update
}

func (p *PairServer) Close() { p.srv.Close() }

func (p *PairServer) Handler() http.Handler {
	mux := http.NewServeMux()
	prefix := "/" + p.token + "/"
	mux.HandleFunc(prefix, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != prefix {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.Header().Set("cache-control", "no-store")
		w.Write([]byte(PairPage(p.lang)))
	})
	mux.HandleFunc(prefix+"pairing", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		defer cancel()
		var pr Pairing
		var err error
		if r.Method == "POST" {
			pr, err = p.client.NewPIN(ctx)
		} else {
			pr, err = p.client.Pairing(ctx)
		}
		w.Header().Set("content-type", "application/json")
		w.Header().Set("cache-control", "no-store")
		if err != nil {
			w.WriteHeader(502)
			json.NewEncoder(w).Encode(map[string]string{"error": "unreachable"})
			return
		}
		json.NewEncoder(w).Encode(pr)
	})
	// Android phones on the USB cable, shown under the QR code: what the agent's USB watcher saw last, and setting one up or removing it
	mux.HandleFunc(prefix+"android", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
		defer cancel()
		s, err := p.client.AndroidPeek(ctx)
		w.Header().Set("content-type", "application/json")
		w.Header().Set("cache-control", "no-store")
		if err != nil {
			json.NewEncoder(w).Encode(UsbStatus{})
			return
		}
		json.NewEncoder(w).Encode(s)
	})
	mux.HandleFunc(prefix+"android/setup", func(w http.ResponseWriter, r *http.Request) {
		androidAction(w, r, func(ctx context.Context, serial string) error { _, err := p.client.AndroidSetup(ctx, serial); return err })
	})
	mux.HandleFunc(prefix+"android/forget", func(w http.ResponseWriter, r *http.Request) {
		androidAction(w, r, p.client.AndroidForget)
	})
	mux.HandleFunc(prefix+"tray", func(w http.ResponseWriter, r *http.Request) {
		if p.TrayOn == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.Header().Set("cache-control", "no-store")
		w.Write([]byte(TrayPage(p.lang, p.TrayCommand, p.client.ManageURL())))
	})
	mux.HandleFunc(prefix+"tray/status", func(w http.ResponseWriter, r *http.Request) {
		if p.TrayOn == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "application/json")
		w.Header().Set("cache-control", "no-store")
		json.NewEncoder(w).Encode(map[string]bool{"trayOn": p.TrayOn()})
	})
	mux.HandleFunc(prefix+"update", func(w http.ResponseWriter, r *http.Request) {
		d := p.shownUpdate()
		if d == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "text/html; charset=utf-8")
		w.Header().Set("cache-control", "no-store")
		w.Write([]byte(UpdatePage(p.lang, *d)))
	})
	// the update window pings every 2 s: the tray does not open a second window for a version that has one, and a window whose
	// tray is gone closes itself (it cannot reach this any more)
	mux.HandleFunc(prefix+"update/alive", func(w http.ResponseWriter, r *http.Request) {
		v := r.URL.Query().Get("v")
		if v == "" || len(v) > 40 {
			http.Error(w, "no version", 400)
			return
		}
		p.upMu.Lock()
		if p.alive == nil {
			p.alive = map[string]time.Time{}
		}
		p.alive[v] = time.Now()
		p.upMu.Unlock()
		w.WriteHeader(204)
	})
	mux.HandleFunc(prefix+"update/icon.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "image/png")
		w.Header().Set("cache-control", "max-age=3600")
		w.Write(AppIcon)
	})
	mux.HandleFunc(prefix+"update/notes", func(w http.ResponseWriter, r *http.Request) {
		p.upMu.Lock()
		d := p.shown
		p.upMu.Unlock()
		if d == nil {
			http.NotFound(w, r)
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		n, err := p.releaseNotes(ctx, *d)
		w.Header().Set("content-type", "application/json")
		w.Header().Set("cache-control", "no-store")
		if err != nil {
			w.WriteHeader(502)
			json.NewEncoder(w).Encode(map[string]string{"error": "unreachable"})
			return
		}
		json.NewEncoder(w).Encode(n)
	})
	mux.HandleFunc(prefix+"update/progress", func(w http.ResponseWriter, r *http.Request) {
		p.upMu.Lock()
		s := p.state
		p.upMu.Unlock()
		w.Header().Set("content-type", "application/json")
		w.Header().Set("cache-control", "no-store")
		json.NewEncoder(w).Encode(s)
	})
	mux.HandleFunc(prefix+"update/open", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			URL string `json:"url"`
		}
		if r.Method != "POST" || json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&body) != nil || !SafeLink(body.URL) {
			http.Error(w, "bad link", 400)
			return
		}
		if p.OnOpenURL != nil {
			go p.OnOpenURL(body.URL)
		}
		w.WriteHeader(204)
	})
	// Cancel while downloading: the download stops (the tray removes its file) and the window asks again
	mux.HandleFunc(prefix+"update/cancel", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "POST", 405)
			return
		}
		p.upMu.Lock()
		cancel := p.cancelDL
		if cancel == nil || (p.state.Stage != "downloading" && p.state.Stage != "checking") {
			p.upMu.Unlock()
			http.Error(w, "nothing to cancel", 409)
			return
		}
		p.cancelDL, p.state, p.update = nil, UpdateState{}, p.answered
		p.upMu.Unlock()
		cancel()
		w.WriteHeader(204)
	})
	mux.HandleFunc(prefix+"update/choice", func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Choice string `json:"choice"`
		}
		d := p.shownUpdate()
		if r.Method != "POST" || d == nil {
			http.Error(w, "no update shown", 404)
			return
		}
		if json.NewDecoder(io.LimitReader(r.Body, 1024)).Decode(&body) != nil || !UpdateChoices[body.Choice] || (body.Choice == "install" && d.Manual) {
			http.Error(w, "bad choice", 400)
			return
		}
		p.upMu.Lock()
		p.update, p.answered = nil, d // one answer per window
		p.upMu.Unlock()
		if p.OnUpdateChoice != nil {
			go p.OnUpdateChoice(d.Version, body.Choice)
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc(prefix+"qr.png", func(w http.ResponseWriter, r *http.Request) {
		u := r.URL.Query().Get("u")
		// only pairing links (http://host:port/?pin=...), not an open QR generator
		pu, err := url.Parse(u)
		if err != nil || pu.Scheme != "http" || len(u) > 300 || !strings.Contains(u, "?pin=") {
			http.Error(w, "bad link", 400)
			return
		}
		png, err := qrcode.Encode(u, qrcode.Medium, 320)
		if err != nil {
			http.Error(w, "qr failed", 500)
			return
		}
		w.Header().Set("content-type", "image/png")
		w.Header().Set("cache-control", "no-store")
		w.Write(png)
	})
	// a request that did not come to 127.0.0.1 (DNS rebinding) gets nothing
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, _ := net.SplitHostPort(r.Host)
		if host != "127.0.0.1" && host != "localhost" {
			http.Error(w, "forbidden", 403)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// androidAction runs a POST {serial} from the pairing window against the agent and answers {ok, error}.
func androidAction(w http.ResponseWriter, r *http.Request, do func(ctx context.Context, serial string) error) {
	if r.Method != "POST" {
		http.Error(w, "POST only", 405)
		return
	}
	var in struct {
		Serial string `json:"serial"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&in); err != nil || in.Serial == "" {
		http.Error(w, "bad request", 400)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute) // installing the app can take a while on an old phone
	defer cancel()
	w.Header().Set("content-type", "application/json")
	if err := do(ctx, in.Serial); err != nil {
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// PairPage is the HTML of the pairing window, with the texts of lang filled in.
func PairPage(lang string) string {
	tx := map[string]string{}
	for _, k := range []string{"pair.title", "pair.scan", "pair.qrLabel", "pair.pin", "pair.newPin", "pair.via", "pair.copyLink", "pair.copied", "pair.loading", "pair.error", "pair.android", "pair.androidSetup", "pair.androidUpdate", "pair.androidAllow", "pair.androidLinked", "pair.androidWaiting", "pair.androidBusy", "pair.androidRemove", "pair.androidRemoved", "pair.androidHint", "common.close"} {
		tx[k] = T(lang, k)
	}
	b, _ := json.Marshal(tx)
	b = []byte(strings.ReplaceAll(string(b), "<", `<`))
	return strings.ReplaceAll(strings.ReplaceAll(pairHTML, "__LANG__", lang), "__TX__", string(b))
}

const pairHTML = `<!doctype html><html lang="__LANG__"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nookdeck</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1f;--mut:#6b6b76;--card:#f3f3f6;--acc:#2f6bff}
@media(prefers-color-scheme:dark){:root{--bg:#17171b;--fg:#f1f1f4;--mut:#9a9aa6;--card:#232329}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.4 "Segoe UI",system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:20px 24px;gap:14px}
h1{font-size:18px;margin:0}p{margin:0;color:var(--mut);text-align:center}
#qr{width:260px;height:260px;border-radius:12px;background:#fff;padding:8px;display:block}
.pin{font:600 34px/1 ui-monospace,Consolas,monospace;letter-spacing:.2em;margin-left:.2em}
label{font-size:13px;color:var(--mut);align-self:stretch}select,button{font:inherit;color:inherit;background:var(--card);border:1px solid transparent;border-radius:8px;padding:8px 10px}
select{width:100%;margin-top:4px}button{cursor:pointer}button:hover{border-color:var(--acc)}.row{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
#err{color:#d33;display:none}
#and{align-self:stretch;display:none;flex-direction:column;gap:8px;border-top:1px solid var(--card);padding-top:14px}
#and h2{font-size:14px;margin:0}#and .hint{font-size:13px;text-align:left}
.ph{display:flex;align-items:center;gap:10px;background:var(--card);border-radius:10px;padding:10px 12px}
.ph .nm{flex:1;min-width:0}.ph b{display:block;font-weight:600}.ph small{color:var(--mut);font-size:12.5px}
.ph .ok{color:#1f9d55}.ph button{background:var(--bg)}.ph button.pri{background:var(--acc);color:#fff}
#andmsg{font-size:13px;text-align:left;display:none}
</style></head><body>
<h1 id="t"></h1><p id="scan"></p>
<img id="qr" alt="" width="260" height="260"><div class="pin" id="pin">······</div>
<div style="align-self:stretch"><label for="addr" id="via"></label><select id="addr"></select></div>
<div class="row"><button id="copy"></button><button id="renew"></button></div>
<p id="err"></p>
<section id="and"><h2 id="andt"></h2><p class="hint" id="andh"></p><div id="phones"></div><p id="andmsg"></p></section>
<script>
const TX=__TX__;const $=i=>document.getElementById(i);
$("t").textContent=TX["pair.title"];document.title=TX["pair.title"];$("scan").textContent=TX["pair.scan"];$("qr").alt=TX["pair.qrLabel"];
$("via").textContent=TX["pair.via"];$("copy").textContent=TX["pair.copyLink"];$("renew").textContent=TX["pair.newPin"];
let data=null,picked=null;
function show(){if(!data)return;const a=data.addresses.find(x=>x.id===picked)||data.addresses.find(x=>x.id===data.defaultAddress)||data.addresses[0];
 $("pin").textContent=data.pin;if(!a)return;picked=a.id;$("qr").src="qr.png?u="+encodeURIComponent(a.url);}
function fill(){const s=$("addr");const cur=picked;s.innerHTML="";for(const a of data.addresses){const o=document.createElement("option");o.value=a.id;o.textContent=a.label+(a.note?" ("+a.note+")":"");s.appendChild(o);}
 if(!picked||!data.addresses.some(x=>x.id===picked))picked=data.defaultAddress||(data.addresses[0]||{}).id;s.value=picked;}
async function load(method){try{const r=await fetch("pairing",{method:method||"GET"});if(!r.ok)throw 0;const d=await r.json();const same=data&&JSON.stringify(d.addresses.map(a=>a.id))===JSON.stringify(data.addresses.map(a=>a.id));
 const pinChanged=!data||data.pin!==d.pin;data=d;if(!same)fill();$("err").style.display="none";if(pinChanged||!same)show();}catch(e){$("err").textContent=TX["pair.error"];$("err").style.display="block";}}
$("addr").onchange=e=>{picked=e.target.value;show();};
$("renew").onclick=()=>load("POST");
$("copy").onclick=async()=>{const a=data&&data.addresses.find(x=>x.id===picked);if(!a)return;try{await navigator.clipboard.writeText(a.url);}catch(e){}const b=$("copy");const o=b.textContent;b.textContent=TX["pair.copied"];setTimeout(()=>b.textContent=o,1500);};
let busy="";
function note(t,bad){const m=$("andmsg");m.textContent=t||"";m.style.display=t?"block":"none";m.style.color=bad?"#d33":"";}
async function act(path,serial){busy=serial;note("");drawAnd(last);try{const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({serial})});const d=await r.json();
 if(!d.ok)note(d.error||"",true);else if(path==="android/forget")note(TX["pair.androidRemoved"]);}catch(e){note(TX["pair.error"],true);}busy="";loadAnd();}
let last=null,drawn="";
function drawAnd(s){last=s;const key=JSON.stringify([s,busy,TX["pair.android"]]);if(key===drawn)return;drawn=key;const ph=(s&&s.phones)||[];$("and").style.display=ph.length?"flex":"none";const box=$("phones");box.innerHTML="";
 for(const p of ph){const row=document.createElement("div");row.className="ph";const nm=document.createElement("div");nm.className="nm";const b=document.createElement("b");b.textContent=p.model||p.serial;nm.appendChild(b);
  const sm=document.createElement("small");let btn=null,rm=null;
  if(busy===p.serial||s.busy===p.serial){sm.textContent=TX["pair.androidBusy"];}
  else if(p.state==="unauthorized"){sm.textContent=TX["pair.androidAllow"];}
  else if(p.state!=="device"){sm.textContent=p.state;}
  else if(!p.app||!p.setUp||p.appOld){sm.textContent=p.android?"Android "+p.android:"";btn=document.createElement("button");btn.className="pri";btn.textContent=TX[p.appOld&&p.setUp?"pair.androidUpdate":"pair.androidSetup"];btn.onclick=()=>act("android/setup",p.serial);}
  else{sm.textContent=TX[p.linked?"pair.androidLinked":"pair.androidWaiting"];if(p.linked)sm.className="ok";rm=document.createElement("button");rm.textContent=TX["pair.androidRemove"];rm.onclick=()=>act("android/forget",p.serial);}
  nm.appendChild(sm);row.appendChild(nm);if(btn){btn.disabled=!!busy;row.appendChild(btn);}if(rm){rm.disabled=!!busy;row.appendChild(rm);}box.appendChild(row);}}
async function loadAnd(){try{const r=await fetch("android");drawAnd(await r.json());}catch(e){drawAnd(null);}}
$("andt").textContent=TX["pair.android"];$("andh").textContent=TX["pair.androidHint"];
load();loadAnd();setInterval(()=>{if(!document.hidden)load();},5000);setInterval(()=>{if(!document.hidden&&!busy)loadAnd();},2000);
</script></body></html>`
