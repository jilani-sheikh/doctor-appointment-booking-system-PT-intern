import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

for (const name of ["DATABASE_URL", "DIRECT_URL"]) {
  console.log(`${name}: ${process.env[name]?.trim() ? "set" : "missing"}`);
}
