package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Android phones on a USB cable (spec: specs/2026-11-27/android-app-and-usb-setup). The agent does the adb work; the tray only
// shows a phone that waits for setup and asks the agent to set it up.

type UsbPhone struct {
	Serial string `json:"serial"`
	State  string `json:"state"`
	Model  string `json:"model"`
	App    string `json:"app"`
	AppOld bool   `json:"appOld"`
	SetUp  bool   `json:"setUp"`
	Linked bool   `json:"linked"`
}

type UsbStatus struct {
	Adb    *struct{ Path string } `json:"adb"`
	Phones []UsbPhone             `json:"phones"`
	Busy   string                 `json:"busy"`
}

// AndroidPeek is what the agent's USB watcher saw last; it does not run adb (cheap enough for every poll).
func (c *Client) AndroidPeek(ctx context.Context) (UsbStatus, error) {
	var s UsbStatus
	return s, c.do(ctx, "GET", "/api/android?peek=1", &s)
}

// AndroidSetup installs the app on the phone, links it through the cable, pairs it and opens the deck. It returns the phone's model.
func (c *Client) AndroidSetup(ctx context.Context, serial string) (string, error) {
	body, _ := json.Marshal(map[string]any{"serial": serial})
	req, err := http.NewRequestWithContext(ctx, "POST", c.base()+"/api/android/setup", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("x-nookdeck", "1")
	req.Header.Set("content-type", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var out struct {
		OK    bool   `json:"ok"`
		Model string `json:"model"`
		Error string `json:"error"`
	}
	_ = json.Unmarshal(raw, &out)
	if !out.OK {
		if out.Error == "" {
			out.Error = fmt.Sprintf("agent answered %d", res.StatusCode)
		}
		return "", fmt.Errorf("%s", out.Error)
	}
	return out.Model, nil
}

// AndroidOffer is the phone the tray menu offers, and how: "setup" (no app, or set up on another computer), "update" (the app is
// older than the agent), "allow" (USB debugging not allowed yet on the phone). Nil when nothing waits: a set-up phone is linked
// again by the agent itself.
func AndroidOffer(s UsbStatus) (*UsbPhone, string) {
	for i := range s.Phones {
		p := &s.Phones[i]
		switch {
		case p.State == "unauthorized":
			return p, "allow"
		case p.State != "device":
			continue
		case p.App == "" || !p.SetUp:
			return p, "setup"
		case p.AppOld:
			return p, "update"
		}
	}
	return nil, ""
}

// PhoneName is the model, or "Android phone" in the user's language when adb did not say.
func PhoneName(lang string, p *UsbPhone) string {
	if p.Model != "" {
		return p.Model
	}
	return T(lang, "android.phone")
}
