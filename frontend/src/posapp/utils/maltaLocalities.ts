import directory from "../../../../posawesome/posawesome/api/malta_localities.json";

export const MALTA_CITIES = directory.localities.map((row) => row.value);
export function citySearchKey(value: unknown): string {
 return String(value || "").toLowerCase().replace(/ħ/g, "h").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
export function cityFilter(value: string, query: string): boolean {
 const extra = value.includes("Ir-Rabat (Għawdex)") ? " Victoria" : "";
 return citySearchKey(value + extra).includes(citySearchKey(query));
}
export function cityOptions(existing = ""): string[] {
 return existing && !MALTA_CITIES.includes(existing) ? [existing, ...MALTA_CITIES] : MALTA_CITIES;
}
export function validCity(value: string, country: string, original = ""): boolean {
 return country !== "Malta" || !value || MALTA_CITIES.includes(value) || (!!original && value === original);
}
export function customerDefaults(profile: Record<string, any> = {}, defaults: Record<string, any> = {}) {
 const country = profile.posa_default_country || "Malta";
 return {country, group: profile.posa_default_customer_group || (country === "Malta" ? "D365 B2C" : defaults.group || ""), territory: profile.posa_default_territory || (country === "Malta" ? "Malta" : defaults.territory || "")};
}
