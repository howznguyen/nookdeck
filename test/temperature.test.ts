import { describe, expect, test } from "bun:test";
import { convertTemp, convertTemp1, tempUnitOf } from "../src/temperature";
import { planControl } from "../src/hass/control";
import { toPhoneEntity } from "../src/hass/entities";
import { WeatherService, parseHassWeather } from "../src/weather";

const climate = (attrs: Record<string, any> = {}) => ({ state: "cool", attributes: { hvac_modes: ["cool"], min_temp: 16, max_temp: 30, target_temp_step: 1, ...attrs } });

describe("units", () => {
  test("c -> f, f -> c, names", () => {
    expect(convertTemp(0, "c", "f")).toBe(32);
    expect(convertTemp(100, "c", "f")).toBe(212);
    expect(convertTemp(212, "f", "c")).toBe(100);
    expect(convertTemp1(25, "c", "f")).toBe(77);
    expect(convertTemp1(77.9, "f", "c")).toBe(25.5);
    expect(convertTemp(5, "c", "c")).toBe(5);
    expect(tempUnitOf("°F")).toBe("f");
    expect(tempUnitOf("°C")).toBe("c");
    expect(tempUnitOf("kelvin")).toBeUndefined();
  });
});

describe("weather follows the unit", () => {
  const svcFor = (attrs: any, urls: string[] = []) => new WeatherService({
    fetch: async (u) => { if (!u.includes("air-quality")) urls.push(u); return Response.json({ current: { time: "2026-11-17T10:00", temperature_2m: 77, weather_code: 0 }, hourly: { time: [], temperature_2m: [], weather_code: [] }, daily: { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [] } }); },
    hass: () => ({ connected: () => true, getState: () => undefined, callService: async () => {}, weather: async () => ({ state: "sunny", attributes: attrs, hourly: [{ datetime: "t", temperature: 20, condition: "sunny" }], daily: [{ datetime: "2026-11-17", temperature: 30, templow: 10, condition: "sunny" }] }) }),
  });
  test("HA in C shown as F (now, feels, hourly, daily), and HA in F shown as C", async () => {
    const f = await svcFor({ temperature: 30, apparent_temperature: 35, temperature_unit: "°C" }).get({ entity: "weather.h" }, false, "f");
    expect(f.tempUnit).toBe("f");
    expect(f.now).toMatchObject({ temp: 86, feels: 95 });
    expect(f.hourly[0]!.temp).toBe(68);
    expect(f.daily[0]).toMatchObject({ max: 86, min: 50 });
    const c = await svcFor({ temperature: 86, temperature_unit: "°F" }).get({ entity: "weather.h" }, false, "c");
    expect(c.tempUnit).toBe("c");
    expect(c.now.temp).toBe(30);
    expect(c.hourly[0]!.temp).toBe(-7); // 20 F
    expect(parseHassWeather({ state: "sunny", attributes: { temperature: 30, temperature_unit: "°C" } }, { location: "x", now: 1 }).now.temp).toBe(30); // no target: native
  });
  test("a tile's own units beat the theme; Open-Meteo is asked in the right unit", async () => {
    const urls: string[] = [];
    const s = svcFor({}, urls);
    const loc = { name: "x", lat: 1, lon: 2 };
    expect((await s.get({ location: loc, source: "open-meteo" }, false, "f")).tempUnit).toBe("f");
    expect(urls[0]).toContain("temperature_unit=fahrenheit");
    expect(urls[0]).not.toContain("wind_speed_unit");
    expect((await s.get({ location: loc, source: "open-meteo", units: "metric" }, false, "f")).tempUnit).toBe("c");
    expect(urls[1]).not.toContain("temperature_unit");
    expect((await s.get({ location: loc, source: "open-meteo" }, false, "c")).tempUnit).toBe("c");
    expect((await s.get({ location: loc, source: "open-meteo", units: "imperial" }, false, "c")).tempUnit).toBe("f");
    expect(urls[urls.length - 1]).toContain("wind_speed_unit=mph");
  });
});

