import dns from "node:dns/promises";

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(email) {
  return emailRegex.test(String(email || "").toLowerCase());
}

export async function hasMxRecord(email) {
  try {
    const domain = String(email || "").split("@")[1];
    if (!domain) return false;
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
}

export function isValidUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
