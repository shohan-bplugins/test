import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resolveAppOrigin } from "~/lib/app-origin.server";
import { syncModelLibrary } from "~/lib/model-library.server";
import { resolveFile } from "~/lib/files.server";
import {
  modelQuotaError,
  uploadModelToLibrary,
} from "~/lib/model-upload.server";
import {
  describeSaving,
  MAX_MODEL_FILE_SIZE_MB,
  MAX_RAW_UPLOAD_MB,
  needsOptimizationToFit,
  validateModelFile,
} from "~/lib/files";
import {
  OPTIMIZE_DETAILS,
  useOptimizePreference,
} from "~/components/useOptimizePreference";
import { buildEmbedSnippet } from "~/lib/embed";
import {
  countDistinctModels,
  getAssignedModelGidsCached,
  getPlanLimitForShop,
} from "~/lib/billing.server";
import { formatLimit } from "~/lib/billing-constants";

import { BackButton } from "~/components/BackButton";
import { SupportAction } from "~/components/SupportAction";
import { ConfirmModal } from "~/components/polaris/ConfirmModal";
import {
  fieldChecked,
  fieldValue,
  flag,
  useRouteNav,
} from "~/components/polaris/helpers";
import { FilePickerDialog } from "~/components/FilePickerDialog";
import type { FileItem } from "~/routes/api.files";
import {
  cancelQueuedUploads,
  clearFinishedUploads,
  enqueueUploads,
  getServerUploads,
  getUploads,
  onModelUploaded,
  removeUpload,
  restoreUploads,
  retryFailedUploads,
  subscribeUploads,
  type UploadItem,
} from "~/lib/upload-queue";

// The three things a row can put on the clipboard. "id" is the one the
// "3D Viewer — Any Model" theme block wants; "embed" is the iframe for pages a
// theme block can't reach.
type CopyKind = "id" | "url" | "embed";

const COPY_LABELS: Record<CopyKind, string> = {
  id: "Model ID",
  url: "File URL",
  embed: "Embed code",
};

/**
 * How many missing file sizes to repair per load of this page. See the backfill
 * in the loader for why this is capped rather than exhaustive.
 */
const SIZE_BACKFILL_PER_LOAD = 10;

const UPLOAD_STATUS: Record<
  UploadItem["status"],
  { label: string; tone: "neutral" | "info" | "success" | "critical" }
