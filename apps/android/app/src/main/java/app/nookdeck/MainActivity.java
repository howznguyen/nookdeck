package app.nookdeck;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebResourceError;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The Nookdeck app: the deck the agent serves, full screen, with the screen kept on.
 *
 * Set up over USB, the agent starts it with extras: token (the device token), usb (http://localhost:<port>, which `adb reverse`
 * forwards to the computer through the cable), lan (http://<LAN address>:<port>, comma separated) and name (the computer). The app
 * tries the cable first, then the Wi-Fi addresses, and passes the token in the address (#token=) so the deck needs no PIN.
 * Installed by hand, it looks for computers on the Wi-Fi (GET /api/hello on every address of the /24) and the deck asks for the PIN.
 *
 * Only deck pages of the chosen computer load in the app; /manage never does; other links open in the phone's browser.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "nookdeck";
    private static final int DEFAULT_PORT = 7420;
    private static final int PROBE_MS = 1500;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newCachedThreadPool();
    private SharedPreferences prefs;
    private WebView web;
    private LinearLayout panel;
    /** the base address the WebView shows now, like http://localhost:7420 */
    private String current;
    private int attempt;
    private boolean paused;
    /** the attempt whose "no computer found" screen is up (the health check retries quietly from it), else 0 */
    private int waiting;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        takeExtras(getIntent());

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " NookdeckApp/" + appVersion());
        web.setWebViewClient(new Client());
        web.addJavascriptInterface(new Bridge(), "NookdeckApp");
        orient(prefs.getString("orientation", "auto"));
        setContentView(web);
        immersive();
        connect();
        main.postDelayed(health, 10_000);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // set up again over USB while the app runs: new token and addresses
        if (takeExtras(intent)) connect();
    }

    @Override
    protected void onResume() {
        super.onResume();
        paused = false;
        immersive();
        web.onResume();
    }

    @Override
    protected void onPause() {
        paused = true;
        web.onPause();
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    public void onBackPressed() {
        // the deck has no back stack worth walking; leave the app in the background instead of closing the deck
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(health);
        io.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ setup data

    private boolean takeExtras(Intent intent) {
        if (intent == null) return false;
        String token = intent.getStringExtra("token");
        if (token == null || !token.matches("[0-9a-f]{64}")) return false;
        SharedPreferences.Editor e = prefs.edit();
        e.putString("token", token);
        e.putString("usb", clean(intent.getStringExtra("usb")));
        e.putString("lan", clean(intent.getStringExtra("lan")));
        e.putString("name", clean(intent.getStringExtra("name")));
        e.putString("computer", clean(intent.getStringExtra("computer")).replaceAll("[^0-9a-f]", ""));
        e.apply();
        return true;
    }

    private static String clean(String v) {
        return v == null ? "" : v.trim();
    }

    /** The addresses to try, in order: the cable, the saved Wi-Fi ones, the last one that worked. */
    private List<String> candidates() {
        List<String> out = new ArrayList<>();
        add(out, prefs.getString("usb", ""));
        for (String l : prefs.getString("lan", "").split(",")) add(out, l);
        add(out, prefs.getString("last", ""));
        return out;
    }

    private static void add(List<String> out, String base) {
        String b = normalize(base);
        if (b != null && !out.contains(b)) out.add(b);
    }

    /** "192.168.1.10:7420", "http://192.168.1.10:7420/" -> "http://192.168.1.10:7420"; null when it is not an http address. */
    static String normalize(String v) {
        if (v == null) return null;
        String s = v.trim();
        if (s.isEmpty()) return null;
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://" + s;
        Uri u = Uri.parse(s);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        int port = u.getPort() > 0 ? u.getPort() : DEFAULT_PORT;
        return u.getScheme() + "://" + u.getHost() + ":" + port;
    }

    // ------------------------------------------------------------------ connecting

    private void connect() {
        final int mine = ++attempt;
        current = null;
        showStatus(getString(R.string.connecting), true);
        final List<String> list = candidates();
        io.execute(new Runnable() {
            @Override
            public void run() {
                for (String base : list) {
                    if (mine != attempt) return;
                    if (ours(helloInfo(base))) {
                        final String b = base;
                        main.post(new Runnable() { @Override public void run() { if (mine == attempt) open(b); } });
                        return;
                    }
                }
                main.post(new Runnable() { @Override public void run() { if (mine == attempt) discover(); } });
            }
        });
    }

    /** GET <base>/api/hello: the computer's name when it is a Nookdeck, else null. */
    static String hello(String base) {
        JSONObject j = helloInfo(base);
        return j == null ? null : j.optString("name", "");
    }

    /**
     * The computer this app was set up from (its id came with the setup), or any Nookdeck when the app was never set up over USB:
     * so the app reconnects to its own computer and not to another Nookdeck it finds on the same Wi-Fi.
     */
    private boolean ours(JSONObject j) {
        if (j == null) return false;
        String want = prefs.getString("computer", "");
        String id = j.optString("id", "");
        return want.isEmpty() || id.isEmpty() || want.equals(id);
    }

    /** GET <base>/api/hello: {app, name, version, id} when it is a Nookdeck, else null. */
    static JSONObject helloInfo(String base) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/api/hello").openConnection();
            c.setConnectTimeout(PROBE_MS);
            c.setReadTimeout(PROBE_MS);
            c.setUseCaches(false);
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[1024];
            int n;
            while ((n = in.read(b)) > 0 && buf.size() < 4096) buf.write(b, 0, n);
            JSONObject j = new JSONObject(buf.toString("UTF-8"));
            if (!"nookdeck".equals(j.optString("app"))) return null;
            return j;
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void open(String base) {
        current = base;
        waiting = 0;
        prefs.edit().putString("last", base).apply();
        String token = prefs.getString("token", "");
        String url = base + "/" + (token.isEmpty() ? "" : "#token=" + token);
        if (panel != null) {
            setContentView(web);
            panel = null;
            immersive();
        }
        web.loadUrl(url);
    }

    /**
     * What the deck page may ask of the app. Only the orientation: the deck knows the layout's orientation (theme.orientation) and
     * asks for it here, so Android turns the screen instead of the deck rotating itself in CSS.
     */
    private class Bridge {
        @JavascriptInterface
        public void setOrientation(final String o) {
            main.post(new Runnable() { @Override public void run() { orient(o); } });
        }
    }

    /** "landscape", "portrait" or anything else for the phone's own setting; remembered so the next start opens the same way */
    private void orient(String o) {
        int want = "landscape".equals(o) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            : "portrait".equals(o) ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        String keep = want == ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED ? "auto" : o;
        if (!keep.equals(prefs.getString("orientation", "auto"))) prefs.edit().putString("orientation", keep).apply();
        if (getRequestedOrientation() != want) setRequestedOrientation(want);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return route(Uri.parse(url));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return route(req.getUrl());
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            super.onPageStarted(view, url, favicon);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int code, String description, String failingUrl) {
            if (failingUrl != null && current != null && failingUrl.startsWith(current)) lost();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (Build.VERSION.SDK_INT >= 21 && req.isForMainFrame()) lost();
        }
    }

    /** The deck's own pages stay; /manage and every other site go to the phone's browser (or nowhere). */
    private boolean route(Uri u) {
        // while reconnecting `current` is empty, and the deck may reload itself then: an address of this computer (the cable, a saved
        // Wi-Fi one, the last one) is still the deck, so it stays here instead of opening the phone's browser without the token
        String origin = u.getHost() == null ? null : normalize(u.getScheme() + "://" + u.getHost() + ":" + portOf(u));
        boolean same = origin != null && (origin.equals(current) || candidates().contains(origin));
        String path = u.getPath() == null ? "/" : u.getPath();
        if (same && !path.startsWith("/manage")) return false;
        if (!same && ("http".equals(u.getScheme()) || "https".equals(u.getScheme()))) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* no browser */ }
        }
        return true;
    }

    private static int portOf(Uri u) {
        return u.getPort() > 0 ? u.getPort() : ("https".equals(u.getScheme()) ? 443 : 80);
    }

    /** The page could not load (cable pulled, Wi-Fi changed, agent restarting): try every address again shortly. */
    private void lost() {
        current = null;
        main.postDelayed(new Runnable() { @Override public void run() { connect(); } }, 2500);
    }

    /**
     * The page stays up when its computer goes away (the deck keeps retrying its socket), so check the address every 10 s: when it
     * stops answering (cable pulled), look again through every address, which falls back to the Wi-Fi.
     */
    private final Runnable health = new Runnable() {
        @Override
        public void run() {
            final String base = current;
            final int mine = attempt;
            final String usb = normalize(prefs.getString("usb", ""));
            if (base != null && !paused) {
                io.execute(new Runnable() {
                    @Override
                    public void run() {
                        // on the Wi-Fi while the cable works again (plugged back in): go back to the cable
                        if (usb != null && !usb.equals(base) && ours(helloInfo(usb))) {
                            main.post(new Runnable() { @Override public void run() { if (mine == attempt && base.equals(current)) open(usb); } });
                            return;
                        }
                        if (hello(base) == null && hello(base) == null) {
                            main.post(new Runnable() { @Override public void run() { if (mine == attempt && base.equals(current)) connect(); } });
                        }
                    }
                });
            } else if (base == null && !paused && waiting == mine) {
                // the "no computer found" screen: keep trying the known addresses, so plugging the cable back in is enough
                final List<String> list = candidates();
                io.execute(new Runnable() {
                    @Override
                    public void run() {
                        for (final String b : list) {
                            if (mine != attempt) return;
                            if (ours(helloInfo(b))) {
                                main.post(new Runnable() { @Override public void run() { if (mine == attempt && current == null) open(b); } });
                                return;
                            }
                        }
                    }
                });
            }
            main.postDelayed(this, 5_000);
        }
    };

    // ------------------------------------------------------------------ finding a computer on the Wi-Fi

    private void discover() {
        final int mine = attempt;
        final String own = wifiAddress();
        showStatus(getString(R.string.searching), true);
        if (own == null) { showFound(new ArrayList<String[]>(), mine); return; }
        io.execute(new Runnable() {
            @Override
            public void run() {
                final List<String[]> found = Collections.synchronizedList(new ArrayList<String[]>());
                String prefix = own.substring(0, own.lastIndexOf('.') + 1);
                ExecutorService pool = Executors.newFixedThreadPool(32);
                for (int i = 1; i < 255; i++) {
                    final String base = "http://" + prefix + i + ":" + DEFAULT_PORT;
                    pool.execute(new Runnable() {
                        @Override
                        public void run() {
                            JSONObject j = helloInfo(base);
                            if (j != null) found.add(new String[] { base, j.optString("name", ""), j.optString("id", "") });
                        }
                    });
                }
                pool.shutdown();
                try { pool.awaitTermination(20, TimeUnit.SECONDS); } catch (InterruptedException e) { return; }
                // the computer this app was set up from, found at a new address: open it without asking
                String want = prefs.getString("computer", "");
                for (final String[] f : found) {
                    if (!want.isEmpty() && want.equals(f[2])) {
                        main.post(new Runnable() { @Override public void run() { if (mine == attempt) { remember(f[0]); open(f[0]); } } });
                        return;
                    }
                }
                main.post(new Runnable() { @Override public void run() { if (mine == attempt) showFound(found, mine); } });
            }
        });
    }

    @SuppressWarnings("deprecation")
    private String wifiAddress() {
        try {
            WifiManager w = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            int ip = w.getConnectionInfo().getIpAddress();
            if (ip == 0) return null;
            return (ip & 0xff) + "." + (ip >> 8 & 0xff) + "." + (ip >> 16 & 0xff) + "." + (ip >> 24 & 0xff);
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ the native screens (before the deck loads)

    // the deck's colours (web/deck: dark card, cyan primary), so the app's own screens look like the deck around them
    private static final int BG = Color.rgb(12, 12, 14);
    private static final int CARD = Color.rgb(24, 24, 27);
    private static final int LINE = Color.rgb(42, 42, 48);
    private static final int FIELD = Color.rgb(10, 10, 12);
    private static final int TEXT = Color.rgb(244, 244, 245);
    private static final int MUTED = Color.rgb(161, 161, 170);
    private static final int CYAN = Color.rgb(34, 211, 238);
    private static final int ON_CYAN = Color.rgb(8, 47, 56);

    private GradientDrawable shape(int fill, int stroke, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(fill);
        g.setCornerRadius(dp(radiusDp));
        if (stroke != 0) g.setStroke(dp(1), stroke);
        return g;
    }

    /** A centred card (at most 440 dp wide) on the deck's background; the screens fill it. */
    private LinearLayout newPanel() {
        LinearLayout p = new LinearLayout(this);
        p.setOrientation(LinearLayout.VERTICAL);
        p.setGravity(Gravity.CENTER_HORIZONTAL);
        p.setBackground(shape(CARD, LINE, 24));
        int pad = dp(24);
        p.setPadding(pad, dp(28), pad, pad);
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.mipmap.ic_launcher);
        p.addView(icon, new LinearLayout.LayoutParams(dp(56), dp(56)));
        TextView title = text(getString(R.string.app_name), 22, false);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setPadding(0, dp(10), 0, dp(2));
        p.addView(title);
        return p;
    }

    private void show(LinearLayout p) {
        FrameLayout outer = new FrameLayout(this);
        int side = dp(16);
        outer.setPadding(side, dp(24), side, dp(24));
        int w = Math.min(getResources().getDisplayMetrics().widthPixels - 2 * side, dp(440));
        outer.addView(p, new FrameLayout.LayoutParams(w, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(BG);
        sv.setFillViewport(true);
        sv.addView(outer, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        panel = p;
        setContentView(sv);
        immersive();
    }

    private TextView text(String s, int sp, boolean muted) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(muted ? MUTED : TEXT);
        t.setGravity(Gravity.CENTER);
        t.setLineSpacing(0, 1.15f);
        t.setPadding(0, dp(6), 0, dp(6));
        return t;
    }

    private Button button(String label, boolean primary, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(primary ? ON_CYAN : TEXT);
        b.setBackground(shape(primary ? CYAN : CARD, primary ? 0 : LINE, 14));
        b.setStateListAnimator(null);
        b.setMinHeight(dp(52));
        b.setOnClickListener(click);
        return b;
    }

    private void showStatus(String msg, boolean spinner) {
        LinearLayout p = newPanel();
        if (spinner) {
            ProgressBar pb = new ProgressBar(this);
            if (Build.VERSION.SDK_INT >= 21) pb.setIndeterminateTintList(ColorStateList.valueOf(CYAN));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(36), dp(36));
            lp.topMargin = dp(16);
            lp.bottomMargin = dp(4);
            p.addView(pb, lp);
        }
        p.addView(text(msg, 15, true));
        show(p);
    }

    private void showFound(List<String[]> found, final int mine) {
        waiting = mine;
        LinearLayout p = newPanel();
        p.addView(text(found.isEmpty() ? getString(R.string.none_found) : getString(R.string.found), 15, true));
        for (final String[] f : found) {
            // one row per computer: its name, and the address under it
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.VERTICAL);
            row.setBackground(shape(FIELD, LINE, 14));
            row.setPadding(dp(16), dp(12), dp(16), dp(12));
            row.setClickable(true);
            TextView name = text(f[1].isEmpty() ? f[0].replace("http://", "") : f[1], 16, false);
            name.setGravity(Gravity.START);
            name.setTypeface(Typeface.DEFAULT_BOLD);
            name.setPadding(0, 0, 0, 0);
            row.addView(name);
            if (!f[1].isEmpty()) {
                TextView where = text(f[0].replace("http://", ""), 13, true);
                where.setGravity(Gravity.START);
                where.setPadding(0, dp(2), 0, 0);
                row.addView(where);
            }
            row.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) { remember(f[0]); open(f[0]); }
            });
            p.addView(row, wide());
        }
        final EditText addr = new EditText(this);
        addr.setHint(getString(R.string.address_hint));
        addr.setHintTextColor(Color.rgb(113, 113, 122));
        addr.setTextColor(TEXT);
        addr.setTextSize(16);
        addr.setSingleLine(true);
        addr.setBackground(shape(FIELD, LINE, 14));
        addr.setPadding(dp(16), 0, dp(16), 0);
        addr.setMinHeight(dp(52));
        addr.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        addr.setImeOptions(EditorInfo.IME_ACTION_GO);
        LinearLayout.LayoutParams first = wide();
        first.topMargin = dp(16);
        p.addView(addr, first);
        p.addView(button(getString(R.string.open), true, new View.OnClickListener() {
            @Override public void onClick(View v) { tryAddress(addr.getText().toString()); }
        }), wide());
        p.addView(button(getString(R.string.retry), false, new View.OnClickListener() {
            @Override public void onClick(View v) { connect(); }
        }), wide());
        View rule = new View(this);
        rule.setBackgroundColor(LINE);
        LinearLayout.LayoutParams rl = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        rl.topMargin = dp(18);
        rl.bottomMargin = dp(6);
        p.addView(rule, rl);
        p.addView(text(getString(R.string.usb_tip), 13, true));
        p.addView(text(getString(R.string.auto_retry), 12, true));
        show(p);
    }

    private void tryAddress(String typed) {
        final String base = normalize(typed);
        if (base == null) return;
        final int mine = ++attempt;
        showStatus(getString(R.string.connecting), true);
        io.execute(new Runnable() {
            @Override
            public void run() {
                final boolean ok = hello(base) != null;
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (mine != attempt) return;
                        if (ok) { remember(base); open(base); } else { showStatus(getString(R.string.bad_address), false); main.postDelayed(new Runnable() { @Override public void run() { if (mine == attempt) discover(); } }, 2500); }
                    }
                });
            }
        });
    }

    /** A computer picked by hand: it joins the addresses tried on every start (no token: the deck keeps its own after the PIN). */
    private void remember(String base) {
        String lan = prefs.getString("lan", "");
        if (!("," + lan + ",").contains("," + base + ",")) prefs.edit().putString("lan", lan.isEmpty() ? base : lan + "," + base).apply();
    }

    private LinearLayout.LayoutParams wide() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        return lp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        View d = getWindow().getDecorView();
        d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "0";
        }
    }
}
