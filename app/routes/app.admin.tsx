import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useState, useMemo } from "react";
import {
  useActionData,
  useLoaderData,
  useRouteError,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  checkAdminAuth,
  createAdminCookieHeader,
  clearAdminCookieHeader,
  verifyAdminPassword,
} from "~/lib/admin-auth.server";
import { getPlans } from "~/lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const isAuthorized = checkAdminAuth(request, shop);

  if (!isAuthorized) {
    return {
      authorized: false,
      shop,
      metrics: null,
      coupons: [],
      stores: [],
      events: [],
      plans: [],
    };
  }

  // Fetch all necessary data for the admin dashboard in parallel
  const [users, coupons, events, charges, plans, modelCountsByShop] =
    await Promise.all([
      prisma.appUser.findMany({
        orderBy: { createdAt: "desc" },
      }),
      (prisma as any).coupon
        ? (prisma as any).coupon.findMany({
            include: {
              redemptions: {
                orderBy: { redeemedAt: "desc" },
              },
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      (prisma as any).appStoreEvent
        ? (prisma as any).appStoreEvent.findMany({
            orderBy: { createdAt: "desc" },
            take: 100,
          })
        : Promise.resolve([]),
      prisma.charge.findMany({
        orderBy: { createdAt: "desc" },
      }),
      getPlans(),
      prisma.model3D.groupBy({
        by: ["shop"],
        _count: { _all: true },
      }),
    ]);

  const modelCountsMap = new Map<string, number>();
  for (const m of modelCountsByShop) {
    modelCountsMap.set(m.shop, m._count._all);
  }

  // Map charges by shop to get active subscription info
  const activeChargesByShop = new Map<string, (typeof charges)[0]>();
  for (const c of charges) {
    if (c.status === "active" && !activeChargesByShop.has(c.shop)) {
      activeChargesByShop.set(c.shop, c);
    }
  }

  // Compute metrics
  const totalStores = users.length;
  const activeStores = users.filter((u) => u.isInstalled !== false);
  const uninstalledStores = users.filter((u) => u.isInstalled === false);
  const payingStores = Array.from(activeChargesByShop.values()).filter(
    (c) => Number(c.price || 0) > 0,
  );
  const mrr = payingStores.reduce((sum, c) => sum + Number(c.price || 0), 0);
  const totalModels = Array.from(modelCountsMap.values()).reduce(
    (a, b) => a + b,
    0,
  );
  const totalRedemptions = coupons.reduce((sum, c) => sum + c.usageCount, 0);

  // Format stores
  const formattedStores = users.map((u) => {
    const activeCharge = activeChargesByShop.get(u.shop);
    const plan =
      plans.find((p) => p.id === u.planId || p.id === activeCharge?.planId) ??
      null;
    return {
      id: u.id,
      shop: u.shop,
      isInstalled: u.isInstalled !== false,
      installedAt: u.installedAt ? u.installedAt.toISOString() : u.createdAt.toISOString(),
      uninstalledAt: u.uninstalledAt ? u.uninstalledAt.toISOString() : null,
      planName: plan?.title ?? plan?.name ?? (activeCharge ? activeCharge.name : "Free"),
      price: activeCharge?.price ?? "0.00",
      subscriptionStatus: activeCharge?.status ?? "none",
      modelCount: modelCountsMap.get(u.shop) ?? 0,
      modelLimit: u.modelLimit,
      productLimit: u.productLimit,
      planSelectedAt: u.planSelectedAt ? u.planSelectedAt.toISOString() : null,
    };
  });

  return {
    authorized: true,
    shop,
    metrics: {
      totalStores,
      activeStoresCount: activeStores.length,
      uninstalledStoresCount: uninstalledStores.length,
      payingStoresCount: payingStores.length,
      mrr,
      totalModels,
      totalRedemptions,
    },
    coupons: coupons.map((c) => ({
      id: c.id,
      code: c.code,
      description: c.description,
      percentage: c.percentage,
      discountLabel: `${Math.round(c.percentage * 100)}%`,
      durationLimitInIntervals: c.durationLimitInIntervals,
      durationLabel:
        c.durationLimitInIntervals === null || c.durationLimitInIntervals === undefined
          ? "Lifetime"
          : `${c.durationLimitInIntervals} mo`,
      startsAt: c.startsAt ? c.startsAt.toISOString() : null,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      autoApply: c.autoApply,
      active: c.active,
      usageLimit: c.usageLimit,
      usageCount: c.usageCount,
      applicablePlans: c.applicablePlans,
      showBanner: c.showBanner ?? false,
      bannerHeading: c.bannerHeading ?? "",
      bannerText: c.bannerText ?? "",
      bannerTone: c.bannerTone ?? "success",
      bannerPlacements: c.bannerPlacements ?? ["pricing", "dashboard"],
      bannerDismissible: c.bannerDismissible !== false,
      bannerButtonText: c.bannerButtonText ?? "",
      createdAt: c.createdAt.toISOString(),
      redemptions: c.redemptions.map((r) => ({
        id: r.id,
        shop: r.shop,
        planName: r.planName,
        discountPct: r.discountPct,
        redeemedAt: r.redeemedAt.toISOString(),
      })),
    })),
    stores: formattedStores,
    events: events.map((e) => ({
      id: e.id,
      shop: e.shop,
      type: e.type,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    })),
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      title: p.title,
      price: p.price,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Authentication unlock intent
  if (intent === "unlock") {
    const passcode = String(form.get("passcode") ?? "");
    const check = verifyAdminPassword(request, passcode);
    if (check.ok) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": createAdminCookieHeader(),
        },
      });
    }
    return { ok: false, error: check.error };
  }

  // Logout intent
  if (intent === "lock") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearAdminCookieHeader(),
      },
    });
  }

  // Verify authorization for all management mutations
  const isAuthorized = checkAdminAuth(request, shop);
  if (!isAuthorized) {
    return { ok: false, error: "Unauthorized operation." };
  }

  if (intent === "create_coupon") {
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    const description = String(form.get("description") ?? "").trim();
    const percentInput = Number(form.get("percentage") ?? 0);
    const percentage = percentInput > 1 ? percentInput / 100 : percentInput;
    const durationInput = form.get("duration");
    const durationLimitInIntervals =
      durationInput && durationInput !== "lifetime"
        ? parseInt(String(durationInput), 10)
        : null;

    const startsAtStr = String(form.get("startsAt") ?? "");
    const expiresAtStr = String(form.get("expiresAt") ?? "");
    const startsAt = startsAtStr ? new Date(startsAtStr) : null;
    const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null;

    const autoApply = form.get("autoApply") === "true" || form.get("autoApply") === "on";
    const usageLimitStr = String(form.get("usageLimit") ?? "").trim();
    const usageLimit = usageLimitStr ? parseInt(usageLimitStr, 10) : null;

    const applicablePlans = form
      .getAll("applicablePlans")
      .map(String)
      .filter(Boolean);

    const showBanner = form.get("showBanner") === "true" || form.get("showBanner") === "on";
    const bannerHeading = String(form.get("bannerHeading") ?? "").trim() || null;
    const bannerText = String(form.get("bannerText") ?? "").trim() || null;
    const bannerTone = String(form.get("bannerTone") ?? "success");
    const bannerPlacements = form.getAll("bannerPlacements").map(String).filter(Boolean);
    const bannerDismissible = form.get("bannerDismissible") !== "false" && form.get("bannerDismissible") !== "off";
    const bannerButtonText = String(form.get("bannerButtonText") ?? "").trim() || null;

    if (!code) {
      return { ok: false, error: "Coupon code is required." };
    }
    if (percentage <= 0 || percentage > 1) {
      return { ok: false, error: "Percentage discount must be between 1% and 100%." };
    }

    try {
      await prisma.coupon.create({
        data: {
          code,
          description: description || `${Math.round(percentage * 100)}% discount`,
          percentage,
          durationLimitInIntervals,
          startsAt,
          expiresAt,
          autoApply,
          active: true,
          usageLimit,
          applicablePlans,
          showBanner,
          bannerHeading,
          bannerText,
          bannerTone,
          bannerPlacements: bannerPlacements.length > 0 ? bannerPlacements : ["pricing", "dashboard"],
          bannerDismissible,
          bannerButtonText,
        },
      });
      return { ok: true, message: `Coupon ${code} created successfully!` };
    } catch (err: any) {
      if (err?.code === "P2002" || String(err).includes("Unique")) {
        return { ok: false, error: `Coupon code "${code}" already exists.` };
      }
      return { ok: false, error: "Failed to create coupon: " + err.message };
    }
  }

  if (intent === "update_coupon") {
    const id = String(form.get("id") ?? "");
    const code = String(form.get("code") ?? "").trim().toUpperCase();
    const description = String(form.get("description") ?? "").trim();
    const percentInput = Number(form.get("percentage") ?? 0);
    const percentage = percentInput > 1 ? percentInput / 100 : percentInput;
    const durationInput = form.get("duration");
    const durationLimitInIntervals =
      durationInput && durationInput !== "lifetime"
        ? parseInt(String(durationInput), 10)
        : null;

    const startsAtStr = String(form.get("startsAt") ?? "");
    const expiresAtStr = String(form.get("expiresAt") ?? "");
    const startsAt = startsAtStr ? new Date(startsAtStr) : null;
    const expiresAt = expiresAtStr ? new Date(expiresAtStr) : null;

    const autoApply =
      form.get("autoApply") === "true" || form.get("autoApply") === "on";
    const active =
      form.get("active") === "true" || form.get("active") === "on";
    const usageLimitStr = String(form.get("usageLimit") ?? "").trim();
    const usageLimit = usageLimitStr ? parseInt(usageLimitStr, 10) : null;

    const applicablePlans = form
      .getAll("applicablePlans")
      .map(String)
      .filter(Boolean);

    const showBanner = form.get("showBanner") === "true" || form.get("showBanner") === "on";
    const bannerHeading = String(form.get("bannerHeading") ?? "").trim() || null;
    const bannerText = String(form.get("bannerText") ?? "").trim() || null;
    const bannerTone = String(form.get("bannerTone") ?? "success");
    const bannerPlacements = form.getAll("bannerPlacements").map(String).filter(Boolean);
    const bannerDismissible = form.get("bannerDismissible") !== "false" && form.get("bannerDismissible") !== "off";
    const bannerButtonText = String(form.get("bannerButtonText") ?? "").trim() || null;

    if (!id) return { ok: false, error: "Coupon ID is required." };
    if (!code) return { ok: false, error: "Coupon code is required." };
    if (percentage <= 0 || percentage > 1) {
      return {
        ok: false,
        error: "Percentage discount must be between 1% and 100%.",
      };
    }

    try {
      await prisma.coupon.update({
        where: { id },
        data: {
          code,
          description: description || `${Math.round(percentage * 100)}% discount`,
          percentage,
          durationLimitInIntervals,
          startsAt,
          expiresAt,
          autoApply,
          active,
          usageLimit,
          applicablePlans,
          showBanner,
          bannerHeading,
          bannerText,
          bannerTone,
          bannerPlacements: bannerPlacements.length > 0 ? bannerPlacements : ["pricing", "dashboard"],
          bannerDismissible,
          bannerButtonText,
        },
      });
      return { ok: true, message: `Coupon ${code} updated successfully!` };
    } catch (err: any) {
      if (err?.code === "P2002" || String(err).includes("Unique")) {
        return {
          ok: false,
          error: `Coupon code "${code}" is already in use by another coupon.`,
        };
      }
      return { ok: false, error: "Failed to update coupon: " + err.message };
    }
  }

  if (intent === "duplicate_coupon") {
    const id = String(form.get("id") ?? "");
    const original = await prisma.coupon.findUnique({ where: { id } });
    if (!original) return { ok: false, error: "Coupon not found." };
    let newCode = `${original.code}_COPY`;
    let count = 1;
    while (await prisma.coupon.findUnique({ where: { code: newCode } })) {
      count++;
      newCode = `${original.code}_COPY${count}`;
    }
    await prisma.coupon.create({
      data: {
        code: newCode,
        description: `Copy of ${original.description}`,
        percentage: original.percentage,
        durationLimitInIntervals: original.durationLimitInIntervals,
        startsAt: original.startsAt,
        expiresAt: original.expiresAt,
        autoApply: false,
        active: true,
        usageLimit: original.usageLimit,
        applicablePlans: original.applicablePlans,
      },
    });
    return { ok: true, message: `Coupon duplicated as ${newCode}!` };
  }

  if (intent === "reset_usage") {
    const id = String(form.get("id") ?? "");
    await prisma.coupon.update({
      where: { id },
      data: { usageCount: 0 },
    });
    return { ok: true, message: "Coupon usage count reset to 0." };
  }

  if (intent === "toggle_coupon") {
    const id = String(form.get("id") ?? "");
    const active = form.get("active") === "true";
    await prisma.coupon.update({
      where: { id },
      data: { active },
    });
    return { ok: true, message: active ? "Coupon activated." : "Coupon paused." };
  }

  if (intent === "toggle_auto_apply") {
    const id = String(form.get("id") ?? "");
    const autoApply = form.get("autoApply") === "true";
    await prisma.coupon.update({
      where: { id },
      data: { autoApply },
    });
    return {
      ok: true,
      message: autoApply
        ? "Auto-apply enabled for coupon."
        : "Auto-apply disabled.",
    };
  }

  if (intent === "toggle_banner") {
    const id = String(form.get("id") ?? "");
    const showBanner = form.get("showBanner") === "true";
    await prisma.coupon.update({
      where: { id },
      data: { showBanner },
    });
    return {
      ok: true,
      message: showBanner
        ? "Promotion banner enabled."
        : "Promotion banner disabled.",
    };
  }

  if (intent === "delete_coupon") {
    const id = String(form.get("id") ?? "");
    await prisma.coupon.delete({
      where: { id },
    });
    return { ok: true, message: "Coupon deleted." };
  }

  return { ok: false, error: "Unknown action" };
};

