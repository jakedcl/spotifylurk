import fs from "fs";
import path from "path";

function apply(file: string, locked: Set<string>, override: boolean) {
  const full = path.join(process.cwd(), file);
  if (!fs.existsSync(full)) return;
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (locked.has(key)) continue;
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}

export function loadEnv() {
  const locked = new Set(Object.keys(process.env));
  apply(".env", locked, false);
  apply(".env.local", locked, true);
}