> = {
  queued: { label: "Waiting", tone: "neutral" },
  uploading: { label: "Uploading", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  done: { label: "Added", tone: "success" },
  error: { label: "Failed", tone: "critical" },
};

type ModelRow = {
  id: string;
  name: string;
  fileUrl: string;
  fileSize: number | null;
  /** ISO, kept for sorting — never rendered. */
  createdAt: string;
  /** Preformatted date and time; see formatDateTime. */
  createdAtLabel: string;
};

type LoaderData = {
  models: ModelRow[];
  totalCount: number;
  planName: string;
  planLimit: number;
  productModelCount: number;
  distinctModelsUsed: number;
  appOrigin: string;
  /** Scopes the browser's saved upload queue to this shop. */
  shop: string;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  const [models, planInfo, assignedModels] = await Promise.all([
    prisma.model3D.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      // Only what the list shows and the repairs read — not each row's
      // `config` blob, which nothing on this page uses.
      select: {
        id: true,
        name: true,
        fileGid: true,
        fileUrl: true,
        fileSize: true,
        createdAt: true,
      },
    }),
    getPlanLimitForShop(shop),
    getAssignedModelGidsCached(admin, shop),
  ]);
  const distinctModelsUsed = countDistinctModels(
    models.map((m) => m.fileGid),
    assignedModels.gids,
  );

  /*
   * Fill in what Shopify knows but this row does not.
   *
   * A missing URL is always repaired — the model is unusable without one, and
   * it is rare. A missing *size* is neither: every model imported from Shopify
   * Files before this was recorded has one, so a large library could be
   * hundreds of rows, and each repair is its own round trip. Repairing them all
   * on one page load would turn opening the library into a minutes-long stall.
   *
   * So size-only repairs are capped per load. The rows fill in over the next
   * few visits, and the cost of any single visit stays bounded.
   */
  const repair = async (m: (typeof models)[number], mutate: boolean) => {
    const resolved = await resolveFile(admin, m.fileGid);
    if (!resolved) return false;

    const data: { fileUrl?: string; fileSize?: number } = {};
    if (!m.fileUrl && resolved.url) {
      if (mutate) m.fileUrl = resolved.url;
      data.fileUrl = resolved.url;
    }
    if (m.fileSize == null && resolved.size != null) {
      if (mutate) m.fileSize = resolved.size;
      data.fileSize = resolved.size;
    }
    if (Object.keys(data).length === 0) return false;

    await prisma.model3D.update({ where: { id: m.id }, data });
    // Only a newly resolved URL changes what the theme block can see; a size
    // is display-only, so it must not trigger a library re-sync.
    return Boolean(data.fileUrl);
  };

  /*
   * A missing URL is repaired before responding. The model is unusable without
   * one — it is what the theme block reads — and it is rare, so the wait is
   * both justified and almost never paid.
   */
  const needsUrl = models.filter((m) => !m.fileUrl);
  if (needsUrl.length > 0) {
    const repaired = await Promise.all(needsUrl.map((m) => repair(m, true)));
    // Entries without a file URL are omitted from the mirror, so resolving one
    // here means the library the theme block sees is now out of date. Synced
    // beside the response, not in front of it: it is ~6 sequential Shopify and
    // Mongo calls (2–3s) and this page renders from `models`, not the mirror.
    if (repaired.some(Boolean)) void syncModelLibrary(admin, shop);
  }

  /*
   * Missing sizes are repaired beside the response instead of in front of it.
   *
   * Ten rows was ten Shopify round trips and ten Mongo writes on the critical
   * path of every visit until the library finished filling in, to populate a
   * display-only column. The design already accepted that these appear over
   * several visits rather than all at once; detaching the work costs one more
   * visit before a given row shows its size, and takes the whole batch off
   * TTFB. `mutate: false` because this response has already been decided —
   * writing into `models` now would change nothing and only mislead a reader.
   */
  const needsSize = models
    .filter((m) => m.fileUrl && m.fileSize == null)
    .slice(0, SIZE_BACKFILL_PER_LOAD);
  if (needsSize.length > 0) {
    void Promise.all(needsSize.map((m) => repair(m, false))).catch((err) => {
      console.error("[models] background size backfill failed", err);
    });
  }

  return {
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      fileUrl: m.fileUrl,
      fileSize: m.fileSize ?? null,
      createdAt: m.createdAt.toISOString(),
      createdAtLabel: formatDateTime(m.createdAt),
    })),
    totalCount: models.length,
    planName: planInfo.planName,
    planLimit: planInfo.modelLimit,
    productModelCount: assignedModels.count,
    distinctModelsUsed,
    appOrigin: resolveAppOrigin(request),
    shop,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, error: "Missing model id" };
    await prisma.model3D.delete({ where: { id } });
    await syncModelLibrary(admin, shop);
    return { ok: true, message: "Model deleted from library" };
  }

  if (intent === "bulk_delete") {
    const raw = String(formData.get("ids") ?? "");
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nothing selected" };
    }
    const result = await prisma.model3D.deleteMany({
      where: { shop, id: { in: ids } },
    });
    await syncModelLibrary(admin, shop);
    return {
      ok: true,
      message: `${result.count} model${result.count === 1 ? "" : "s"} deleted`,
    };
  }

  const quotaError = await modelQuotaError(admin, shop);
  if (quotaError) return { ok: false, error: quotaError };

  if (intent === "assign_existing") {
    const fileGid = String(formData.get("fileGid") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!fileGid.startsWith("gid://shopify/")) {
      return { ok: false, error: "Invalid file id" };
    }
    // resolveFile, not resolveFileUrl: this path stored no size at all, so
    // every model imported from Shopify Files showed a dash in the Size column
    // while uploaded ones showed a real figure.
    const resolved = await resolveFile(admin, fileGid);
    if (!resolved) return { ok: false, error: "Could not resolve file URL" };
    const { url: fileUrl, size: fileSize } = resolved;
    const finalName =
      name ||
      decodeURIComponent(fileUrl.split("?")[0]?.split("/").pop() ?? "Model");
    const created = await prisma.model3D.create({
      data: { shop, name: finalName, fileGid, fileUrl, fileSize },
    });
    await syncModelLibrary(admin, shop);
    return { ok: true, message: "Model added to library", id: created.id };
  }

  // Uploads go through /api/models/upload, one request per file, so this route
  // only handles them if something still posts here directly.
  const result = await uploadModelToLibrary(
    admin,
    shop,
    formData.get("file") as File | null,
    formData.get("name") as string | null,
  );
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, message: "Model uploaded to library", id: result.id };
};

