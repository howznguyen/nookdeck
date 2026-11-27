import { describe, expect, test } from "bun:test";
import { awakeHintNeeded } from "../web/deck/src/screen-logic";
import { typedAddress } from "../web/manage/src/components/devices-panel";

const ANDROID = "Mozilla/5.0 (Linux; Android 8.1.0; SM-J710F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1";

describe("the keep-awake hint", () => {
  test("Android without a Wake Lock (a page on http) is told once how to keep the screen on", () => {
    expect(awakeHintNeeded(ANDROID, false, true, false)).toBe(true);
    expect(awakeHintNeeded(ANDROID, false, true, true)).toBe(false); // dismissed
    expect(awakeHintNeeded(ANDROID, true, true, false)).toBe(false); // the Wake Lock works (https)
    expect(awakeHintNeeded(ANDROID, false, false, false)).toBe(false); // the layout lets the screen sleep
  });
  test("iPhones keep the video trick: no hint", () => {
    expect(awakeHintNeeded(IPHONE, false, true, false)).toBe(false);
  });
});

describe("the address to type without a QR scanner", () => {
  test("host and port, no scheme, no PIN", () => {
    expect(typedAddress("http://192.168.1.10:7420/?pin=123456")).toBe("192.168.1.10:7420");
    expect(typedAddress("http://pc-phong.local:7420/?pin=1")).toBe("pc-phong.local:7420");
    expect(typedAddress("")).toBe("");
    expect(typedAddress("not a link")).toBe("");
  });
});
