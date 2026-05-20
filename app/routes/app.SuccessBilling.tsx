import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { CheckCircle2 } from "lucide-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  ensurePlans,
  fetchActiveSubscription,
  getOrCreateUser,
} from "~/lib/billing.server";

import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";

type LoaderData = {
  ok: boolean;
  chargeName: string | null;
  chargeStatus: string | null;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const url = new URL(request.url);
  const chargeId = url.searchParams.get("charge_id");

  await ensurePlans();
  const user = await getOrCreateUser(shop);

  if (!chargeId) {
    return { ok: false, chargeName: null, chargeStatus: null };
  }

  const subscription = await fetchActiveSubscription(
    shop,
    session.accessToken ?? "",
    chargeId,
  );

  if (!subscription) {
    return { ok: false, chargeName: null, chargeStatus: null };
  }

  const matchingPlan = await prisma.plan.findFirst({
    where: { OR: [{ title: subscription.name }, { name: subscription.name }] },
  });

  await prisma.charge.upsert({
    where: { id: chargeId },
    update: {
      status: subscription.status,
      price: subscription.price,
      planId: matchingPlan?.id ?? null,
    },
    create: {
      id: chargeId,
      shop,
      chargeId,
      name: subscription.name,
      price: subscription.price,
      status: subscription.status,
      activatedOn: subscription.createdAt ?? null,
      trialDays: subscription.trialDays
        ? String(subscription.trialDays)
        : null,
      cancelledOn: subscription.cancelledOn ?? null,
      billingOn: subscription.createdAt ?? null,
      planId: matchingPlan?.id ?? null,
    },
  });

  if (subscription.status === "active") {
    await prisma.appUser.update({
      where: { id: user.id },
      data: {
        chargeId,
        planId: matchingPlan?.id ?? user.planId,
        modelLimit: matchingPlan?.modelLimit ?? user.modelLimit,
      },
    });
  }

  return {
    ok: true,
    chargeName: subscription.name,
    chargeStatus: subscription.status,
  };
};

export default function SuccessBilling() {
  const { ok, chargeName, chargeStatus } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 flex flex-col items-center text-center gap-4">
          <CheckCircle2 className="size-12 text-green-600" />
          <h2 className="text-2xl font-semibold tracking-tight">
            {ok && chargeStatus === "active"
              ? "Subscription Activated"
              : ok
                ? "Subscription Updated"
                : "Subscription Pending"}
          </h2>
          {chargeName && (
            <p className="text-sm text-muted-foreground">
              {chargeName} plan · status: {chargeStatus}
            </p>
          )}
          {!ok && (
            <p className="text-sm text-muted-foreground">
              We couldn&rsquo;t confirm the charge. If you completed payment in
              Shopify, refresh the pricing page or contact support.
            </p>
          )}
          <Button asChild className="mt-2">
            <Link to="/app">Go to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