function EmbeddedAdminLogin({
  actionData,
  submit,
}: {
  actionData?: { ok?: boolean; error?: string; message?: string };
  submit: ReturnType<typeof useSubmit>;
}) {
  const [passcode, setPasscode] = useState("");

  return (
    <s-page heading="Super Admin Authentication">
      <div style={{ maxWidth: 480, margin: "60px auto 0", padding: "0 16px" }}>
        <s-box
          padding="large"
          borderWidth="base"
          borderStyle="solid"
          borderColor="base"
          borderRadius="large"
          background="base"
          style={{ backgroundColor: "#ffffff", boxShadow: "0 4px 20px rgba(0,0,0,0.06)" }}
        >
          <s-stack direction="block" gap="base">
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#202223" }}>
                Super Admin Access
              </div>
              <div style={{ fontSize: 13, color: "#6d7175", marginTop: 4 }}>
                Only authorized team members can access this dashboard to manage coupons,
                view store installs, and monitor app analytics.
              </div>
            </div>

            {actionData?.error ? (
              <s-banner tone="critical">
                <s-paragraph>{actionData.error}</s-paragraph>
              </s-banner>
            ) : null}

            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                submit({ intent: "unlock", passcode }, { method: "post" });
              }}
            >
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="Enter Master Passcode"
                  type="password"
                  value={passcode}
                  onInput={(e: any) => setPasscode(e.target.value)}
                  autoFocus
                  required
                />
                <div style={{ marginTop: 8 }}>
                  <s-button
                    type="submit"
                    variant="primary"
                    style={{ width: "100%", display: "block" }}
                  >
                    Unlock Admin Dashboard
                  </s-button>
                </div>
              </s-stack>
            </form>
          </s-stack>
        </s-box>
      </div>
    </s-page>
  );
}

