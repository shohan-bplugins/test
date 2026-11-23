import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState, useMemo } from "react";
import { useActionData, useLoaderData, useSubmit } from "react-router";
import prisma from "~/db.server";
import {
  checkStandaloneAdminAuth,
  createAdminCookieHeader,
  clearAdminCookieHeader,
  verifyAdminPassword,
} from "~/lib/admin-auth.server";
import { getPlans } from "~/lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const isAuthorized = checkStandaloneAdminAuth(request);

  if (!isAuthorized) {
    return {
      authorized: false,
      metrics: null,
      coupons: [],
      stores: [],
      events: [],
      plans: [],
    };
  }

  // Fetch all live data for the admin dashboard
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
            take: 150,
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

  const activeChargesByShop = new Map<string, (typeof charges)[0]>();
  for (const c of charges) {
    if (c.status === "active" && !activeChargesByShop.has(c.shop)) {
      activeChargesByShop.set(c.shop, c);
    }
  }

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

  const formattedStores = users.map((u) => {
    const activeCharge = activeChargesByShop.get(u.shop);
    const plan =
      plans.find((p) => p.id === u.planId || p.id === activeCharge?.planId) ??
      null;
    return {
      id: u.id,
      shop: u.shop,
      isInstalled: u.isInstalled !== false,
      installedAt: u.installedAt
        ? u.installedAt.toISOString()
        : u.createdAt.toISOString(),
      uninstalledAt: u.uninstalledAt ? u.uninstalledAt.toISOString() : null,
      planName:
        plan?.title ?? plan?.name ?? (activeCharge ? activeCharge.name : "Free"),
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
        c.durationLimitInIntervals === null ||
        c.durationLimitInIntervals === undefined
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
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  // Login with static password from .env
  if (intent === "login") {
    const password = String(form.get("password") ?? "");
    const check = verifyAdminPassword(request, password);

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

  // Logout
  if (intent === "logout") {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearAdminCookieHeader(),
      },
    });
  }

  // Must be authenticated for all operations below
  if (!checkStandaloneAdminAuth(request)) {
    return { ok: false, error: "Unauthorized." };
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

    const autoApply =
      form.get("autoApply") === "true" || form.get("autoApply") === "on";
    const usageLimitStr = String(form.get("usageLimit") ?? "").trim();
    const usageLimit = usageLimitStr ? parseInt(usageLimitStr, 10) : null;

    const applicablePlans = form
      .getAll("applicablePlans")
      .map(String)
      .filter(Boolean);

    const showBanner =
      form.get("showBanner") === "true" || form.get("showBanner") === "on";
    const bannerHeading =
      String(form.get("bannerHeading") ?? "").trim() || null;
    const bannerText =
      String(form.get("bannerText") ?? "").trim() || null;
    const bannerTone =
      String(form.get("bannerTone") ?? "success");
    const bannerPlacements = form
      .getAll("bannerPlacements")
      .map(String)
      .filter(Boolean);
    const bannerDismissible =
      form.get("bannerDismissible") !== "false" &&
      form.get("bannerDismissible") !== "off";
    const bannerButtonText =
      String(form.get("bannerButtonText") ?? "").trim() || null;

    if (!code) {
      return { ok: false, error: "Coupon code is required." };
    }
    if (percentage <= 0 || percentage > 1) {
      return {
        ok: false,
        error: "Percentage discount must be between 1% and 100%.",
      };
    }

    try {
      const db = (prisma as any).coupon
        ? prisma
        : (await import("~/db.server")).getActivePrismaClient();

      await db.coupon.create({
        data: {
          code,
          description:
            description || `${Math.round(percentage * 100)}% discount`,
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

    const showBanner =
      form.get("showBanner") === "true" || form.get("showBanner") === "on";
    const bannerHeading =
      String(form.get("bannerHeading") ?? "").trim() || null;
    const bannerText =
      String(form.get("bannerText") ?? "").trim() || null;
    const bannerTone =
      String(form.get("bannerTone") ?? "success");
    const bannerPlacements = form
      .getAll("bannerPlacements")
      .map(String)
      .filter(Boolean);
    const bannerDismissible =
      form.get("bannerDismissible") !== "false" &&
      form.get("bannerDismissible") !== "off";
    const bannerButtonText =
      String(form.get("bannerButtonText") ?? "").trim() || null;

    if (!id) return { ok: false, error: "Coupon ID is required." };
    if (!code) return { ok: false, error: "Coupon code is required." };
    if (percentage <= 0 || percentage > 1) {
      return {
        ok: false,
        error: "Percentage discount must be between 1% and 100%.",
      };
    }

    try {
      const db = (prisma as any).coupon
        ? prisma
        : (await import("~/db.server")).getActivePrismaClient();

      await db.coupon.update({
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
    const db = (prisma as any).coupon
      ? prisma
      : (await import("~/db.server")).getActivePrismaClient();
    const original = await db.coupon.findUnique({ where: { id } });
    if (!original) return { ok: false, error: "Coupon not found." };
    let newCode = `${original.code}_COPY`;
    let count = 1;
    while (await db.coupon.findUnique({ where: { code: newCode } })) {
      count++;
      newCode = `${original.code}_COPY${count}`;
    }
    await db.coupon.create({
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
    const db = (prisma as any).coupon
      ? prisma
      : (await import("~/db.server")).getActivePrismaClient();
    await db.coupon.update({
      where: { id },
      data: { usageCount: 0 },
    });
    return { ok: true, message: "Coupon usage count reset to 0." };
  }

  if (intent === "toggle_coupon") {
    const id = String(form.get("id") ?? "");
    const active = form.get("active") === "true";
    const db = (prisma as any).coupon
      ? prisma
      : (await import("~/db.server")).getActivePrismaClient();
    await db.coupon.update({
      where: { id },
      data: { active },
    });
    return { ok: true, message: active ? "Coupon activated." : "Coupon paused." };
  }

  if (intent === "toggle_auto_apply") {
    const id = String(form.get("id") ?? "");
    const autoApply = form.get("autoApply") === "true";
    const db = (prisma as any).coupon
      ? prisma
      : (await import("~/db.server")).getActivePrismaClient();
    await db.coupon.update({
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
    const db = (prisma as any).coupon
      ? prisma
      : (await import("~/db.server")).getActivePrismaClient();
    await db.coupon.update({
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
    const db = (prisma as any).coupon
      ? prisma
      : (await import("~/db.server")).getActivePrismaClient();
    await db.coupon.delete({
      where: { id },
    });
    return { ok: true, message: "Coupon deleted." };
  }

  return { ok: false, error: "Unknown action" };
};

function StandaloneAdminLogin({
  actionData,
  submit,
}: {
  actionData?: { ok?: boolean; error?: string; message?: string };
  submit: ReturnType<typeof useSubmit>;
}) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div style={styles.loginWrap}>
      <div style={styles.loginCard}>
        <div style={styles.loginHeader}>
          <div style={styles.loginIcon}>🔐</div>
          <h1 style={styles.loginTitle}>Super Admin Portal</h1>
          <p style={styles.loginSub}>
            Enter the static master password defined in your{" "}
            <code>.env</code> file to access coupon controls and app analytics.
          </p>
        </div>

        {actionData?.error && (
          <div style={styles.alertError}>
            <span>⚠️</span> {actionData.error}
          </div>
        )}

        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ intent: "login", password }, { method: "post" });
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <label style={styles.inputLabel}>Admin Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter static admin password..."
                required
                autoFocus
                style={styles.input}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={styles.eyeBtn}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          <button type="submit" style={styles.btnPrimaryFull}>
            Sign In to Admin
          </button>
        </form>
      </div>
    </div>
  );
}

function StandaloneAdminDashboard({
  data,
  actionData,
  submit,
}: {
  data: any;
  actionData?: { ok?: boolean; error?: string; message?: string };
  submit: ReturnType<typeof useSubmit>;
}) {
  const [activeTab, setActiveTab] = useState<
    "overview" | "coupons" | "stores" | "events"
  >("overview");
  const [showCreateCouponModal, setShowCreateCouponModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<any | null>(null);
  const [selectedCouponForRedemptions, setSelectedCouponForRedemptions] =
    useState<any | null>(null);
  const [couponSearch, setCouponSearch] = useState("");
  const [couponFilter, setCouponFilter] = useState<
    "all" | "active" | "disabled" | "auto" | "scheduled" | "expired"
  >("all");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState<
    "all" | "active" | "uninstalled" | "paid"
  >("all");
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

  const filteredStores = stores.filter((s) => {
    if (storeFilter === "active" && !s.isInstalled) return false;
    if (storeFilter === "uninstalled" && s.isInstalled) return false;
    if (
      storeFilter === "paid" &&
      (s.price === "0.00" || s.subscriptionStatus !== "active")
    )
      return false;
    if (storeSearch.trim()) {
      const q = storeSearch.trim().toLowerCase();
      return (
        s.shop.toLowerCase().includes(q) || s.planName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={styles.appWrap}>
      {/* Top Navbar */}
      <header style={styles.header}>
        <div style={styles.brandGroup}>
          <span style={styles.logoBadge}>3D</span>
          <div>
            <div style={styles.brandTitle}>Easy 3D Viewer</div>
            <div style={styles.brandSub}>Super Admin Management Portal</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={styles.liveIndicator}>
            <span style={styles.pulseDot} /> Live Database
          </span>
          <button
            type="button"
            onClick={() => submit({ intent: "logout" }, { method: "post" })}
            style={styles.btnLogout}
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main style={styles.container}>
        {actionData?.message && (
          <div style={styles.alertSuccess}>
            <span>✓</span> {actionData.message}
          </div>
        )}
        {actionData?.error && (
          <div style={styles.alertError}>
            <span>⚠️</span> {actionData.error}
          </div>
        )}

        {/* Tab Navigation */}
        <div style={styles.tabBar}>
          <button
            type="button"
            onClick={() => setActiveTab("overview")}
            style={{
              ...styles.tabItem,
              ...(activeTab === "overview" ? styles.tabItemActive : {}),
            }}
          >
            📊 Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("coupons")}
            style={{
              ...styles.tabItem,
              ...(activeTab === "coupons" ? styles.tabItemActive : {}),
            }}
          >
            🎟️ Coupons ({coupons.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("stores")}
            style={{
              ...styles.tabItem,
              ...(activeTab === "stores" ? styles.tabItemActive : {}),
            }}
          >
            🏪 Stores & Installs ({stores.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("events")}
            style={{
              ...styles.tabItem,
              ...(activeTab === "events" ? styles.tabItemActive : {}),
            }}
          >
            📜 Activity Stream ({events.length})
          </button>
        </div>

        {/* TAB 1: OVERVIEW */}
        {activeTab === "overview" && metrics && (
          <div>
            <div style={styles.metricGrid}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Total Installs</div>
                <div style={styles.statNumber}>{metrics.totalStores}</div>
                <div style={styles.statMeta}>All-time recorded stores</div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>Active Stores</div>
                <div style={{ ...styles.statNumber, color: "#16a34a" }}>
                  {metrics.activeStoresCount}
                </div>
                <div style={styles.statMeta}>
                  {metrics.totalStores > 0
                    ? `${Math.round((metrics.activeStoresCount / metrics.totalStores) * 100)}% retention rate`
                    : "0%"}
                </div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>Uninstalled</div>
                <div style={{ ...styles.statNumber, color: "#dc2626" }}>
                  {metrics.uninstalledStoresCount}
                </div>
                <div style={styles.statMeta}>App uninstalled by merchant</div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>Paying Customers</div>
                <div style={{ ...styles.statNumber, color: "#2563eb" }}>
                  {metrics.payingStoresCount}
                </div>
                <div style={styles.statMeta}>Active paid subscriptions</div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>Estimated MRR</div>
                <div style={styles.statNumber}>${metrics.mrr.toFixed(2)}</div>
                <div style={styles.statMeta}>Monthly recurring revenue</div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>Total 3D Models</div>
                <div style={styles.statNumber}>{metrics.totalModels}</div>
                <div style={styles.statMeta}>Uploaded to Shopify Files</div>
              </div>

              <div style={styles.statCard}>
                <div style={styles.statLabel}>Coupons Redeemed</div>
                <div style={styles.statNumber}>{metrics.totalRedemptions}</div>
                <div style={styles.statMeta}>Discounts applied across plans</div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "20px",
                marginTop: "24px",
              }}
            >
              <div style={styles.panelCard}>
                <h3 style={styles.panelTitle}>🎟️ Coupon Management</h3>
                <p style={styles.panelText}>
                  You have {coupons.filter((c) => c.active).length} active
                  coupons and {coupons.filter((c) => c.autoApply).length} set to
                  automatically apply on the pricing page.
                </p>
                <div style={{ marginTop: "16px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("coupons");
                      setShowCreateCouponModal(true);
                    }}
                    style={styles.btnPrimary}
                  >
                    + Create New Coupon Code
                  </button>
                </div>
              </div>

              <div style={styles.panelCard}>
                <h3 style={styles.panelTitle}>🏪 Store Retention</h3>
                <p style={styles.panelText}>
                  {metrics.activeStoresCount} active store installs vs{" "}
                  {metrics.uninstalledStoresCount} uninstalls. View detailed
                  install dates, uninstalls, and models used.
                </p>
                <div style={{ marginTop: "16px" }}>
                  <button
                    type="button"
                    onClick={() => setActiveTab("stores")}
                    style={styles.btnSecondary}
                  >
                    Browse All Stores
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: COUPONS */}
        {activeTab === "coupons" && (
          <div>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Coupons & Promo Codes</h2>
                <p style={styles.sectionDesc}>
                  Create, update, toggle status, and track redemption limits for custom discounts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateCouponModal(true)}
                style={styles.btnPrimary}
              >
                + Create Coupon Code
              </button>
            </div>

            {/* Filter and Search Bar */}
            <div style={styles.filterBar}>
              <div style={styles.filterPills}>
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
                    style={
                      couponFilter === f.id
                        ? styles.filterPillActive
                        : styles.filterPill
                    }
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
                  style={styles.searchInput}
                />
                {couponSearch && (
                  <button
                    type="button"
                    onClick={() => setCouponSearch("")}
                    style={styles.btnSmall}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {filteredCoupons.length === 0 ? (
              <div style={styles.emptyCard}>
                <div style={{ fontSize: "36px", marginBottom: "8px" }}>🎟️</div>
                <div style={{ fontWeight: 600, fontSize: "16px" }}>
                  {coupons.length === 0
                    ? "No coupons created yet"
                    : "No coupons match your filter or search"}
                </div>
                <p
                  style={{
                    color: "#6b7280",
                    fontSize: "14px",
                    maxWidth: 400,
                    margin: "6px auto 16px",
                  }}
                >
                  {coupons.length === 0
                    ? "Create your first coupon to offer custom percentage discounts to stores subscribing to paid plans."
                    : "Try adjusting your search query or switching the status filter tab."}
                </p>
                {coupons.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setShowCreateCouponModal(true)}
                    style={styles.btnPrimary}
                  >
                    Create Coupon Code
                  </button>
                )}
              </div>
            ) : (
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Code & Promotion</th>
                      <th style={styles.th}>Discount</th>
                      <th style={styles.th}>Duration</th>
                      <th style={styles.th}>Dates</th>
                      <th style={styles.th}>Auto-Apply</th>
                      <th style={styles.th}>Banner</th>
                      <th style={styles.th}>Usage</th>
                      <th style={styles.th}>Status</th>
                      <th style={{ ...styles.th, textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCoupons.map((c: any) => {
                      const now = Date.now();
                      const startMs = c.startsAt
                        ? new Date(c.startsAt).getTime()
                        : 0;
                      const endMs = c.expiresAt
                        ? new Date(c.expiresAt).getTime()
                        : Infinity;
                      const isScheduled = startMs > now;
                      const isExpired = endMs <= now;
                      const limitReached =
                        c.usageLimit !== null &&
                        c.usageLimit !== undefined &&
                        c.usageCount >= c.usageLimit;

                      return (
                        <tr key={c.id} style={styles.tr}>
                          <td style={styles.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={styles.codeText}>{c.code}</span>
                              <button
                                type="button"
                                title="Copy code"
                                onClick={() => handleCopy(c.code, `Code "${c.code}"`)}
                                style={styles.iconBtn}
                              >
                                📋
                              </button>
                            </div>
                            <div style={styles.subText}>{c.description}</div>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  `/app/pricing?coupon=${c.code}`,
                                  `Pricing link for ${c.code}`,
                                )
                              }
                              style={styles.linkCopyBtn}
                            >
                              🔗 Copy pricing link
                            </button>
                          </td>
                          <td style={styles.td}>
                            <span style={styles.badgeDiscount}>
                              {c.discountLabel} off
                            </span>
                          </td>
                          <td style={styles.td}>{c.durationLabel}</td>
                          <td style={styles.td}>
                            <div style={{ fontSize: "12px" }}>
                              <div>
                                <span style={{ color: "#6b7280" }}>Start: </span>
                                {c.startsAt
                                  ? new Date(c.startsAt).toLocaleDateString()
                                  : "Immediate"}
                              </div>
                              <div>
                                <span style={{ color: "#6b7280" }}>End: </span>
                                {c.expiresAt ? (
                                  <span
                                    style={{
                                      color: isExpired ? "#dc2626" : "inherit",
                                      fontWeight: isExpired ? 600 : 400,
                                    }}
                                  >
                                    {new Date(c.expiresAt).toLocaleDateString()}
                                  </span>
                                ) : (
                                  "Never"
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={styles.td}>
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
                              style={
                                c.autoApply
                                  ? styles.badgeBlueClickable
                                  : styles.badgeGrayClickable
                              }
                            >
                              {c.autoApply ? "⚡ Auto-applied" : "Manual"}
                            </button>
                          </td>
                          <td style={styles.td}>
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
                                style={
                                  c.showBanner
                                    ? styles.badgeGreenClickable
                                    : styles.badgeGrayClickable
                                }
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
                          <td style={styles.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <button
                                type="button"
                                onClick={() => setSelectedCouponForRedemptions(c)}
                                style={styles.pillButton}
                                title="Click to view redeeming stores"
                              >
                                {c.usageCount}{" "}
                                {c.usageLimit ? `/ ${c.usageLimit}` : "uses"} 👁️
                              </button>
                              {c.usageCount > 0 && (
                                <button
                                  type="button"
                                  title="Reset usage counter back to 0"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        `Reset usage count for coupon ${c.code} back to 0?`,
                                      )
                                    ) {
                                      submit(
                                        { intent: "reset_usage", id: c.id },
                                        { method: "post" },
                                      );
                                    }
                                  }}
                                  style={styles.iconBtn}
                                >
                                  🔄
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={styles.td}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <div>
                                {!c.active ? (
                                  <span style={styles.badgeGray}>⏸️ Paused</span>
                                ) : limitReached ? (
                                  <span style={styles.badgeYellow}>
                                    🚫 Limit Reached
                                  </span>
                                ) : isExpired ? (
                                  <span style={styles.badgeRed}>🛑 Expired</span>
                                ) : isScheduled ? (
                                  <span style={styles.badgeYellow}>⏳ Scheduled</span>
                                ) : (
                                  <span style={styles.badgeGreen}>🟢 Active</span>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  submit(
                                    {
                                      intent: "toggle_coupon",
                                      id: c.id,
                                      active: (!c.active).toString(),
                                    },
                                    { method: "post" },
                                  )
                                }
                                style={
                                  c.active
                                    ? styles.btnStatusPause
                                    : styles.btnStatusActivate
                                }
                              >
                                {c.active ? "Pause" : "Activate"}
                              </button>
                            </div>
                          </td>
                          <td style={{ ...styles.td, textAlign: "right" }}>
                            <div
                              style={{
                                display: "inline-flex",
                                gap: "6px",
                                justifyContent: "flex-end",
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => setEditingCoupon(c)}
                                style={styles.btnActionEdit}
                                title="Edit coupon parameters"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  submit(
                                    { intent: "duplicate_coupon", id: c.id },
                                    { method: "post" },
                                  )
                                }
                                style={styles.btnSmall}
                                title="Duplicate this coupon"
                              >
                                👥 Clone
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (
                                    confirm(
                                      `Are you sure you want to permanently delete coupon "${c.code}"?`,
                                    )
                                  ) {
                                    submit(
                                      { intent: "delete_coupon", id: c.id },
                                      { method: "post" },
                                    );
                                  }
                                }}
                                style={styles.btnDangerSmall}
                                title="Delete coupon"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: STORES */}
        {activeTab === "stores" && (
          <div>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Stores & Lifecycle</h2>
                <p style={styles.sectionDesc}>
                  Live log of all installs, uninstalls, active subscription
                  plans, and models in use.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <input
                  type="text"
                  placeholder="Search store domain..."
                  value={storeSearch}
                  onChange={(e) => setStoreSearch(e.target.value)}
                  style={styles.searchInput}
                />
                <select
                  value={storeFilter}
                  onChange={(e: any) => setStoreFilter(e.target.value)}
                  style={styles.selectFilter}
                >
                  <option value="all">All Stores ({stores.length})</option>
                  <option value="active">
                    Active Only ({metrics?.activeStoresCount})
                  </option>
                  <option value="uninstalled">
                    Uninstalled Only ({metrics?.uninstalledStoresCount})
                  </option>
                  <option value="paid">
                    Paying Only ({metrics?.payingStoresCount})
                  </option>
                </select>
              </div>
            </div>

            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Store Domain</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Installed Date</th>
                    <th style={styles.th}>Uninstalled Date</th>
                    <th style={styles.th}>Current Plan</th>
                    <th style={styles.th}>Subscription</th>
                    <th style={styles.th}>3D Models</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStores.map((s) => (
                    <tr key={s.id} style={styles.tr}>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 600, color: "#111827" }}>
                          {s.shop}
                        </div>
                      </td>
                      <td style={styles.td}>
                        {s.isInstalled ? (
                          <span style={styles.badgeGreen}>Active</span>
                        ) : (
                          <span style={styles.badgeRed}>Uninstalled</span>
                        )}
                      </td>
                      <td style={styles.td}>
                        {new Date(s.installedAt).toLocaleString()}
                      </td>
                      <td style={styles.td}>
                        {s.uninstalledAt ? (
                          <span style={{ color: "#dc2626" }}>
                            {new Date(s.uninstalledAt).toLocaleString()}
                          </span>
                        ) : (
                          <span style={{ color: "#9ca3af" }}>—</span>
                        )}
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 600 }}>{s.planName}</div>
                        <div style={styles.subText}>${s.price}/mo</div>
                      </td>
                      <td style={styles.td}>
                        {s.subscriptionStatus === "active" ? (
                          <span style={styles.badgeGreen}>Active</span>
                        ) : (
                          <span style={styles.badgeGray}>
                            {s.subscriptionStatus}
                          </span>
                        )}
                      </td>
                      <td style={styles.td}>
                        <div style={{ fontWeight: 600 }}>
                          {s.modelCount} models
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredStores.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        style={{
                          textAlign: "center",
                          padding: "36px",
                          color: "#6b7280",
                        }}
                      >
                        No stores match your search or filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: ACTIVITY LOG */}
        {activeTab === "events" && (
          <div>
            <div style={styles.sectionHeader}>
              <div>
                <h2 style={styles.sectionTitle}>Real-time Activity Stream</h2>
                <p style={styles.sectionDesc}>
                  Live stream of all installs, reinstalls, uninstalls, plan
                  changes, and coupon redemptions.
                </p>
              </div>
            </div>

            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date & Time</th>
                    <th style={styles.th}>Store</th>
                    <th style={styles.th}>Event</th>
                    <th style={styles.th}>Event Details</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => {
                    let badgeStyle = styles.badgeBlue;
                    if (e.type === "install" || e.type === "reinstall")
                      badgeStyle = styles.badgeGreen;
                    if (e.type === "uninstall") badgeStyle = styles.badgeRed;
                    if (e.type === "coupon_used")
                      badgeStyle = styles.badgeYellow;

                    return (
                      <tr key={e.id} style={styles.tr}>
                        <td
                          style={{
                            ...styles.td,
                            whiteSpace: "nowrap",
                            color: "#6b7280",
                          }}
                        >
                          {new Date(e.createdAt).toLocaleString()}
                        </td>
                        <td style={{ ...styles.td, fontWeight: 600 }}>
                          {e.shop}
                        </td>
                        <td style={styles.td}>
                          <span style={badgeStyle}>
                            {e.type.replace("_", " ").toUpperCase()}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <pre style={styles.preCode}>
                            {e.detail || "No metadata"}
                          </pre>
                        </td>
                      </tr>
                    );
                  })}
                  {events.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{
                          textAlign: "center",
                          padding: "36px",
                          color: "#6b7280",
                        }}
                      >
                        No activity recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: CREATE COUPON */}
      {showCreateCouponModal && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
                Create New Coupon Code
              </h2>
              <button
                type="button"
                onClick={() => setShowCreateCouponModal(false)}
                style={styles.closeBtn}
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
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={styles.inputLabel}>
                    Coupon Code (e.g. SUMMER50, VIP25) *
                  </label>
                  <input
                    type="text"
                    name="code"
                    placeholder="SAVE30"
                    required
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Description / Promotion Title *
                  </label>
                  <input
                    type="text"
                    name="description"
                    placeholder="30% discount on all plans"
                    required
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Discount Percentage (1% - 100%) *
                  </label>
                  <input
                    type="number"
                    name="percentage"
                    placeholder="25"
                    min="1"
                    max="100"
                    required
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.inputLabel}>Discount Duration</label>
                  <select name="duration" style={styles.select}>
                    <option value="lifetime">
                      Lifetime (for as long as subscription runs)
                    </option>
                    <option value="1">1 billing period</option>
                    <option value="2">2 billing periods</option>
                    <option value="3">3 billing periods</option>
                    <option value="6">6 billing periods</option>
                    <option value="12">12 billing periods</option>
                  </select>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px",
                  }}
                >
                  <div>
                    <label style={styles.inputLabel}>Start Date (Optional)</label>
                    <input type="date" name="startsAt" style={styles.input} />
                  </div>
                  <div>
                    <label style={styles.inputLabel}>
                      Expiration Date (Optional)
                    </label>
                    <input type="date" name="expiresAt" style={styles.input} />
                  </div>
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Max Redemptions / Usage Limit (Optional)
                  </label>
                  <input
                    type="number"
                    name="usageLimit"
                    placeholder="Leave empty for unlimited uses"
                    min="1"
                    style={styles.input}
                  />
                </div>

                <div style={{ padding: "12px", background: "#f9fafb", borderRadius: "8px" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    <input type="checkbox" name="autoApply" value="true" />
                    Auto-apply automatically on the Pricing page
                  </label>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#6b7280",
                      margin: "4px 0 0 24px",
                    }}
                  >
                    Merchants visiting the pricing page will automatically
                    receive this discount without needing to enter the code.
                  </p>
                </div>

                {/* BANNER CONTROLS */}
                <div
                  style={{
                    padding: "16px",
                    background: "#f0fdf4",
                    borderRadius: "8px",
                    border: "1px solid #bbf7d0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: "14px",
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
                    <label style={styles.inputLabel}>
                      Where to show the banner (Placements)
                    </label>
                    <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          name="bannerPlacements"
                          value="pricing"
                          defaultChecked={true}
                        />
                        Pricing Page (/app/pricing)
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
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

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={styles.inputLabel}>
                        Is Closeable / Dismissible by Merchant?
                      </label>
                      <select
                        name="bannerDismissible"
                        defaultValue="true"
                        style={styles.select}
                      >
                        <option value="true">Yes — Closeable with (✕) button</option>
                        <option value="false">No — Persistent (Cannot be closed)</option>
                      </select>
                    </div>
                    <div>
                      <label style={styles.inputLabel}>
                        Banner Tone / Color Style
                      </label>
                      <select
                        name="bannerTone"
                        defaultValue="success"
                        style={styles.select}
                      >
                        <option value="success">Success (Green)</option>
                        <option value="info">Info (Blue)</option>
                        <option value="warning">Warning / Attention (Amber)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={styles.inputLabel}>
                      Custom Banner Heading (Title) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerHeading"
                      placeholder="e.g. 🎉 Special Offer: 20% Discount Auto-Applied!"
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.inputLabel}>
                      Custom Banner Message (Body Text) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerText"
                      placeholder="e.g. Upgrade today to get 20% discount auto-applied at checkout."
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.inputLabel}>
                      Button Text (Optional)
                    </label>
                    <input
                      type="text"
                      name="bannerButtonText"
                      placeholder="e.g. View Plans & Upgrade"
                      style={styles.input}
                    />
                  </div>
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Applicable Plans (Leave unchecked for all plans)
                  </label>
                  <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                    {plans.map((p) => (
                      <label
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          name="applicablePlans"
                          value={p.name}
                        />
                        {p.title || p.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "10px",
                    marginTop: "12px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowCreateCouponModal(false)}
                    style={styles.btnSecondary}
                  >
                    Cancel
                  </button>
                  <button type="submit" style={styles.btnPrimary}>
                    Create Coupon Code
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT COUPON */}
      {editingCoupon && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
                  ✏️ Edit Coupon: {editingCoupon.code}
                </h2>
                <div style={{ fontSize: "13px", color: "#6b7280" }}>
                  Update discount percentage, dates, usage limits, or active status
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCoupon(null)}
                style={styles.closeBtn}
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
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={styles.inputLabel}>
                    Coupon Code (e.g. SUMMER50, VIP25) *
                  </label>
                  <input
                    type="text"
                    name="code"
                    defaultValue={editingCoupon.code}
                    required
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Description / Promotion Title *
                  </label>
                  <input
                    type="text"
                    name="description"
                    defaultValue={editingCoupon.description}
                    required
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Discount Percentage (1% - 100%) *
                  </label>
                  <input
                    type="number"
                    name="percentage"
                    defaultValue={Math.round(editingCoupon.percentage * 100)}
                    min="1"
                    max="100"
                    required
                    style={styles.input}
                  />
                </div>

                <div>
                  <label style={styles.inputLabel}>Discount Duration</label>
                  <select
                    name="duration"
                    defaultValue={
                      editingCoupon.durationLimitInIntervals !== null &&
                      editingCoupon.durationLimitInIntervals !== undefined
                        ? String(editingCoupon.durationLimitInIntervals)
                        : "lifetime"
                    }
                    style={styles.select}
                  >
                    <option value="lifetime">
                      Lifetime (for as long as subscription runs)
                    </option>
                    <option value="1">1 billing period</option>
                    <option value="2">2 billing periods</option>
                    <option value="3">3 billing periods</option>
                    <option value="6">6 billing periods</option>
                    <option value="12">12 billing periods</option>
                  </select>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px",
                  }}
                >
                  <div>
                    <label style={styles.inputLabel}>Start Date (Optional)</label>
                    <input
                      type="date"
                      name="startsAt"
                      defaultValue={
                        editingCoupon.startsAt
                          ? editingCoupon.startsAt.slice(0, 10)
                          : ""
                      }
                      style={styles.input}
                    />
                  </div>
                  <div>
                    <label style={styles.inputLabel}>
                      Expiration Date (Optional)
                    </label>
                    <input
                      type="date"
                      name="expiresAt"
                      defaultValue={
                        editingCoupon.expiresAt
                          ? editingCoupon.expiresAt.slice(0, 10)
                          : ""
                      }
                      style={styles.input}
                    />
                  </div>
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Max Redemptions / Usage Limit (Optional)
                  </label>
                  <input
                    type="number"
                    name="usageLimit"
                    defaultValue={editingCoupon.usageLimit ?? ""}
                    placeholder="Leave empty for unlimited uses"
                    min="1"
                    style={styles.input}
                  />
                </div>

                <div
                  style={{
                    padding: "12px",
                    background: "#f9fafb",
                    borderRadius: "8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    <input
                      type="checkbox"
                      name="active"
                      value="true"
                      defaultChecked={editingCoupon.active}
                    />
                    Coupon is Active (uncheck to Pause/Disable)
                  </label>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    <input
                      type="checkbox"
                      name="autoApply"
                      value="true"
                      defaultChecked={editingCoupon.autoApply}
                    />
                    Auto-apply automatically on the Pricing page
                  </label>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "#6b7280",
                      margin: "0 0 0 24px",
                    }}
                  >
                    Merchants visiting the pricing page will automatically
                    receive this discount without needing to enter the code.
                  </p>
                </div>

                {/* BANNER CONTROLS */}
                <div
                  style={{
                    padding: "16px",
                    background: "#f0fdf4",
                    borderRadius: "8px",
                    border: "1px solid #bbf7d0",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontWeight: 700,
                        cursor: "pointer",
                        fontSize: "14px",
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
                    <label style={styles.inputLabel}>
                      Where to show the banner (Placements)
                    </label>
                    <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
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
                      <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
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

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    <div>
                      <label style={styles.inputLabel}>
                        Is Closeable / Dismissible by Merchant?
                      </label>
                      <select
                        name="bannerDismissible"
                        defaultValue={editingCoupon.bannerDismissible === false ? "false" : "true"}
                        style={styles.select}
                      >
                        <option value="true">Yes — Closeable with (✕) button</option>
                        <option value="false">No — Persistent (Cannot be closed)</option>
                      </select>
                    </div>
                    <div>
                      <label style={styles.inputLabel}>
                        Banner Tone / Color Style
                      </label>
                      <select
                        name="bannerTone"
                        defaultValue={editingCoupon.bannerTone || "success"}
                        style={styles.select}
                      >
                        <option value="success">Success (Green)</option>
                        <option value="info">Info (Blue)</option>
                        <option value="warning">Warning / Attention (Amber)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label style={styles.inputLabel}>
                      Custom Banner Heading (Title) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerHeading"
                      placeholder="e.g. 🎉 Special Offer: 20% Discount Auto-Applied!"
                      defaultValue={editingCoupon.bannerHeading || ""}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.inputLabel}>
                      Custom Banner Message (Body Text) — Optional
                    </label>
                    <input
                      type="text"
                      name="bannerText"
                      placeholder="e.g. Upgrade today to get 20% discount auto-applied at checkout."
                      defaultValue={editingCoupon.bannerText || ""}
                      style={styles.input}
                    />
                  </div>

                  <div>
                    <label style={styles.inputLabel}>
                      Button Text (Optional)
                    </label>
                    <input
                      type="text"
                      name="bannerButtonText"
                      placeholder="e.g. View Plans & Upgrade"
                      defaultValue={editingCoupon.bannerButtonText || ""}
                      style={styles.input}
                    />
                  </div>
                </div>

                <div>
                  <label style={styles.inputLabel}>
                    Applicable Plans (Leave unchecked for all plans)
                  </label>
                  <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
                    {plans.map((p: any) => (
                      <label
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "13px",
                          cursor: "pointer",
                        }}
                      >
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

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: "10px",
                    marginTop: "12px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditingCoupon(null)}
                    style={styles.btnSecondary}
                  >
                    Cancel
                  </button>
                  <button type="submit" style={styles.btnPrimary}>
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {copyFeedback && (
        <div style={styles.toastBanner}>
          <span>📋</span> {copyFeedback}
        </div>
      )}
      {selectedCouponForRedemptions && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <div style={styles.modalHeader}>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>
                  Redemptions for {selectedCouponForRedemptions.code}
                </h2>
                <div style={{ fontSize: "13px", color: "#6b7280" }}>
                  Used {selectedCouponForRedemptions.usageCount} times
                </div>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {selectedCouponForRedemptions.redemptions?.length > 0 && (
                  <button
                    type="button"
                    onClick={() => exportRedemptionsCsv(selectedCouponForRedemptions)}
                    style={styles.btnSmall}
                    title="Export list to CSV"
                  >
                    📥 Export CSV
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedCouponForRedemptions(null)}
                  style={styles.closeBtn}
                >
                  ✕
                </button>
              </div>
            </div>

            {selectedCouponForRedemptions.redemptions?.length === 0 ? (
              <div
                style={{
                  padding: "36px",
                  textAlign: "center",
                  color: "#6b7280",
                }}
              >
                No stores have redeemed this coupon code yet.
              </div>
            ) : (
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Store Domain</th>
                      <th style={styles.th}>Plan</th>
                      <th style={styles.th}>Redeemed Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCouponForRedemptions.redemptions.map((r: any) => (
                      <tr key={r.id} style={styles.tr}>
                        <td style={{ ...styles.td, fontWeight: 600 }}>
                          {r.shop}
                        </td>
                        <td style={styles.td}>{r.planName || "Subscription"}</td>
                        <td style={styles.td}>
                          {new Date(r.redeemedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: "16px",
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedCouponForRedemptions(null)}
                style={styles.btnSecondary}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StandaloneAdminPortal() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<{
    ok?: boolean;
    error?: string;
    message?: string;
  }>();
  const submit = useSubmit();

  if (!data.authorized) {
    return <StandaloneAdminLogin actionData={actionData} submit={submit} />;
  }

  return (
    <StandaloneAdminDashboard
      data={data}
      actionData={actionData}
      submit={submit}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  appWrap: {
    minHeight: "100vh",
    backgroundColor: "#f9fafb",
    color: "#111827",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
  },
  header: {
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e5e7eb",
    padding: "16px 32px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandGroup: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  logoBadge: {
    width: "38px",
    height: "38px",
    backgroundColor: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
    fontSize: "18px",
    borderRadius: "10px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#111827",
  },
  brandSub: {
    fontSize: "12px",
    color: "#6b7280",
  },
  liveIndicator: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "12px",
    fontWeight: 600,
    color: "#16a34a",
    background: "#f0fdf4",
    padding: "4px 10px",
    borderRadius: "20px",
    border: "1px solid #bbf7d0",
  },
  pulseDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: "#16a34a",
  },
  btnLogout: {
    padding: "6px 14px",
    borderRadius: "6px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    color: "#374151",
  },
  container: {
    maxWidth: "1400px",
    margin: "0 auto",
    padding: "24px 32px 60px",
  },
  tabBar: {
    display: "flex",
    gap: "8px",
    borderBottom: "1px solid #e5e7eb",
    marginBottom: "24px",
    overflowX: "auto",
  },
  tabItem: {
    padding: "10px 18px",
    fontSize: "14px",
    fontWeight: 600,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    color: "#6b7280",
    borderBottom: "2px solid transparent",
    whiteSpace: "nowrap",
  },
  tabItemActive: {
    color: "#2563eb",
    borderBottomColor: "#2563eb",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "16px",
    marginBottom: "24px",
  },
  statCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
  },
  statLabel: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#6b7280",
  },
  statNumber: {
    fontSize: "28px",
    fontWeight: 700,
    color: "#111827",
    lineHeight: 1.1,
  },
  statMeta: {
    fontSize: "12px",
    color: "#9ca3af",
  },
  panelCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "24px",
  },
  panelTitle: {
    margin: "0 0 8px",
    fontSize: "16px",
    fontWeight: 700,
  },
  panelText: {
    margin: 0,
    fontSize: "14px",
    color: "#6b7280",
    lineHeight: 1.5,
  },
  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "18px",
    flexWrap: "wrap",
    gap: "12px",
  },
  sectionTitle: {
    margin: "0 0 4px",
    fontSize: "18px",
    fontWeight: 700,
  },
  sectionDesc: {
    margin: 0,
    fontSize: "13px",
    color: "#6b7280",
  },
  tableWrapper: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "13px",
    textAlign: "left",
  },
  th: {
    backgroundColor: "#f9fafb",
    color: "#4b5563",
    fontWeight: 600,
    padding: "12px 16px",
    borderBottom: "1px solid #e5e7eb",
  },
  tr: {
    borderBottom: "1px solid #f3f4f6",
  },
  td: {
    padding: "14px 16px",
    verticalAlign: "middle",
  },
  codeText: {
    fontWeight: 700,
    fontFamily: "monospace",
    fontSize: "14px",
    color: "#111827",
  },
  subText: {
    fontSize: "12px",
    color: "#6b7280",
  },
  badgeDiscount: {
    fontWeight: 700,
    color: "#16a34a",
    background: "#f0fdf4",
    padding: "3px 8px",
    borderRadius: "4px",
    fontSize: "12px",
  },
  badgeGreen: {
    backgroundColor: "#dcfce7",
    color: "#15803d",
    fontSize: "12px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
  },
  badgeRed: {
    backgroundColor: "#fee2e2",
    color: "#b91c1c",
    fontSize: "12px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
  },
  badgeYellow: {
    backgroundColor: "#fef3c7",
    color: "#b45309",
    fontSize: "12px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
  },
  badgeBlue: {
    backgroundColor: "#dbeafe",
    color: "#1d4ed8",
    fontSize: "12px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
  },
  badgeGray: {
    backgroundColor: "#f3f4f6",
    color: "#4b5563",
    fontSize: "12px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
  },
  pillButton: {
    backgroundColor: "#f3f4f6",
    border: "1px solid #e5e7eb",
    borderRadius: "4px",
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 600,
    color: "#374151",
  },
  btnPrimary: {
    backgroundColor: "#2563eb",
    color: "#ffffff",
    border: "none",
    padding: "8px 16px",
    borderRadius: "6px",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
  },
  btnPrimaryFull: {
    backgroundColor: "#2563eb",
    color: "#ffffff",
    border: "none",
    padding: "12px",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "14px",
    width: "100%",
    cursor: "pointer",
  },
  btnSecondary: {
    backgroundColor: "#ffffff",
    color: "#374151",
    border: "1px solid #d1d5db",
    padding: "8px 16px",
    borderRadius: "6px",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
  },
  btnSmall: {
    backgroundColor: "#ffffff",
    color: "#374151",
    border: "1px solid #d1d5db",
    padding: "4px 10px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  toastBanner: {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    backgroundColor: "#111827",
    color: "#ffffff",
    padding: "12px 20px",
    borderRadius: "8px",
    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.2)",
    fontSize: "13px",
    fontWeight: 600,
    zIndex: 10000,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  filterBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
    flexWrap: "wrap",
    gap: "12px",
  },
  filterPills: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  filterPill: {
    padding: "6px 12px",
    borderRadius: "20px",
    border: "1px solid #d1d5db",
    backgroundColor: "#ffffff",
    color: "#4b5563",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  filterPillActive: {
    padding: "6px 12px",
    borderRadius: "20px",
    border: "1px solid #2563eb",
    backgroundColor: "#eff6ff",
    color: "#1d4ed8",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: "13px",
    padding: "2px 4px",
    borderRadius: "4px",
  },
  linkCopyBtn: {
    display: "inline-block",
    marginTop: "4px",
    background: "none",
    border: "none",
    color: "#2563eb",
    fontSize: "11px",
    cursor: "pointer",
    padding: 0,
    fontWeight: 500,
    textAlign: "left",
  },
  badgeBlueClickable: {
    backgroundColor: "#dbeafe",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
    fontSize: "11px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
    cursor: "pointer",
  },
  badgeGreenClickable: {
    backgroundColor: "#dcfce7",
    color: "#15803d",
    border: "1px solid #bbf7d0",
    fontSize: "11px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
    cursor: "pointer",
  },
  badgeGrayClickable: {
    backgroundColor: "#f3f4f6",
    color: "#6b7280",
    border: "1px solid #e5e7eb",
    fontSize: "11px",
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: "4px",
    cursor: "pointer",
  },
  btnStatusPause: {
    backgroundColor: "#fffbeb",
    color: "#b45309",
    border: "1px solid #fde68a",
    padding: "3px 8px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
    width: "fit-content",
  },
  btnStatusActivate: {
    backgroundColor: "#f0fdf4",
    color: "#15803d",
    border: "1px solid #bbf7d0",
    padding: "3px 8px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    cursor: "pointer",
    width: "fit-content",
  },
  btnActionEdit: {
    backgroundColor: "#eff6ff",
    color: "#1d4ed8",
    border: "1px solid #bfdbfe",
    padding: "4px 10px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnDangerSmall: {
    backgroundColor: "#ffffff",
    color: "#dc2626",
    border: "1px solid #fca5a5",
    padding: "4px 10px",
    borderRadius: "4px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
  },
  searchInput: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #d1d5db",
    fontSize: "13px",
    outline: "none",
    width: "220px",
  },
  selectFilter: {
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid #d1d5db",
    fontSize: "13px",
    backgroundColor: "#ffffff",
    outline: "none",
  },
  preCode: {
    margin: 0,
    fontFamily: "monospace",
    fontSize: "12px",
    backgroundColor: "#f9fafb",
    padding: "6px 8px",
    borderRadius: "4px",
    border: "1px solid #f3f4f6",
    maxHeight: "60px",
    overflow: "auto",
  },
  modalOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: "16px",
  },
  modalContent: {
    backgroundColor: "#ffffff",
    borderRadius: "12px",
    maxWidth: "600px",
    width: "100%",
    maxHeight: "90vh",
    overflowY: "auto",
    padding: "24px",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "18px",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    fontSize: "18px",
    cursor: "pointer",
    color: "#9ca3af",
  },
  inputLabel: {
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    marginBottom: "4px",
    color: "#374151",
  },
  input: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: "6px",
    border: "1px solid #d1d5db",
    fontSize: "14px",
    boxSizing: "border-box",
    outline: "none",
  },
  select: {
    width: "100%",
    padding: "9px 12px",
    borderRadius: "6px",
    border: "1px solid #d1d5db",
    fontSize: "14px",
    backgroundColor: "#ffffff",
    boxSizing: "border-box",
    outline: "none",
  },
  emptyCard: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "48px 24px",
    textAlign: "center",
  },
  alertSuccess: {
    backgroundColor: "#ecfdf5",
    color: "#065f46",
    border: "1px solid #a7f3d0",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  alertError: {
    backgroundColor: "#fef2f2",
    color: "#991b1b",
    border: "1px solid #fecaca",
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "16px",
    fontSize: "14px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  loginWrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f3f4f6",
    padding: "16px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif",
  },
  loginCard: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    padding: "36px",
    maxWidth: "420px",
    width: "100%",
    boxShadow:
      "0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)",
    border: "1px solid #e5e7eb",
  },
  loginHeader: {
    textAlign: "center",
    marginBottom: "24px",
  },
  loginIcon: {
    fontSize: "42px",
    marginBottom: "12px",
  },
  loginTitle: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#111827",
    margin: "0 0 6px",
  },
  loginSub: {
    fontSize: "13px",
    color: "#6b7280",
    lineHeight: 1.5,
    margin: 0,
  },
  eyeBtn: {
    position: "absolute",
    right: "10px",
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    fontSize: "12px",
    fontWeight: 600,
    color: "#6b7280",
    cursor: "pointer",
  },
};
