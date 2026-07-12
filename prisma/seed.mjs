// Run with: node prisma/seed.mjs  (requires DATABASE_URL in env or .env)
// Creates baseline data + demo dataset. Only runs on an EMPTY database.
import { PrismaClient } from "@prisma/client";
import { seedBaseline, seedDemo } from "../lib/seed-data.mjs";

const prisma = new PrismaClient();
const count = await prisma.role.count();
if (count > 0) {
  console.log("Database already has data — skipping seed.");
} else {
  const { roleIds } = await seedBaseline(prisma);
  const withDemo = process.argv.includes("--no-demo") ? false : true;
  if (withDemo) await seedDemo(prisma, roleIds);
  console.log("Seeded baseline" + (withDemo ? " + demo data" : "") + ".");
  console.log("Admin login:", process.env.ADMIN_USERNAME || "Pikajuz");
}
await prisma.$disconnect();
