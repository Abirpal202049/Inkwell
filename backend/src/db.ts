import { PrismaClient, Prisma } from "@prisma/client";

export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside a transaction with `app.user_id` set via set_config,
 * so the RLS policies in prisma/rls.sql apply to every statement
 * (plan/06 §Tenant Isolation). All user-scoped DB work goes through this;
 * app-level WHERE clauses remain as defense in depth on top.
 */
export function withUserContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  });
}