function EmbeddedAdminDashboard({
  data,
  actionData,
  submit,
}: {
  data: any;
  actionData?: { ok?: boolean; error?: string; message?: string };
  submit: ReturnType<typeof useSubmit>;
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "coupons" | "stores" | "events">("overview");
  const [showCreateCouponModal, setShowCreateCouponModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<any | null>(null);
  const [selectedCouponForRedemptions, setSelectedCouponForRedemptions] = useState<any | null>(null);
  const [couponSearch, setCouponSearch] = useState("");
  const [couponFilter, setCouponFilter] = useState<
    "all" | "active" | "disabled" | "auto" | "scheduled" | "expired"
  >("all");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<"all" | "active" | "uninstalled" | "paid">("all");
  const [storeSearch, setStoreSearch] = useState("");

  const { metrics, coupons, stores, events, plans } = data;

  const handleCopy = (text: string, label: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        navigator.clipboard.writeText(text);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyFeedback(`${label} copied!`);
      setTimeout(() => setCopyFeedback(null), 2500);
    } catch {
      setCopyFeedback(`Could not copy to clipboard`);
      setTimeout(() => setCopyFeedback(null), 2500);
    }
  };

  const exportRedemptionsCsv = (coupon: any) => {
    if (!coupon.redemptions || coupon.redemptions.length === 0) return;
    const headers = ["Shop Domain", "Plan Name", "Discount %", "Redeemed At"];
    const rows = coupon.redemptions.map((r: any) => [
      `"${r.shop}"`,
      `"${r.planName || "Subscription"}"`,
      `"${Math.round((r.discountPct || coupon.percentage) * 100)}%"`,
      `"${new Date(r.redeemedAt).toISOString()}"`,
    ]);
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row: any[]) => row.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `coupon-${coupon.code}-redemptions.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredCoupons = useMemo(() => {
    return (coupons || []).filter((c: any) => {
      const now = Date.now();
      const startMs = c.startsAt ? new Date(c.startsAt).getTime() : 0;
      const endMs = c.expiresAt ? new Date(c.expiresAt).getTime() : Infinity;
      const isScheduled = startMs > now;
      const isExpired = endMs <= now;

      if (couponFilter === "active" && !c.active) return false;
      if (couponFilter === "disabled" && c.active) return false;
      if (couponFilter === "auto" && !c.autoApply) return false;
      if (couponFilter === "scheduled" && !isScheduled) return false;
      if (couponFilter === "expired" && !isExpired) return false;

      if (couponSearch) {
        const query = couponSearch.toLowerCase().trim();
        const codeMatches = c.code.toLowerCase().includes(query);
        const descMatches = (c.description || "").toLowerCase().includes(query);
        if (!codeMatches && !descMatches) return false;
      }
      return true;
    });
  }, [coupons, couponFilter, couponSearch]);

  // Filtered stores
  const filteredStores = stores.filter((s) => {
    if (storeFilter === "active" && !s.isInstalled) return false;
    if (storeFilter === "uninstalled" && s.isInstalled) return false;
    if (storeFilter === "paid" && (s.price === "0.00" || s.subscriptionStatus !== "active")) return false;
    if (storeSearch.trim()) {
      const q = storeSearch.trim().toLowerCase();
      return s.shop.toLowerCase().includes(q) || s.planName.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <s-page heading="Super Admin Dashboard" inlineSize="large" {...{ "inline-size": "large" }}>
      <style>{`
        .adm-tabs {
          display: flex;
          gap: 8px;
          border-bottom: 1px solid #e1e3e5;
          margin-bottom: 24px;
          overflow-x: auto;
        }
        .adm-tab {
          padding: 10px 18px;
          font-size: 14px;
          font-weight: 600;
          border: none;
          background: transparent;
          cursor: pointer;
          color: #6d7175;
          border-bottom: 2px solid transparent;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          gap: 8px;
          white-space: nowrap;
        }
        .adm-tab:hover {
          color: #202223;
        }
        .adm-tab.active {
          color: #2a78d6;
          border-bottom-color: #2a78d6;
        }
        .adm-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        .adm-card {
          background: #ffffff;
          border: 1px solid #e1e3e5;
          border-radius: 10px;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .adm-card-label {
          font-size: 13px;
          color: #6d7175;
          font-weight: 500;
        }
        .adm-card-val {
          font-size: 26px;
          font-weight: 700;
          color: #202223;
          line-height: 1.1;
        }
        .adm-card-sub {
          font-size: 12px;
          color: #8c9196;
        }
        .adm-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          background: #ffffff;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .adm-table th {
          background: #f7f7f8;
          text-align: left;
          padding: 12px 16px;
          font-weight: 600;
          color: #5c5f62;
          border-bottom: 1px solid #e1e3e5;
        }
        .adm-table td {
          padding: 14px 16px;
          border-bottom: 1px solid #f1f2f3;
          vertical-align: middle;
        }
        .adm-table tr:last-child td {
          border-bottom: none;
        }
        .adm-table tr:hover td {
          background: #fbfbfc;
        }
        .adm-modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          padding: 16px;
        }
        .adm-modal-content {
          background: #ffffff;
          border-radius: 12px;
          max-width: 580px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          padding: 24px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.15);
        }
        .adm-filter-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
          gap: 12px;
        }
        .adm-filter-pills {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .adm-filter-pill {
          padding: 6px 12px;
          border-radius: 20px;
          border: 1px solid #d1d5db;
          background-color: #ffffff;
          color: #4b5563;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .adm-filter-pill.active {
          border-color: #2a78d6;
          background-color: #eff6ff;
          color: #2a78d6;
        }
        .adm-icon-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 13px;
          padding: 2px 4px;
          border-radius: 4px;
        }
        .adm-toast {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background-color: #111827;
          color: #ffffff;
          padding: 12px 20px;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2);
          font-size: 13px;
          font-weight: 600;
          z-index: 10000;
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `}</style>

      {/* Top Banner Alert if any */}
      {actionData?.message ? (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="success">
            <s-paragraph>{actionData.message}</s-paragraph>
          </s-banner>
        </div>
      ) : actionData?.error ? (
        <div style={{ marginBottom: 16 }}>
          <s-banner tone="critical">
            <s-paragraph>{actionData.error}</s-paragraph>
          </s-banner>
        </div>
      ) : null}

      {/* Tabs navigation */}
      <div className="adm-tabs">
        <button
          type="button"
          className={`adm-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          <span>📊</span> Overview & Metrics
        </button>
        <button
          type="button"
          className={`adm-tab ${activeTab === "coupons" ? "active" : ""}`}
          onClick={() => setActiveTab("coupons")}
        >
          <span>🎟️</span> Coupons ({coupons.length})
        </button>
        <button
          type="button"
          className={`adm-tab ${activeTab === "stores" ? "active" : ""}`}
          onClick={() => setActiveTab("stores")}
        >
          <span>🏪</span> Stores ({stores.length})
        </button>
        <button
          type="button"
          className={`adm-tab ${activeTab === "events" ? "active" : ""}`}
          onClick={() => setActiveTab("events")}
        >
          <span>📜</span> Activity Log ({events.length})
        </button>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
          <s-button
            variant="tertiary"
            onClick={() => submit({ intent: "lock" }, { method: "post" })}
          >
            Lock Dashboard
          </s-button>
        </div>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && metrics ? (
        <div>
          <div className="adm-grid">
            <div className="adm-card">
              <span className="adm-card-label">Total Installs</span>
              <span className="adm-card-val">{metrics.totalStores}</span>
              <span className="adm-card-sub">All-time stores that installed</span>
            </div>
            <div className="adm-card">
              <span className="adm-card-label">Active Stores</span>
              <span className="adm-card-val" style={{ color: "#108043" }}>
                {metrics.activeStoresCount}
              </span>
              <span className="adm-card-sub">
                {metrics.totalStores > 0
                  ? `${Math.round((metrics.activeStoresCount / metrics.totalStores) * 100)}% active rate`
                  : "0%"}
              </span>
            </div>
            <div className="adm-card">
              <span className="adm-card-label">Uninstalled</span>
              <span className="adm-card-val" style={{ color: "#d82c0d" }}>
                {metrics.uninstalledStoresCount}
              </span>
              <span className="adm-card-sub">Stores uninstalled the app</span>
            </div>
            <div className="adm-card">
              <span className="adm-card-label">Paying Customers</span>
              <span className="adm-card-val" style={{ color: "#2a78d6" }}>
                {metrics.payingStoresCount}
              </span>
              <span className="adm-card-sub">Active paid subscriptions</span>
            </div>
            <div className="adm-card">
              <span className="adm-card-label">Estimated MRR</span>
              <span className="adm-card-val">${metrics.mrr.toFixed(2)}</span>
              <span className="adm-card-sub">Monthly recurring revenue</span>
            </div>
            <div className="adm-card">
              <span className="adm-card-label">Total 3D Models</span>
              <span className="adm-card-val">{metrics.totalModels}</span>
              <span className="adm-card-sub">Uploaded across all stores</span>
            </div>
            <div className="adm-card">
              <span className="adm-card-label">Coupons Redeemed</span>
              <span className="adm-card-val">{metrics.totalRedemptions}</span>
              <span className="adm-card-sub">Total times discounts used</span>
            </div>
          </div>

          <s-section heading="Quick Actions & Latest Activity">
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-box padding="base" borderWidth="base" borderStyle="solid" borderColor="base" borderRadius="base" background="base" style={{ backgroundColor: "#ffffff" }}>
                <s-stack direction="block" gap="small">
                  <div style={{ fontWeight: 600, fontSize: 16 }}>Coupons Summary</div>
                  <div style={{ color: "#6d7175", fontSize: 13 }}>
                    You currently have {coupons.filter((c) => c.active).length} active coupons and {coupons.filter((c) => c.autoApply).length} set to auto-apply.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <s-button variant="primary" onClick={() => { setActiveTab("coupons"); setShowCreateCouponModal(true); }}>
                      + Create New Coupon
                    </s-button>
                  </div>
                </s-stack>
              </s-box>

              <s-box padding="base" borderWidth="base" borderStyle="solid" borderColor="base" borderRadius="base" background="base" style={{ backgroundColor: "#ffffff" }}>
                <s-stack direction="block" gap="small">
                  <div style={{ fontWeight: 600, fontSize: 16 }}>Store Retention</div>
                  <div style={{ color: "#6d7175", fontSize: 13 }}>
                    {metrics.activeStoresCount} active / {metrics.uninstalledStoresCount} uninstalled.
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <s-button onClick={() => setActiveTab("stores")}>
                      View All Stores
                    </s-button>
                  </div>
                </s-stack>
              </s-box>
            </s-grid>
          </s-section>
        </div>
      ) : null}

      {/* TAB 2: COUPONS */}
      {activeTab === "coupons" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Coupons & Promotions</div>
              <div style={{ fontSize: 13, color: "#6d7175" }}>
                Create, update, toggle status, and track redemption limits for custom discounts.
              </div>
            </div>
            <s-button variant="primary" onClick={() => setShowCreateCouponModal(true)}>
              + Create Coupon Code
            </s-button>
          </div>

          {/* Filter and Search Bar */}
          <div className="adm-filter-bar">
            <div className="adm-filter-pills">
              {[
                { id: "all", label: `All (${coupons.length})` },
                {
                  id: "active",
                  label: `Active (${coupons.filter((c: any) => c.active).length})`,
                },
                {
                  id: "disabled",
                  label: `Paused (${coupons.filter((c: any) => !c.active).length})`,
                },
                {
                  id: "auto",
                  label: `Auto-Apply (${coupons.filter((c: any) => c.autoApply).length})`,
                },
                { id: "scheduled", label: "Scheduled" },
                { id: "expired", label: "Expired" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setCouponFilter(f.id as any)}
                  className={`adm-filter-pill ${couponFilter === f.id ? "active" : ""}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="text"
                placeholder="🔍 Search coupon code..."
                value={couponSearch}
                onChange={(e) => setCouponSearch(e.target.value)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: 13,
                  outline: "none",
                  width: 200,
                }}
              />
              {couponSearch && (
                <button
                  type="button"
                  onClick={() => setCouponSearch("")}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 4,
                    border: "1px solid #d1d5db",
                    background: "#ffffff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {filteredCoupons.length === 0 ? (
            <s-box padding="large" borderWidth="base" borderStyle="solid" borderColor="base" borderRadius="base" background="base" style={{ backgroundColor: "#ffffff", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🎟️</div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>
                {coupons.length === 0 ? "No coupons created yet" : "No coupons match your filter or search"}
              </div>
              <div style={{ color: "#6d7175", fontSize: 13, margin: "6px auto 16px", maxWidth: 400 }}>
                {coupons.length === 0
                  ? "Create your first promotion code to offer percentage discounts to merchants upgrading their plans."
                  : "Try adjusting your search query or switching the status filter tab."}
              </div>
              {coupons.length === 0 && (
                <s-button variant="primary" onClick={() => setShowCreateCouponModal(true)}>
                  Create Coupon Code
                </s-button>
              )}
            </s-box>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Code & Promotion</th>
                  <th>Discount</th>
                  <th>Duration</th>
                  <th>Dates</th>
                  <th>Auto-Apply</th>
                  <th>Banner</th>
                  <th>Usage</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredCoupons.map((c: any) => {
                  const now = Date.now();
                  const startMs = c.startsAt ? new Date(c.startsAt).getTime() : 0;
                  const endMs = c.expiresAt ? new Date(c.expiresAt).getTime() : Infinity;
                  const isScheduled = startMs > now;
                  const isExpired = endMs <= now;
                  const limitReached = c.usageLimit !== null && c.usageLimit !== undefined && c.usageCount >= c.usageLimit;

                  return (
                    <tr key={c.id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 700, fontFamily: "monospace", fontSize: 14 }}>
                            {c.code}
                          </span>
                          <button
                            type="button"
                            title="Copy code"
                            onClick={() => handleCopy(c.code, `Code "${c.code}"`)}
                            className="adm-icon-btn"
                          >
                            📋
                          </button>
                        </div>
                        <div style={{ fontSize: 12, color: "#6d7175" }}>{c.description}</div>
                        <button
                          type="button"
                          onClick={() =>
                            handleCopy(`/app/pricing?coupon=${c.code}`, `Pricing link for ${c.code}`)
                          }
                          style={{
                            background: "none",
                            border: "none",
                            color: "#2a78d6",
                            fontSize: 11,
                            cursor: "pointer",
                            padding: 0,
                            marginTop: 4,
                            textAlign: "left",
                          }}
                        >
                          🔗 Copy pricing link
                        </button>
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: "#108043" }}>{c.discountLabel} off</span>
                      </td>
                      <td>{c.durationLabel}</td>
                      <td>
                        <div style={{ fontSize: 12 }}>
                          <div>
                            <span style={{ color: "#6d7175" }}>Start: </span>
                            {c.startsAt ? new Date(c.startsAt).toLocaleDateString() : "Immediate"}
                          </div>
                          <div>
                            <span style={{ color: "#6d7175" }}>End: </span>
                            {c.expiresAt ? (
                              <span style={{ color: isExpired ? "#d82c0d" : "inherit", fontWeight: isExpired ? 600 : 400 }}>
                                {new Date(c.expiresAt).toLocaleDateString()}
                              </span>
                            ) : (
                              "Never"
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          title="Click to toggle auto-apply"
                          onClick={() =>
                            submit(
                              {
                                intent: "toggle_auto_apply",
                                id: c.id,
                                autoApply: (!c.autoApply).toString(),
                              },
                              { method: "post" },
                            )
                          }
                          style={{
                            background: c.autoApply ? "#e7f1fc" : "#f1f2f3",
                            color: c.autoApply ? "#2a78d6" : "#6d7175",
                            border: "1px solid",
                            borderColor: c.autoApply ? "#b4d3f7" : "#e1e3e5",
                            padding: "3px 8px",
                            borderRadius: 4,
                            cursor: "pointer",
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {c.autoApply ? "⚡ Auto-applied" : "Manual"}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                          <button
                            type="button"
                            title="Click to toggle announcement banner"
                            onClick={() =>
                              submit(
                                {
                                  intent: "toggle_banner",
                                  id: c.id,
                                  showBanner: (!c.showBanner).toString(),
                                },
                                { method: "post" },
                              )
                            }
                            style={{
                              background: c.showBanner ? "#dcfce7" : "#f3f4f6",
                              color: c.showBanner ? "#15803d" : "#6b7280",
                              border: "1px solid",
                              borderColor: c.showBanner ? "#86efac" : "#e5e7eb",
                              padding: "3px 8px",
                              borderRadius: 4,
                              cursor: "pointer",
                              fontSize: 11,
                              fontWeight: 600,
                            }}
                          >
                            {c.showBanner ? "📢 Active" : "🔇 Hidden"}
                          </button>
                          {c.showBanner ? (
                            <span style={{ fontSize: "10px", color: "#6b7280" }}>
                              {(c.bannerPlacements || []).join(", ") || "all"} •{" "}
                              {c.bannerDismissible !== false ? "Closeable" : "Locked"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedCouponForRedemptions(c)}
                            style={{
                              background: "#f1f2f3",
                              border: "none",
                              borderRadius: 4,
                              padding: "4px 8px",
                              cursor: "pointer",
                              fontWeight: 600,
                              fontSize: 12,
                            }}
                          >
                            {c.usageCount} {c.usageLimit ? `/ ${c.usageLimit}` : "uses"} (view)
                          </button>
                          {c.usageCount > 0 && (
                            <button
                              type="button"
                              title="Reset usage counter back to 0"
                              onClick={() => {
                                if (confirm(`Reset usage count for coupon ${c.code} back to 0?`)) {
                                  submit({ intent: "reset_usage", id: c.id }, { method: "post" });
                                }
                              }}
                              className="adm-icon-btn"
                            >
                              🔄
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <div>
                            {!c.active ? (
                              <s-badge tone="neutral">⏸️ Paused</s-badge>
                            ) : limitReached ? (
                              <s-badge tone="warning">🚫 Limit Reached</s-badge>
                            ) : isExpired ? (
                              <s-badge tone="critical">🛑 Expired</s-badge>
                            ) : isScheduled ? (
                              <s-badge tone="warning">⏳ Scheduled</s-badge>
                            ) : (
                              <s-badge tone="success">🟢 Active</s-badge>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              submit(
                                { intent: "toggle_coupon", id: c.id, active: (!c.active).toString() },
                                { method: "post" },
                              )
                            }
                            style={{
                              padding: "2px 8px",
                              fontSize: 11,
                              borderRadius: 4,
                              border: "1px solid",
                              cursor: "pointer",
                              fontWeight: 600,
                              width: "fit-content",
                              backgroundColor: c.active ? "#fffbeb" : "#f0fdf4",
                              color: c.active ? "#b45309" : "#15803d",
                              borderColor: c.active ? "#fde68a" : "#bbf7d0",
                            }}
                          >
                            {c.active ? "Pause" : "Activate"}
                          </button>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            onClick={() => setEditingCoupon(c)}
                            style={{
                              padding: "4px 8px",
                              borderRadius: 4,
                              border: "1px solid #bfdbfe",
                              background: "#eff6ff",
                              color: "#1d4ed8",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            ✏️ Edit
                          </button>
                          <s-button
                            variant="tertiary"
                            onClick={() =>
                              submit({ intent: "duplicate_coupon", id: c.id }, { method: "post" })
                            }
                          >
                            👥 Clone
                          </s-button>
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() => {
                              if (confirm(`Are you sure you want to delete coupon ${c.code}?`)) {
                                submit({ intent: "delete_coupon", id: c.id }, { method: "post" });
                              }
                            }}
                          >
                            🗑️
                          </s-button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* TAB 3: STORES & LIFECYCLE */}
      {activeTab === "stores" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Store Lifecycle & Installations</div>
              <div style={{ fontSize: 13, color: "#6d7175" }}>
                Track which stores installed, uninstalled, or upgraded to paid plans.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                placeholder="Search store domain..."
                value={storeSearch}
                onChange={(e) => setStoreSearch(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #c9cccf",
                  fontSize: 13,
                  outline: "none",
                  width: 200,
                }}
              />
              <select
                value={storeFilter}
                onChange={(e: any) => setStoreFilter(e.target.value)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #c9cccf",
                  fontSize: 13,
                  background: "#ffffff",
                }}
              >
                <option value="all">All Stores ({stores.length})</option>
                <option value="active">Active Only ({metrics?.activeStoresCount})</option>
                <option value="uninstalled">Uninstalled Only ({metrics?.uninstalledStoresCount})</option>
                <option value="paid">Paying Only ({metrics?.payingStoresCount})</option>
              </select>
            </div>
          </div>

          <table className="adm-table">
            <thead>
              <tr>
                <th>Store Domain</th>
                <th>Status</th>
                <th>Installed Date</th>
                <th>Uninstalled Date</th>
                <th>Current Plan</th>
                <th>Subscription</th>
                <th>3D Models</th>
              </tr>
            </thead>
            <tbody>
              {filteredStores.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: "#202223" }}>{s.shop}</div>
                  </td>
                  <td>
                    {s.isInstalled ? (
                      <s-badge tone="success">Active</s-badge>
                    ) : (
                      <s-badge tone="critical">Uninstalled</s-badge>
                    )}
                  </td>
                  <td>{new Date(s.installedAt).toLocaleString()}</td>
                  <td>
                    {s.uninstalledAt ? (
                      <span style={{ color: "#d82c0d" }}>
                        {new Date(s.uninstalledAt).toLocaleString()}
                      </span>
                    ) : (
                      <span style={{ color: "#8c9196" }}>—</span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.planName}</div>
                    <div style={{ fontSize: 12, color: "#6d7175" }}>${s.price}/mo</div>
                  </td>
                  <td>
                    {s.subscriptionStatus === "active" ? (
                      <s-badge tone="success">Active</s-badge>
                    ) : (
                      <s-badge tone="neutral">{s.subscriptionStatus}</s-badge>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{s.modelCount} models</div>
                  </td>
                </tr>
              ))}
              {filteredStores.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: 32, color: "#6d7175" }}>
                    No stores match your search or filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 4: ACTIVITY LOG */}
      {activeTab === "events" && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>App Activity & Audit Stream</div>
            <div style={{ fontSize: 13, color: "#6d7175" }}>
              Real-time events recorded when stores install, reinstall, uninstall, subscribe, or redeem coupons.
            </div>
          </div>

          <table className="adm-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Store</th>
                <th>Event Type</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                let badgeTone: "info" | "success" | "critical" | "warning" = "info";
                if (e.type === "install" || e.type === "reinstall") badgeTone = "success";
                if (e.type === "uninstall") badgeTone = "critical";
                if (e.type === "coupon_used") badgeTone = "warning";

                return (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap", color: "#6d7175" }}>
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td style={{ fontWeight: 600 }}>{e.shop}</td>
                    <td>
                      <s-badge tone={badgeTone}>{e.type.replace("_", " ").toUpperCase()}</s-badge>
                    </td>
                    <td>
                      <pre style={{ margin: 0, fontSize: 12, background: "#f6f6f7", padding: "4px 8px", borderRadius: 4, maxHeight: 60, overflow: "auto" }}>
                        {e.detail || "No additional metadata"}
                      </pre>
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", padding: 32, color: "#6d7175" }}>
                    No activity recorded yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: CREATE COUPON */}
      {showCreateCouponModal ? (
        <div className="adm-modal-overlay">
          <div className="adm-modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Create New Coupon</div>
              <button
                type="button"
                onClick={() => setShowCreateCouponModal(false)}
                style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.append("intent", "create_coupon");
                submit(fd, { method: "post" });
                setShowCreateCouponModal(false);
              }}
            >
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="Coupon Code (e.g. SUMMER50)"
                  name="code"
                  placeholder="SAVE30"
                  required
                />

                <s-text-field
                  label="Description / Promotion Name"
                  name="description"
                  placeholder="30% discount on all plans"
                  required
                />

                <s-text-field
                  label="Discount Percentage (%)"
                  name="percentage"
                  type="number"
                  placeholder="25"
                  min="1"
                  max="100"
                  required
                />

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    Discount Duration
                  </label>
                  <select
                    name="duration"
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", background: "#ffffff" }}
                  >
                    <option value="lifetime">Lifetime (for as long as subscription runs)</option>
                    <option value="1">1 billing period</option>
                    <option value="2">2 billing periods</option>
                    <option value="3">3 billing periods</option>
                    <option value="6">6 billing periods</option>
                    <option value="12">12 billing periods</option>
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Start Date (Optional)
                    </label>
                    <input
                      type="date"
                      name="startsAt"
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Expiration Date (Optional)
                    </label>
                    <input
                      type="date"
                      name="expiresAt"
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>
                </div>

                <s-text-field
                  label="Max Redemptions / Usage Limit (Optional)"
                  name="usageLimit"
                  type="number"
                  placeholder="Leave empty for unlimited uses"
                  min="1"
                />

                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                    <input type="checkbox" name="autoApply" value="true" />
                    Auto-apply automatically on the Pricing page
                  </label>
                  <div style={{ fontSize: 12, color: "#6d7175", marginLeft: 24 }}>
                    Merchants visiting the pricing page will automatically receive this discount without typing the code.
                  </div>
                </div>

                {/* BANNER CONTROLS */}
                <div
                  style={{
                    padding: 16,
                    background: "#f0fdf4",
                    borderRadius: 8,
                    border: "1px solid #bbf7d0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: 14,
                        color: "#166534",
                      }}
                    >
                      <input
                        type="checkbox"
                        name="showBanner"
                        value="true"
                        defaultChecked={true}
                      />
                      📢 Show Announcement Banner for this Coupon
                    </label>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Where to show the banner (Placements)
                    </label>
                    <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          name="bannerPlacements"
                          value="pricing"
                          defaultChecked={true}
                        />
                        Pricing Page (/app/pricing)
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          name="bannerPlacements"
                          value="dashboard"
                          defaultChecked={true}
                        />
                        Dashboard (/app)
                      </label>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        Is Closeable / Dismissible by Merchant?
                      </label>
                      <select
                        name="bannerDismissible"
                        defaultValue="true"
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", background: "#ffffff" }}
                      >
                        <option value="true">Yes — Closeable with (✕) button</option>
                        <option value="false">No — Persistent (Cannot be closed)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        Banner Tone / Color Style
                      </label>
                      <select
                        name="bannerTone"
                        defaultValue="success"
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", background: "#ffffff" }}
                      >
                        <option value="success">Success (Green)</option>
                        <option value="info">Info (Blue)</option>
                        <option value="warning">Warning / Attention (Amber)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Custom Banner Heading (Title) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerHeading"
                      placeholder="e.g. 🎉 Special Offer: 20% Discount Auto-Applied!"
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Custom Banner Message (Body Text) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerText"
                      placeholder="e.g. Upgrade today to get 20% discount auto-applied at checkout."
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Button Text (Optional)
                    </label>
                    <input
                      type="text"
                      name="bannerButtonText"
                      placeholder="e.g. View Plans & Upgrade"
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Applicable Plans (Optional - leave unchecked for all plans)
                  </label>
                  <div style={{ display: "flex", gap: 16 }}>
                    {plans.map((p) => (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input type="checkbox" name="applicablePlans" value={p.name} />
                        {p.title || p.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                  <s-button onClick={() => setShowCreateCouponModal(false)}>
                    Cancel
                  </s-button>
                  <s-button type="submit" variant="primary">
                    Create Coupon
                  </s-button>
                </div>
              </s-stack>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL: EDIT COUPON */}
      {editingCoupon ? (
        <div className="adm-modal-overlay">
          <div className="adm-modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>✏️ Edit Coupon: {editingCoupon.code}</div>
                <div style={{ fontSize: 13, color: "#6d7175" }}>
                  Update discount percentage, expiration, status, or promo code
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCoupon(null)}
                style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.append("intent", "update_coupon");
                fd.append("id", editingCoupon.id);
                submit(fd, { method: "post" });
                setEditingCoupon(null);
              }}
            >
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="Coupon Code (e.g. SUMMER50)"
                  name="code"
                  defaultValue={editingCoupon.code}
                  required
                />

                <s-text-field
                  label="Description / Promotion Name"
                  name="description"
                  defaultValue={editingCoupon.description}
                  required
                />

                <s-text-field
                  label="Discount Percentage (%)"
                  name="percentage"
                  type="number"
                  defaultValue={Math.round(editingCoupon.percentage * 100)}
                  min="1"
                  max="100"
                  required
                />

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    Discount Duration
                  </label>
                  <select
                    name="duration"
                    defaultValue={
                      editingCoupon.durationLimitInIntervals !== null &&
                      editingCoupon.durationLimitInIntervals !== undefined
                        ? String(editingCoupon.durationLimitInIntervals)
                        : "lifetime"
                    }
                    style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", background: "#ffffff" }}
                  >
                    <option value="lifetime">Lifetime (for as long as subscription runs)</option>
                    <option value="1">1 billing period</option>
                    <option value="2">2 billing periods</option>
                    <option value="3">3 billing periods</option>
                    <option value="6">6 billing periods</option>
                    <option value="12">12 billing periods</option>
                  </select>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Start Date (Optional)
                    </label>
                    <input
                      type="date"
                      name="startsAt"
                      defaultValue={editingCoupon.startsAt ? editingCoupon.startsAt.slice(0, 10) : ""}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Expiration Date (Optional)
                    </label>
                    <input
                      type="date"
                      name="expiresAt"
                      defaultValue={editingCoupon.expiresAt ? editingCoupon.expiresAt.slice(0, 10) : ""}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>
                </div>

                <s-text-field
                  label="Max Redemptions / Usage Limit (Optional)"
                  name="usageLimit"
                  type="number"
                  defaultValue={editingCoupon.usageLimit ?? ""}
                  placeholder="Leave empty for unlimited uses"
                  min="1"
                />

                <div style={{ padding: 12, background: "#f6f6f7", borderRadius: 6, display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                    <input type="checkbox" name="active" value="true" defaultChecked={editingCoupon.active} />
                    Coupon is Active (uncheck to Pause)
                  </label>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                    <input type="checkbox" name="autoApply" value="true" defaultChecked={editingCoupon.autoApply} />
                    Auto-apply automatically on the Pricing page
                  </label>
                  <div style={{ fontSize: 12, color: "#6d7175", marginLeft: 24 }}>
                    Merchants visiting the pricing page will automatically receive this discount without typing the code.
                  </div>
                </div>

                {/* BANNER CONTROLS */}
                <div
                  style={{
                    padding: 16,
                    background: "#f0fdf4",
                    borderRadius: 8,
                    border: "1px solid #bbf7d0",
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: 14,
                        color: "#166534",
                      }}
                    >
                      <input
                        type="checkbox"
                        name="showBanner"
                        value="true"
                        defaultChecked={editingCoupon.showBanner !== false}
                      />
                      📢 Show Announcement Banner for this Coupon
                    </label>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Where to show the banner (Placements)
                    </label>
                    <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          name="bannerPlacements"
                          value="pricing"
                          defaultChecked={
                            !editingCoupon.bannerPlacements ||
                            editingCoupon.bannerPlacements.length === 0 ||
                            editingCoupon.bannerPlacements.includes("pricing")
                          }
                        />
                        Pricing Page (/app/pricing)
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          name="bannerPlacements"
                          value="dashboard"
                          defaultChecked={
                            !editingCoupon.bannerPlacements ||
                            editingCoupon.bannerPlacements.length === 0 ||
                            editingCoupon.bannerPlacements.includes("dashboard")
                          }
                        />
                        Dashboard (/app)
                      </label>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        Is Closeable / Dismissible by Merchant?
                      </label>
                      <select
                        name="bannerDismissible"
                        defaultValue={editingCoupon.bannerDismissible === false ? "false" : "true"}
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", background: "#ffffff" }}
                      >
                        <option value="true">Yes — Closeable with (✕) button</option>
                        <option value="false">No — Persistent (Cannot be closed)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                        Banner Tone / Color Style
                      </label>
                      <select
                        name="bannerTone"
                        defaultValue={editingCoupon.bannerTone || "success"}
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", background: "#ffffff" }}
                      >
                        <option value="success">Success (Green)</option>
                        <option value="info">Info (Blue)</option>
                        <option value="warning">Warning / Attention (Amber)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Custom Banner Heading (Title) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerHeading"
                      placeholder="e.g. 🎉 Special Offer: 20% Discount Auto-Applied!"
                      defaultValue={editingCoupon.bannerHeading || ""}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Custom Banner Message (Body Text) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerText"
                      placeholder="e.g. Upgrade today to get 20% discount auto-applied at checkout."
                      defaultValue={editingCoupon.bannerText || ""}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Button Text (Optional)
                    </label>
                    <input
                      type="text"
                      name="bannerButtonText"
                      placeholder="e.g. View Plans & Upgrade"
                      defaultValue={editingCoupon.bannerButtonText || ""}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid #c9cccf", boxSizing: "border-box" }}
                    />
                  </div>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                    Applicable Plans (Optional - leave unchecked for all plans)
                  </label>
                  <div style={{ display: "flex", gap: 16 }}>
                    {plans.map((p) => (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                        <input
                          type="checkbox"
                          name="applicablePlans"
                          value={p.name}
                          defaultChecked={
                            !editingCoupon.applicablePlans ||
                            editingCoupon.applicablePlans.length === 0 ||
                            editingCoupon.applicablePlans.includes(p.name)
                          }
                        />
                        {p.title || p.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                  <s-button onClick={() => setEditingCoupon(null)}>
                    Cancel
                  </s-button>
                  <s-button type="submit" variant="primary">
                    Save Changes
                  </s-button>
                </div>
              </s-stack>
            </form>
          </div>
        </div>
      ) : null}

      {/* MODAL: VIEW REDEMPTIONS */}
      {selectedCouponForRedemptions ? (
        <div className="adm-modal-overlay">
          <div className="adm-modal-content">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  Redemptions for {selectedCouponForRedemptions.code}
                </div>
                <div style={{ fontSize: 13, color: "#6d7175" }}>
                  Used {selectedCouponForRedemptions.usageCount} times
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {selectedCouponForRedemptions.redemptions?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => exportRedemptionsCsv(selectedCouponForRedemptions)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "1px solid #c9cccf",
                      background: "#ffffff",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    📥 Export CSV
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCouponForRedemptions(null)}
                  style={{ background: "transparent", border: "none", fontSize: 20, cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>
            </div>

            {selectedCouponForRedemptions.redemptions?.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#6d7175" }}>
                No stores have redeemed this coupon code yet.
              </div>
            ) : (
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Store</th>
                    <th>Plan</th>
                    <th>Redeemed Date</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCouponForRedemptions.redemptions.map((r: any) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.shop}</td>
                      <td>{r.planName || "Subscription"}</td>
                      <td>{new Date(r.redeemedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <s-button onClick={() => setSelectedCouponForRedemptions(null)}>
                Close
              </s-button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Toast Notification */}
      {copyFeedback && (
        <div className="adm-toast">
          <span>📋</span> {copyFeedback}
        </div>
      )}
    </s-page>
  );
}

export default function AdminDashboard() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<{ ok?: boolean; error?: string; message?: string }>();
  const submit = useSubmit();

  if (!data.authorized) {
    return <EmbeddedAdminLogin actionData={actionData} submit={submit} />;
  }

  return (
    <EmbeddedAdminDashboard
      data={data}
      actionData={actionData}
      submit={submit}
    />
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