function formatBytes(n: number | null) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * "Added" as a date *and* time, formatted on the server.
 *
 * Formatted in the loader rather than the component on purpose. The page is
 * server-rendered, so a toLocale* call in the component runs twice — once in
 * Node and again in the browser — and the two disagree whenever their locale or
 * timezone differs, which React reports as a hydration mismatch. A date alone
 * mostly survived that; adding a time makes any timezone offset visible, so it
 * would break routinely rather than occasionally.
 *
 * The trade-off is that this is the *server's* timezone, not the merchant's.
 * That is the same choice the dashboard's month labels already make, for the
 * same reason, and it is at least consistent between the two.
 */
function formatDateTime(value: Date) {
  try {
    return value.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}

type SortKey = "newest" | "oldest" | "name" | "size";

function sortModels(models: ModelRow[], sort: SortKey): ModelRow[] {
  const copy = [...models];
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "oldest":
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "name":
      return copy.sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      );
    case "size":
      return copy.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
  }
}

export default function ModelsIndex() {
  const {
    models,
    totalCount,
    planName,
    planLimit,
    productModelCount,
    distinctModelsUsed,
    appOrigin,
    shop,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const routeTo = useRouteNav();
  const submitting = navigation.state === "submitting";
  const revalidator = useRevalidator();
  const uploads = useSyncExternalStore(
    subscribeUploads,
    getUploads,
    getServerUploads,
  );
  const uploading = uploads.some(
    (u) =>
      u.status === "queued" ||
      u.status === "uploading" ||
      u.status === "processing",
  );

  // Resume whatever an earlier visit left unfinished — after a reload, a
  // closed tab, or a trip to another page — and refresh the list when a batch
  // lands. See upload-queue.ts.
  useEffect(() => {
    void restoreUploads(shop);
  }, [shop]);
  // Refresh the library after every file that lands, so the table fills in
  // as the batch goes rather than all at once at the end. Through a ref so the
  // subscription isn't torn down and rebuilt on every progress tick.
  const revalidateRef = useRef(revalidator.revalidate);
  revalidateRef.current = revalidator.revalidate;
  useEffect(() => onModelUploaded(() => void revalidateRef.current()), []);

  const [pickerOpen, setPickerOpen] = useState(false);
  // Was just the row id, which was enough while a row had one copy button. Now
  // that a row can copy three different things, the kind has to be part of the
  // state or clicking "ID" would flash "Copied" on the URL button too.
  const [copying, setCopying] = useState<{
    id: string;
    kind: CopyKind;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  // Which delete the merchant is being asked to confirm. `null` means no
  // dialog; a string is a single row; "bulk" is the whole selection.
  const [pendingDelete, setPendingDelete] = useState<string | "bulk" | null>(
    null,
  );

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message ?? "Done");
      setSelected(new Set());
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const totalInUse = distinctModelsUsed;
  const limitReached = totalInUse >= planLimit;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? models.filter((m) => m.name.toLowerCase().includes(q))
      : models;
    return sortModels(matched, sort);
  }, [models, query, sort]);

  function handleFilePicked(file: FileItem) {
    const fd = new FormData();
    fd.set("intent", "assign_existing");
    fd.set("fileGid", file.id);
    fd.set("name", file.name);
    submit(fd, { method: "post" });
  }

  /**
   * Queue whatever the drop zone just received, one file or many, whether it
   * arrived by drop or by the file dialog — s-drop-zone reports both the same
   * way. The queue (upload-queue.ts) does the rest. The input holding the files
   * lives in the drop zone's shadow DOM, so no form on this route could carry
   * them anyway.
   */
  /*
   * Files waiting for the merchant to confirm them. Several files are shown
   * here first rather than sent at once, so anything that can't be added is
   * visible — and removable — before a single byte goes up.
   *
   * Only the File is kept; each one's problem is worked out on every render.
   * The plan-limit one has to be: it depends on how many files are ahead of it
   * in the list, so removing one row can clear the error on another.
   */
  const [staged, setStaged] = useState<{ key: string; file: File }[]>([]);
  const [optimize, setOptimize] = useOptimizePreference();
  const limitMessage = `Over your ${planName} plan limit of ${formatLimit(planLimit)} models.`;
  // Room left on the plan, net of files already queued or uploading.
  const room =
    planLimit -
    totalInUse -
    uploads.filter(
      (u) =>
        u.status === "queued" ||
        u.status === "uploading" ||
        u.status === "processing",
    ).length;
  const stagedRows = useMemo(() => {
    let left = room;
    return staged.map((s) => {
      const fileError = validateModelFile(s.file, optimize);
      if (fileError) return { ...s, error: fileError };
      if (left <= 0) return { ...s, error: limitMessage };
      left--;
      return { ...s, error: null };
    });
  }, [staged, room, limitMessage, optimize]);
  const stagedErrors = stagedRows.filter((r) => r.error).length;
  const stagedBlocked = stagedRows.length === 0 || stagedErrors > 0;

  function handleFiles(event: Event) {
    const input = event.currentTarget as HTMLElement & {
      files?: FileList | null;
    };
    const files = Array.from(input.files ?? []);
    // Empty the zone so picking the same file again still fires onInput.
    try {
      (input as HTMLElement & { value?: string }).value = "";
    } catch {
      // Older polaris.js without a settable value; harmless.
    }
    if (files.length === 0) return;

    // One good file, with nothing already waiting for review, needs no
    // confirmation — it goes straight up, as a single upload always has.
    if (
      staged.length === 0 &&
      files.length === 1 &&
      !validateModelFile(files[0], optimize) &&
      room > 0
    ) {
      enqueueUploads(
        shop,
        files,
        planLimit - totalInUse,
        limitMessage,
        optimize,
      );
      return;
    }
    setStaged((prev) => [
      ...prev,
      ...files.map((file) => ({ key: crypto.randomUUID(), file })),
    ]);
  }

  function confirmStaged() {
    if (stagedBlocked) return;
    enqueueUploads(
      shop,
      staged.map((s) => s.file),
      planLimit - totalInUse,
      limitMessage,
      optimize,
    );
    setStaged([]);
  }

  // Bytes landed across the batch, counting a finished file as whole and a
  // failed one not at all — so the bar ends full even when some failed.
  const uploadProgress = useMemo(() => {
    const counted = uploads.filter((u) => u.status !== "error");
    const total = counted.reduce((n, u) => n + u.size, 0);
    const sent = counted.reduce(
      (n, u) =>
        n +
        (u.status === "done" || u.status === "processing"
          ? u.size
          : u.status === "uploading"
            ? (u.loaded ?? 0)
            : 0),
      0,
    );
    return total > 0 ? Math.min(1, sent / total) : 1;
  }, [uploads]);
  const uploadsDone = uploads.filter((u) => u.status === "done").length;
  const uploadsFailed = uploads.filter((u) => u.status === "error").length;
  const uploadsRetryable = uploads.some((u) => u.status === "error" && u.file);

  async function handleCopy(id: string, kind: CopyKind, value: string) {
    setCopying({ id, kind });
    try {
      await navigator.clipboard.writeText(value);
      shopify.toast.show(`${COPY_LABELS[kind]} copied`);
    } catch {
      shopify.toast.show(`Couldn't copy ${COPY_LABELS[kind].toLowerCase()}`, {
        isError: true,
      });
    } finally {
      setTimeout(() => setCopying(null), 600);
    }
  }

  // Responsive mode, so the snippet needs no height and a row doesn't have to
  // carry each model's saved config just to offer an embed code.
  function embedFor(id: string) {
    return buildEmbedSnippet(`${appOrigin}/viewer/${id}`, 500, "responsive");
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function confirmDelete() {
    if (pendingDelete === null) return;
    const fd = new FormData();
    if (pendingDelete === "bulk") {
      fd.set("intent", "bulk_delete");
      fd.set("ids", Array.from(selected).join(","));
    } else {
      fd.set("intent", "delete");
      fd.set("id", pendingDelete);
    }
    submit(fd, { method: "post" });
    setPendingDelete(null);
  }

  const allSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  /**
   * The copy/customize/delete actions a row offers, in an overflow menu.
   *
   * s-menu is an overlay, not inline content: it stays hidden until something
   * targets its id, so the trigger button beside it is required — rendering the
   * menu on its own puts five invisible buttons in the cell and nothing else.
   */
  function rowActions(m: ModelRow) {
    const copied = (kind: CopyKind) =>
      copying?.id === m.id && copying.kind === kind;
    const menuId = `model-actions-${m.id}`;
    return (
      <>
        <s-button
          variant="tertiary"
          icon="menu-horizontal"
          accessibilityLabel={`Actions for ${m.name}`}
          commandFor={menuId}
          command="--show"
        />
        <s-menu id={menuId} accessibilityLabel={`Actions for ${m.name}`}>
          <s-button
            icon={copied("id") ? "check" : "clipboard"}
            onClick={() => handleCopy(m.id, "id", m.id)}
          >
            Copy model ID
          </s-button>
          <s-button
            icon={copied("embed") ? "check" : "code"}
            onClick={() => handleCopy(m.id, "embed", embedFor(m.id))}
          >
            Copy embed code
          </s-button>
          <s-button
            icon={copied("url") ? "check" : "link"}
            onClick={() => handleCopy(m.id, "url", m.fileUrl)}
          >
            Copy file URL
          </s-button>
          <s-button
            icon="settings"
            href={`/app/models/${m.id}`}
            onClick={routeTo(`/app/models/${m.id}`)}
          >
            Customize
          </s-button>
          {/*
            Two steps, and both are needed.

            `command="--hide"` closes the menu explicitly, and the dialog is
            opened on the next frame rather than in this handler. A menu and a
            modal are both overlays: opening the second while the first is still
            dismissing means the menu's teardown runs last and takes the dialog
            down with it, so the confirmation never appears and the model can
            never be deleted. Deferring by one frame lets the menu finish first.

            The copy items above need neither, because they change no overlay —
            which is why they kept working while this did not.
          */}
          <s-button
            tone="critical"
            icon="delete"
            commandFor={menuId}
            command="--hide"
            onClick={() => requestAnimationFrame(() => setPendingDelete(m.id))}
          >
            Delete
          </s-button>
        </s-menu>
      </>
    );
  }

  const deletingCount = pendingDelete === "bulk" ? selected.size : 1;

  return (
    <s-page heading="3D model library">
      <BackButton to="/app" label="Dashboard" />

      <s-button
        slot="primary-action"
        variant="primary"
        icon="folder"
        disabled={flag(submitting || limitReached)}
        onClick={() => setPickerOpen(true)}
        accessibilityLabel="Open file picker to choose a 3D model from Shopify Files"
      >
        Choose from Files
      </s-button>
      <SupportAction />

      <FilePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentUrl={null}
        onSelect={handleFilePicked}
      />

      <ConfirmModal
        id="delete-models"
        open={pendingDelete !== null}
        heading={
          deletingCount === 1
            ? "Delete model?"
            : `Delete ${deletingCount} models?`
        }
        confirmLabel={deletingCount === 1 ? "Delete model" : "Delete models"}
        loading={submitting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        <s-paragraph>
          {deletingCount === 1
            ? "This removes the model from your library."
            : `This removes ${deletingCount} models from your library.`}{" "}
          The .glb file itself stays in Shopify Files, and any page still
          embedding the model will stop rendering it.
        </s-paragraph>
      </ConfirmModal>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph color="subdued">
            Manage standalone 3D models you embed with the “3D Viewer — Any
            Model” theme block.
          </s-paragraph>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-badge icon="three-d-environment">{`${planName} plan`}</s-badge>
            <s-badge tone={limitReached ? "critical" : "neutral"}>
              {`${totalInUse} / ${formatLimit(planLimit)} models`}
            </s-badge>
          </s-stack>
        </s-stack>
      </s-section>

      {limitReached ? (
        <s-banner tone="warning" heading="Plan limit reached">
          <s-paragraph>
            {totalCount} model{totalCount === 1 ? "" : "s"} in your library,{" "}
            {productModelCount} product assignment
            {productModelCount === 1 ? "" : "s"} (files used in both count
            once).
          </s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            href="/app/pricing"
            onClick={routeTo("/app/pricing")}
          >
            Upgrade plan
          </s-button>
        </s-banner>
      ) : null}

      <s-section heading="Add a model">
        {/*
          Polaris's own drop zone, rather than a div with drag handlers. It
          brings the admin's drag-over and rejected-file states with it, and
          more importantly it is keyboard reachable and announced — the hand
          rolled version was a div with role="button" that screen readers had
          no way to describe as a file target.
        */}
        {/*
          No `accept` filter on purpose. Polaris drops files that don't match
          it before onInput ever sees them, and its `droprejected` event says
          nothing about which — so a wrong file just vanished, and a drop of
          only wrong files did nothing at all. Every file comes through instead,
          and enqueueUploads checks type, size and plan room in the browser,
          listing each refused file with its reason before anything is sent.
        */}
        <s-drop-zone
          label="Drop .glb or .gltf files here, or click to choose"
          multiple
          disabled={flag(limitReached || submitting)}
          onInput={handleFiles}
        />
        <s-paragraph color="subdued">
          Add several at once. Each stored file can be up to{" "}
          {MAX_MODEL_FILE_SIZE_MB} MB.
          {optimize
            ? ` With optimization on you can upload up to ${MAX_RAW_UPLOAD_MB} MB; the size is checked after compression.`
            : ""}
        </s-paragraph>
        <s-checkbox
          label="Optimize for faster loading"
          details={OPTIMIZE_DETAILS}
          checked={flag(optimize)}
          onInput={(e) => setOptimize(fieldChecked(e))}
        />
        {stagedRows.length > 0 ? (
          <s-stack direction="block" gap="small">
            <s-text type="strong">
              {`${stagedRows.length} file${stagedRows.length === 1 ? "" : "s"} ready to upload`}
            </s-text>
            {stagedErrors > 0 ? (
              <s-banner tone="critical">
                <s-paragraph>
                  {stagedErrors === 1
                    ? "1 file can't be added. Remove it to continue."
                    : `${stagedErrors} files can't be added. Remove them to continue.`}
                </s-paragraph>
              </s-banner>
            ) : null}
            {stagedRows.map((r) => (
              <s-box
                key={r.key}
                padding="small-200"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack
                  direction="inline"
                  gap="small"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-stack direction="block" gap="small-500">
                    <s-text>{r.file.name}</s-text>
                    {r.error ? (
                      <s-text tone="critical">{r.error}</s-text>
                    ) : (
                      <s-text color="subdued">
                        {needsOptimizationToFit(r.file)
                          ? `${formatBytes(r.file.size)} · must optimize to ${MAX_MODEL_FILE_SIZE_MB} MB or less`
                          : formatBytes(r.file.size)}
                      </s-text>
                    )}
                  </s-stack>
                  <s-button
                    variant="tertiary"
                    tone={r.error ? "critical" : undefined}
                    icon="x"
                    accessibilityLabel={`Remove ${r.file.name}`}
                    onClick={() =>
                      setStaged((prev) => prev.filter((p) => p.key !== r.key))
                    }
                  >
                    Remove
                  </s-button>
                </s-stack>
              </s-box>
            ))}
            <s-stack direction="inline" gap="small">
              <s-button
                variant="primary"
                icon="upload"
                disabled={flag(stagedBlocked)}
                onClick={confirmStaged}
              >
                {`Upload ${stagedRows.length} file${stagedRows.length === 1 ? "" : "s"}`}
              </s-button>
              <s-button onClick={() => setStaged([])}>Cancel</s-button>
            </s-stack>
          </s-stack>
        ) : null}
        {uploads.length > 0 ? (
          <s-stack direction="block" gap="small">
            <s-stack
              direction="inline"
              gap="small"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text type="strong">
                {uploading
                  ? `Uploading ${uploadsDone + uploadsFailed + 1} of ${uploads.length}…`
                  : uploadsFailed
                    ? `${uploadsFailed} file${uploadsFailed === 1 ? "" : "s"} couldn't be added`
                    : `${uploadsDone} of ${uploads.length} added`}
              </s-text>
              <s-button-group>
                {uploading ? (
                  <s-button
                    slot="secondary-actions"
                    variant="tertiary"
                    onClick={cancelQueuedUploads}
                  >
                    Cancel remaining
                  </s-button>
                ) : null}
                {!uploading && uploadsRetryable ? (
                  <s-button
                    slot="secondary-actions"
                    variant="tertiary"
                    onClick={retryFailedUploads}
                  >
                    Retry failed
                  </s-button>
                ) : null}
                {!uploading ? (
                  <s-button
                    slot="secondary-actions"
                    variant="tertiary"
                    onClick={clearFinishedUploads}
                  >
                    Clear
                  </s-button>
                ) : null}
              </s-button-group>
            </s-stack>
            {uploading ? (
              <div
                className="upload-progress"
                role="progressbar"
                aria-label="Upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(uploadProgress * 100)}
              >
                <div style={{ width: `${uploadProgress * 100}%` }} />
              </div>
            ) : null}
            {uploading ? (
              <s-text color="subdued">
                You can reload or leave this page — uploads continue in the
                background and pick up where they left off. If you close the
                app, they resume the next time you open this page.
              </s-text>
            ) : null}
            {uploads.map((u) => (
              <s-box
                key={u.key}
                padding="small-200"
                borderWidth="base"
                borderRadius="base"
              >
                <s-stack
                  direction="inline"
                  gap="small"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-stack direction="block" gap="small-500">
                    <s-text>{u.name}</s-text>
                    <s-text color="subdued">
                      {u.error ??
                        (u.status === "uploading"
                          ? `${formatBytes(u.loaded ?? 0)} of ${formatBytes(u.size)} · ${Math.round(((u.loaded ?? 0) / Math.max(u.size, 1)) * 100)}%`
                          : u.status === "processing"
                            ? u.optimize === false
                              ? "Saving to Shopify Files…"
                              : "Optimizing and saving to Shopify Files…"
                            : u.status === "done" &&
                                u.originalSize &&
                                u.uploadedSize
                              ? (describeSaving(
                                  u.originalSize,
                                  u.uploadedSize,
                                ) ?? formatBytes(u.uploadedSize))
                              : formatBytes(u.size))}
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="small" alignItems="center">
                    <s-badge tone={UPLOAD_STATUS[u.status].tone}>
                      {UPLOAD_STATUS[u.status].label}
                    </s-badge>
                    {/*
                      On every failed row: a file refused for its format, its
                      size or the plan limit will never upload as it is, so
                      the merchant needs a way to drop it from the list without
                      clearing the rest.
                    */}
                    {u.status === "error" ? (
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        icon="x"
                        accessibilityLabel={`Remove ${u.name}`}
                        onClick={() => removeUpload(u.key)}
                      >
                        Remove
                      </s-button>
                    ) : null}
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        ) : null}
      </s-section>

      <s-section>
        <s-stack direction="block" gap="base">
          {/*
            One row: search takes the space left over, the sort select and the
            two view toggles hug their content.

            Explicit grid tracks rather than an inline stack. A Polaris field is
            block-level and fills its container, so in a stack the search box and
            the select each claimed the full width and the row broke onto four
            lines. `1fr auto auto auto` is what actually states which control
            absorbs the slack and which keep their own size.
          */}
          {/*
            Two cells — search, and the controls beside it — rather than four
            fixed tracks. At `1fr auto auto auto` the select and both view
            toggles held their width on a phone and the search box was squeezed
            into whatever was left, around 60px. The controls cell drops onto its
            own row there instead; see .model-toolbar in critical.css.
          */}
          <div className="model-toolbar">
            <s-search-field
              label="Search models"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search models by name"
              value={query}
              onInput={(e) => setQuery(fieldValue(e))}
            />
            {/*
              A fixed track for the select, not `1fr`. Its four options are all
              short — "Newest first" is the longest — so a share of the row buys
              nothing but empty space inside the control, next to a search box
              that had to give that space up.
            */}
            <s-grid
              gridTemplateColumns="170px auto auto"
              gap="small"
              alignItems="end"
            >
              <s-select
                label="Sort"
                labelAccessibilityVisibility="exclusive"
                value={sort}
                onInput={(e) => setSort(fieldValue(e) as SortKey)}
              >
                <s-option value="newest">Newest first</s-option>
                <s-option value="oldest">Oldest first</s-option>
                <s-option value="name">Name (A→Z)</s-option>
                <s-option value="size">Largest first</s-option>
              </s-select>
              <s-button
                variant={viewMode === "list" ? "secondary" : "tertiary"}
                icon="list-bulleted"
                accessibilityLabel="List view"
                onClick={() => setViewMode("list")}
              />
              <s-button
                variant={viewMode === "grid" ? "secondary" : "tertiary"}
                icon="grid"
                accessibilityLabel="Grid view"
                onClick={() => setViewMode("grid")}
              />
            </s-grid>
          </div>

          {selected.size > 0 ? (
            /*
              One row rather than the banner's action slots, which stack each
              button on a line of its own beneath the count.
            */
            <s-banner tone="info">
              <s-stack
                direction="inline"
                gap="small"
                alignItems="center"
                justifyContent="space-between"
              >
                <s-text>{selected.size} selected</s-text>
                <s-stack direction="inline" gap="small" alignItems="center">
                  <s-button
                    variant="primary"
                    tone="critical"
                    icon="delete"
                    disabled={flag(submitting)}
                    onClick={() => setPendingDelete("bulk")}
                  >
                    Delete selected
                  </s-button>
                  <s-button onClick={() => setSelected(new Set())}>
                    Clear
                  </s-button>
                </s-stack>
              </s-stack>
            </s-banner>
          ) : null}

          {totalCount === 0 ? (
            <s-stack direction="block" gap="small" alignItems="center">
              <s-icon type="three-d-environment" color="subdued" />
              <s-text color="subdued">No models in your library yet.</s-text>
              <s-text color="subdued">
                Drop .glb files above or import an existing one.
              </s-text>
            </s-stack>
          ) : filtered.length === 0 ? (
            <s-stack direction="block" gap="small" alignItems="center">
              <s-icon type="search" color="subdued" />
              <s-text color="subdued">No models match “{query}”.</s-text>
            </s-stack>
          ) : viewMode === "list" ? (
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>
                  <s-checkbox
                    accessibilityLabel="Select all models"
                    checked={flag(allSelected)}
                    onInput={() =>
                      setSelected(
                        allSelected
                          ? new Set()
                          : new Set(filtered.map((m) => m.id)),
                      )
                    }
                  />
                </s-table-header>
                <s-table-header listSlot="primary">Model</s-table-header>
                <s-table-header format="numeric">Size</s-table-header>
                <s-table-header>Added</s-table-header>
                <s-table-header>Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {filtered.map((m) => (
                  <s-table-row key={m.id}>
                    <s-table-cell>
                      <s-checkbox
                        accessibilityLabel={`Select ${m.name}`}
                        checked={flag(selected.has(m.id))}
                        onInput={() => toggleOne(m.id)}
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-link
                        href={`/app/models/${m.id}`}
                        onClick={routeTo(`/app/models/${m.id}`)}
                      >
                        {m.name}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{formatBytes(m.fileSize)}</s-table-cell>
                    <s-table-cell>{m.createdAtLabel}</s-table-cell>
                    <s-table-cell>{rowActions(m)}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          ) : (
            <s-grid
              gridTemplateColumns="repeat(auto-fill, minmax(min(100%, 220px), 1fr))"
              gap="base"
            >
              {filtered.map((m) => (
                <s-box
                  key={m.id}
                  padding="base"
                  borderWidth="base"
                  borderStyle="solid"
                  borderColor={selected.has(m.id) ? "strong" : "base"}
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-stack
                      direction="inline"
                      gap="small"
                      alignItems="center"
                      justifyContent="space-between"
                      inlineSize="100%"
                    >
                      <s-checkbox
                        accessibilityLabel={`Select ${m.name}`}
                        checked={flag(selected.has(m.id))}
                        onInput={() => toggleOne(m.id)}
                      />
                      {rowActions(m)}
                    </s-stack>
                    <s-link
                      href={`/app/models/${m.id}`}
                      onClick={routeTo(`/app/models/${m.id}`)}
                    >
                      {m.name}
                    </s-link>
                    <s-text color="subdued">
                      {formatBytes(m.fileSize)} · {m.createdAtLabel}
                    </s-text>
                  </s-stack>
                </s-box>
              ))}
            </s-grid>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
