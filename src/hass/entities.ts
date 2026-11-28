import type { Layout } from "../config";

/** The attributes a phone gets (compact; everything else stays on the agent). */
const ATTR_KEYS = [
  // common
  "device_class", "supported_features", "battery_level", "source", "preset_mode", "preset_modes", "current_humidity", "humidity",
  // climate
  "hvac_action", "hvac_modes", "fan_mode", "fan_modes", "swing_mode", "swing_modes", "min_temp", "max_temp", "target_temp_step", "temperature", "temperature_unit", "current_temperature", "target_temp_high", "target_temp_low",
  // light
  "brightness", "color_mode", "supported_color_modes", "effect", "effect_list", "color_temp_kelvin", "min_color_temp_kelvin", "max_color_temp_kelvin", "hs_color", "rgb_color",
  // fan
  "percentage", "percentage_step", "oscillating", "direction",
  // cover
  "current_position", "current_tilt_position",
  // vacuum
  "status", "fan_speed", "fan_speed_list",
  // media
  "volume_level", "is_volume_muted", "media_title", "media_artist",
];

/** A select entity on the same HA device as a light (its scene/effect picker). */
export interface PhoneRelated { id: string; name: string; options: string[]; current: string | null }
export interface PhoneEntity { state: string; name: string; unit?: string; icon?: string; domain: string; attrs?: Record<string, unknown>; related?: PhoneRelated[] }

/** Domains whose temperatures are in Home Assistant's unit system and carry no unit of their own (climate has none). */
const SYSTEM_UNIT_DOMAINS = new Set(["climate", "water_heater", "weather"]);

/** `systemUnit` = HA's configured temperature unit (get_config); exposed as attrs.temperature_unit so the deck can convert. */
export function toPhoneEntity(id: string, state: string, attributes: Record<string, any> = {}, systemUnit?: string): PhoneEntity {
  const attrs: Record<string, unknown> = {};
  for (const k of ATTR_KEYS) if (attributes[k] !== undefined && attributes[k] !== null) attrs[k] = attributes[k];
  if (attrs.temperature_unit === undefined && systemUnit && SYSTEM_UNIT_DOMAINS.has(id.split(".")[0]!)) attrs.temperature_unit = systemUnit;
  return {
    state: String(state), name: String(attributes.friendly_name ?? id), domain: id.split(".")[0]!,
    ...(attributes.unit_of_measurement ? { unit: String(attributes.unit_of_measurement) } : {}),
    ...(attributes.icon ? { icon: String(attributes.icon) } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
  };
}

/**
 * The cameras whose picture a paired phone may ask for: those shown as an entity tile. A camera named only by a button,
 * a macro step, the weather or a rule is watched for its state, and its picture stays on this computer.
 */
export function cameraTiles(layout: Layout): Set<string> {
  const out = new Set<string>();
  for (const p of layout.pages) for (const it of p.items) {
    if (it.kind === "widget" && it.widget === "entity" && it.entity?.id.startsWith("camera.")) out.add(it.entity.id);
  }
  return out;
}

/** Entities the layout needs live: entity tiles, hass actions (buttons and macro steps) and hass-state rules. */
export function wantedEntities(layout: Layout): string[] {
  const out = new Set<string>();
  for (const p of layout.pages) for (const it of p.items) {
    if (it.kind === "widget" && it.widget === "entity" && it.entity?.id) out.add(it.entity.id);
    if (it.kind === "widget" && it.widget === "weather" && it.weather?.entity) out.add(it.weather.entity);
    if (it.kind === "widget" && it.widget === "clock" && it.clock?.style === "weather" && it.clock.weather?.entity) out.add(it.clock.weather.entity);
    if (it.kind === "button" && it.action) {
      if (it.action.type === "hass" && it.action.entityId) out.add(it.action.entityId);
      if (it.action.type === "macro") for (const st of it.action.steps) if (st.kind === "hass" && st.entityId) out.add(st.entityId);
    }
  }
  for (const r of layout.rules ?? []) if (r.when.kind === "hass-state") out.add(r.when.entityId);
  return [...out].sort();
}
