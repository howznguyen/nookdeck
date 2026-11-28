import { useCallback, useEffect, useState } from "react";
import { IconBrandAndroid as Android, IconPlugConnected as Plug } from "@tabler/icons-react";
import { Alert } from "@/components/ui/knowns/alert";
import { Badge } from "@/components/ui/knowns/badge";
import { Button } from "@/components/ui/knowns/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/knowns/card";
import { Switch } from "@/components/ui/knowns/switch";
import { api, type UsbPhone, type UsbStatus } from "@/api";
import { t, useLanguage } from "@/lib/i18n";

const POLL_MS = 3000;

/** The button for a ready phone: set it up, update its app, or set it up again. */
export function setupLabel(p: UsbPhone): string {
  if (!p.app) return t("Set up");
  if (p.appOld) return t("Update the app");
  return p.setUp ? t("Set up again") : t("Set up");
}

/**
 * Android phones on a USB cable (spec: specs/2026-11-27/android-app-and-usb-setup): the agent installs the Nookdeck app, links it
 * through the cable and pairs it without a PIN. Needs USB debugging on the phone and Google's adb on the computer.
 */
export function AndroidCard() {
  useLanguage();
  const [st, setSt] = useState<UsbStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stayAwake, setStayAwake] = useState(false);
  const [battery, setBattery] = useState(false);

  const load = useCallback(async () => {
    try {
      setSt(await api.androidStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const getAdb = async () => {
    setBusy("adb");
    setError(null);
    try {
      await api.androidInstallAdb();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const setup = async (p: UsbPhone) => {
    setBusy(p.serial);
    setError(null);
    setDone(null);
    try {
      const r = await api.androidSetup(p.serial, { stayAwake, battery });
      setDone(t("{model} is set up: the deck is open on the phone.", { model: r.model }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const phones = st?.phones ?? [];
  return (
    <Card data-part="android-usb">
      <CardHeader className="p-4 pb-0">
        <CardTitle className="flex items-center gap-2 text-sm"><Android className="size-4" aria-hidden />{t("Android phone over USB")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 p-4">
        <p className="text-xs leading-snug text-muted-foreground">{t("Plug the phone into this computer: Nookdeck installs its app, connects it through the cable and pairs it, with no Wi-Fi, address or PIN.")}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        {st && !st.adb && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs leading-snug">{t("This needs Google's Android tool adb (about 10 MB), downloaded once from Google.")}</p>
            <Button size="sm" variant="secondary" loading={busy === "adb" || st.busy === "adb"} onClick={getAdb}>{t("Download adb")}</Button>
          </div>
        )}
        {st?.adb && !phones.length && (
          <div className="rounded-lg border p-2.5 text-xs leading-snug text-muted-foreground">
            <p className="font-medium text-foreground">{t("No Android phone plugged in.")}</p>
            <p className="mt-1">{t("On the phone: Settings, About phone, tap Build number 7 times; then Developer options, turn on USB debugging. Plug the phone in and tap Allow on its screen.")}</p>
            <p className="mt-1">{t("On Windows, some phones also need their maker's USB driver.")}</p>
          </div>
        )}
        {phones.map((p) => (
          <div key={p.serial} className="flex flex-col gap-2 rounded-lg border p-2.5" data-part="usb-phone">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{p.model ?? p.serial}</div>
                <div className="text-[11.5px] text-muted-foreground">{[p.android && `Android ${p.android}`, p.app && t("app {version}", { version: p.app })].filter(Boolean).join(" · ")}</div>
              </div>
              {p.state === "device" && p.setUp && p.linked && <Badge size="sm" tone="success"><Plug className="mr-1 size-3" aria-hidden />{t("Connected through the cable")}</Badge>}
            </div>
            {p.state === "unauthorized" && <Alert tone="warning">{t("Tap Allow on the phone's screen to trust this computer. No prompt? Unplug the cable and plug it in again.")}</Alert>}
            {p.state !== "device" && p.state !== "unauthorized" && <p className="text-xs text-muted-foreground">{t("The phone is {state}.", { state: p.state })}</p>}
            {p.state === "device" && (
              <Button size="sm" variant={p.setUp && !p.appOld ? "secondary" : "primary"} loading={busy === p.serial} disabled={!!busy && busy !== p.serial} onClick={() => setup(p)}>{setupLabel(p)}</Button>
            )}
          </div>
        ))}
        {st?.adb && phones.some((p) => p.state === "device") && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t("Keep the phone's screen on while it charges")}</span>
              <Switch checked={stayAwake} onCheckedChange={setStayAwake} aria-label={t("Keep the phone's screen on while it charges")} />
            </label>
            <label className="flex items-center justify-between gap-3 text-xs">
              <span>{t("Let the app run without battery limits")}</span>
              <Switch checked={battery} onCheckedChange={setBattery} aria-label={t("Let the app run without battery limits")} />
            </label>
            <ul data-part="usb-notes" className="flex list-disc flex-col gap-1 pl-4 text-[11.5px] leading-snug text-muted-foreground">
              <li>{t("Keep USB debugging on: the deck goes through the cable only while it is. Some banking apps will not open while it is on, so a spare phone suits this best.")}</li>
              <li>{t("A phone that stays plugged in all day: turn on its battery protection (a charge limit around 85%) if it has one.")}</li>
              <li>{t("Forgetting this phone on the Devices list puts back the screen and battery settings changed here, if it is plugged in.")}</li>
            </ul>
          </div>
        )}
        {st?.error && !error && <p className="text-[11.5px] text-muted-foreground">{st.error}</p>}
      </CardContent>
    </Card>
  );
}