describe("entities carry their unit", () => {
  test("climate/weather get HA's system unit when they have none; sensors keep their own", () => {
    expect(toPhoneEntity("climate.ac", "cool", { temperature: 24 }, "°F").attrs?.temperature_unit).toBe("°F");
    expect(toPhoneEntity("weather.h", "sunny", { temperature: 24, temperature_unit: "°C" }, "°F").attrs?.temperature_unit).toBe("°C");
    expect(toPhoneEntity("sensor.t", "21", { unit_of_measurement: "°C" }, "°F")).toMatchObject({ unit: "°C" });
    expect(toPhoneEntity("sensor.t", "21", { unit_of_measurement: "°C" }, "°F").attrs?.temperature_unit).toBeUndefined();
  });
});

describe("climate set_temperature sends the DEVICE's unit", () => {
  const temp = (st: any, v: number, units: any) => { const p = planControl("climate.ac", st, "set_temperature", v, units) as any; return p.error ?? p.data.temperature; };
  test("display F onto a C device, display C onto an F device, same unit untouched", () => {
    expect(temp(climate(), 77, { valueUnit: "f", deviceUnit: "c" })).toBe(25);
    expect(temp(climate({ temperature_unit: "°C" }), 77, { valueUnit: "f", deviceUnit: "f" })).toBe(25); // the entity's own unit beats the system one
    expect(temp(climate({ min_temp: 60, max_temp: 86, target_temp_step: 1, temperature_unit: "°F" }), 25, { valueUnit: "c", deviceUnit: "f" })).toBe(77);
    expect(temp(climate(), 24, { valueUnit: "c", deviceUnit: "c" })).toBe(24);
    expect(temp(climate(), 24, {})).toBe(24); // an older phone: no conversion
  });
  test("round trip: device F, shown in C, +1 step on the display, comes back as a valid F value", () => {
    const st = climate({ min_temp: 60, max_temp: 86, target_temp_step: 1, temperature_unit: "°F", temperature: 72 });
    const shown = convertTemp1(72, "f", "c"); // 22.2
    const next = shown + 0.5;
    const sent = temp(st, next, { valueUnit: "c" });
    expect(sent).toBe(73); // 22.7 C -> 72.9 F -> snapped to the device step
    expect(temp(st, convertTemp1(60, "f", "c") - 1, { valueUnit: "c" })).toContain("between"); // below the device's minimum
  });
});

describe("light scene and effect", () => {
  const lamp = { state: "on", attributes: { supported_color_modes: ["color_temp", "hs"], effect_list: ["rainbow", "pulse"] } };
  const related = [{ id: "select.3d_lamp_scene", name: "3D lamp Scene", options: ["night", "reading"] }];
  test("scene -> select.select_option on the related select; effect -> light.turn_on {effect}", () => {
    expect(planControl("light.3d_lamp", lamp, "scene", "reading", { related })).toEqual({ service: "select.select_option", entityId: "select.3d_lamp_scene", data: { option: "reading" } });
    expect(planControl("light.3d_lamp", lamp, "set_scene", "night", { related })).toMatchObject({ entityId: "select.3d_lamp_scene" });
    expect(planControl("light.3d_lamp", lamp, "effect", "pulse")).toEqual({ service: "light.turn_on", data: { effect: "pulse" } });
  });
  test("unknown scene/effect, a light without a scene picker, several selects without a scene one are refused", () => {
    expect((planControl("light.x", lamp, "scene", "party", { related }) as any).error).toContain("not supported");
    expect((planControl("light.x", lamp, "scene", "night") as any).error).toBeTruthy();
    expect((planControl("light.x", lamp, "effect", "disco") as any).error).toContain("not supported");
    const two = [{ id: "select.a_mode", options: ["x"] }, { id: "select.a_fan", options: ["y"] }];
    expect((planControl("light.x", lamp, "scene", "x", { related: two }) as any).error).toBeTruthy();
    expect(planControl("light.x", lamp, "scene", "x", { related: [{ id: "select.only", options: ["x"] }] })).toMatchObject({ entityId: "select.only" });
  });
});
