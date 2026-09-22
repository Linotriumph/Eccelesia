const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const col = await p.$queryRawUnsafe(
    "SELECT column_name FROM information_schema.columns WHERE table_name='User' AND column_name='emailVerified'"
  );
  const tbl = await p.$queryRawUnsafe(
    "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_name='EmailVerification'"
  );
  console.log("emailVerified column:", col.length ? "EXISTS" : "MISSING");
  console.log("EmailVerification table:", Number(tbl[0].c) ? "EXISTS" : "MISSING");
  const users = await p.user.findMany({ select: { id: true, email: true, emailVerified: true } });
  console.log("users:", JSON.stringify(users));
  await p.$disconnect();
})().catch(async (e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
