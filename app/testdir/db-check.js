import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const plans = await prisma.plans.findMany();
  console.log(JSON.stringify(plans, null, 2));
}
run();
