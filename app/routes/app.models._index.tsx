import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import {
  Boxes,
  ChevronRight,
  Copy,
  FolderOpen,
  LayoutGrid,
  List,
  Search,
  Settings2,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { resolveFileUrl, stagedUploadAndCreate } from "~/lib/files.server";
import { isValidModelFilename } from "~/lib/files";
import { countAssignedModels, getPlanLimitForShop } from "~/lib/billing.server";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { FilePickerDialog } from "~/components/FilePickerDialog";
import type { FileItem } from "~/routes/api.files";
import { cn } from "~/lib/utils";

type ModelRow = {
  id: string;
  name: string;
  fileUrl: string;
  fileSize: number | null;
  createdAt: string;
};

type LoaderData = {
  models: ModelRow[];
  totalCount: number;
  planName: string;
  planLimit: number;
  productModelCount: number;
};

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session?.shop ?? "";

  const [models, planInfo, productCount] = await Promise.all([
    prisma.model3D.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
    }),
    getPlanLimitForShop(shop),
    countAssignedModels(admin, shop),
  ]);

  return {
    models: models.map((m) => ({
      id: m.id,
      name: m.name,
      fileUrl: m.fileUrl,
      fileSize: m.fileSize ?? null,
      createdAt: m.createdAt.toISOString(),
    })),
    totalCount: models.length,
    planName: planInfo.planName,
    planLimit: planInfo.limit,
    productModelCount: productCount,
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
    return { ok: true, message: "Model deleted from library" };
  }

  if (intent === "bulk_delete") {
    const raw = String(formData.get("ids") ?? "");
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      return { ok: false, error: "Nothing selected" };
    }
    const result = await prisma.model3D.deleteMany({
      where: { shop, id: { in: ids } },
    });
    return {
      ok: true,
      message: `${result.count} model${result.count === 1 ? "" : "s"} deleted`,
    };
  }

  const planInfo = await getPlanLimitForShop(shop);
  const libraryCount = await prisma.model3D.count({ where: { shop } });
  const productCount = await countAssignedModels(admin, shop);
  const totalInUse = libraryCount + productCount;
  if (totalInUse >= planInfo.limit) {
    return {
      ok: false,
      error: `You've reached your ${planInfo.planName} plan limit of ${planInfo.limit} 3D models. Upgrade your plan to add more.`,
    };
  }

  if (intent === "assign_existing") {
    const fileGid = String(formData.get("fileGid") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!fileGid.startsWith("gid://shopify/")) {
      return { ok: false, error: "Invalid file id" };
    }
    const fileUrl = await resolveFileUrl(admin, fileGid);
    if (!fileUrl) return { ok: false, error: "Could not resolve file URL" };
    const finalName =
      name ||
      decodeURIComponent(fileUrl.split("?")[0]?.split("/").pop() ?? "Model");
    const created = await prisma.model3D.create({
      data: { shop, name: finalName, fileGid, fileUrl },
    });
    return { ok: true, message: "Model added to library", id: created.id };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "Please choose a .glb or .gltf file" };
  }
  if (!isValidModelFilename(file.name)) {
    return { ok: false, error: "Only .glb or .gltf files are supported" };
  }

  const result = await stagedUploadAndCreate(
    admin,
    file,
    `Library model: ${file.name}`,
  );
  if (!result.ok) return { ok: false, error: result.error };

  const name = (formData.get("name") as string | null)?.trim() || file.name;
  const created = await prisma.model3D.create({
    data: {
      shop,
      name,
      fileGid: result.fileGid,
      fileUrl: result.fileUrl ?? "",
      fileSize: file.size,
    },
  });
  return { ok: true, message: "Model uploaded to library", id: created.id };
};

function formatBytes(n: number | null) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
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
  const { models, totalCount, planName, planLimit, productModelCount } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const submitting = navigation.state === "submitting";

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadFormRef = useRef<HTMLFormElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  useEffect(() => {
    if (actionData?.ok) {
      shopify.toast.show(actionData.message ?? "Done");
      setSelected(new Set());
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const totalInUse = totalCount + productModelCount;
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

  function handleFileChosen() {
    uploadFormRef.current?.requestSubmit();
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (limitReached || submitting) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!isValidModelFilename(file.name)) {
      shopify.toast.show("Only .glb or .gltf files are supported", {
        isError: true,
      });
      return;
    }
    const fd = new FormData();
    fd.set("intent", "upload");
    fd.append("file", file);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  async function handleCopyUrl(id: string, url: string) {
    setCopyingId(id);
    try {
      await navigator.clipboard.writeText(url);
      shopify.toast.show("URL copied");
    } catch {
      shopify.toast.show("Couldn't copy URL", { isError: true });
    } finally {
      setTimeout(() => setCopyingId(null), 600);
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnPage() {
    setSelected(new Set(filtered.map((m) => m.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Delete ${selected.size} model${selected.size === 1 ? "" : "s"} from the library? The .glb files themselves stay in Shopify Files.`,
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set("intent", "bulk_delete");
    fd.set("ids", Array.from(selected).join(","));
    submit(fd, { method: "post" });
  }

  function handleDeleteOne(id: string) {
    if (
      !window.confirm(
        "Delete this model from the library? The .glb file itself stays in Shopify Files.",
      )
    )
      return;
    const fd = new FormData();
    fd.set("intent", "delete");
    fd.set("id", id);
    submit(fd, { method: "post" });
  }

  const allSelected =
    filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  return (
    <div className="min-h-screen bg-background">
      <FilePickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        currentUrl={null}
        onSelect={handleFilePicked}
      />

      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              3D Model Library
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage standalone 3D models you embed via the &ldquo;3D Model
              Viewer (page)&rdquo; block.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              <Boxes className="size-3 mr-1" />
              {planName} plan
            </Badge>
            <Badge variant={limitReached ? "destructive" : "outline"}>
              {totalInUse} / {planLimit} models
            </Badge>
          </div>
        </div>

        {limitReached && (
          <Card className="border-amber-500 bg-amber-50">
            <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="text-sm font-semibold">
                  Plan limit reached
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Includes {productModelCount} product assignments and{" "}
                  {totalCount} library models.
                </div>
              </div>
              <Button asChild>
                <Link to="/app/pricing">Upgrade plan</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        <div
          onDragEnter={(e) => {
            e.preventDefault();
            if (!limitReached) setDragOver(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!limitReached) setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDrop={handleDrop}
          onClick={() =>
            !limitReached && !submitting && fileInputRef.current?.click()
          }
          className={cn(
            "border-2 border-dashed p-8 flex flex-col items-center justify-center text-center gap-2 transition-colors",
            limitReached
              ? "opacity-50 cursor-not-allowed bg-muted/30"
              : "cursor-pointer hover:bg-accent/30",
            dragOver && !limitReached
              ? "border-primary bg-primary/5"
              : "border-border",
          )}
        >
          <UploadCloud
            className={cn(
              "size-8 mb-1",
              dragOver ? "text-primary" : "text-muted-foreground",
            )}
          />
          <div className="text-sm font-medium">
            {dragOver
              ? "Release to upload"
              : "Drop a .glb or .gltf file here, or click to choose"}
          </div>
          <div className="text-xs text-muted-foreground">
            Stored in Shopify Files. Max 10&nbsp;MB recommended.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submitting || limitReached}
              onClick={(e) => {
                e.stopPropagation();
                setPickerOpen(true);
              }}
            >
              <FolderOpen /> Choose from Files
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={submitting || limitReached}
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <Upload /> Upload new
            </Button>
          </div>
        </div>

        <Form
          ref={uploadFormRef}
          method="post"
          encType="multipart/form-data"
          className="hidden"
        >
          <input type="hidden" name="intent" value="upload" />
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            onChange={handleFileChosen}
          />
        </Form>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models by name"
              className="pl-9"
            />
          </div>
          <Select
            value={sort}
            onValueChange={(v) => setSort(v as SortKey)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name (A→Z)</SelectItem>
              <SelectItem value="size">Largest first</SelectItem>
            </SelectContent>
          </Select>
          {filtered.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={allSelected ? clearSelection : selectAllOnPage}
            >
              {allSelected ? "Clear" : "Select all"}
            </Button>
          )}
          <div className="flex border bg-card">
            <Button
              type="button"
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("list")}
              aria-label="List view"
              aria-pressed={viewMode === "list"}
            >
              <List />
            </Button>
            <Button
              type="button"
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setViewMode("grid")}
              aria-label="Grid view"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid />
            </Button>
          </div>
        </div>

        {selected.size > 0 && (
          <div className="sticky top-0 z-10 -mx-4 sm:mx-0 bg-primary text-primary-foreground px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 shadow">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={clearSelection}
                className="text-primary-foreground hover:bg-primary-foreground/10"
              >
                <X />
              </Button>
              <span className="text-sm font-medium">
                {selected.size} selected
              </span>
            </div>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              disabled={submitting}
            >
              <Trash2 /> Delete selected
            </Button>
          </div>
        )}

        {totalCount === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Boxes className="size-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No models in your library yet.</p>
            <p className="text-xs mt-1">
              Drop a .glb file above or import an existing one.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="size-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              No models match &ldquo;{query}&rdquo;.
            </p>
          </div>
        ) : viewMode === "list" ? (
          <div className="border bg-card divide-y">
            {filtered.map((m) => {
              const isSelected = selected.has(m.id);
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/app/models/${m.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/app/models/${m.id}`);
                    }
                  }}
                  className={cn(
                    "group flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-accent/40",
                    isSelected && "bg-primary/5",
                  )}
                >
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "flex items-center justify-center size-5 border bg-background cursor-pointer transition-opacity shrink-0",
                      isSelected || selected.size > 0
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(m.id)}
                      className="size-4 cursor-pointer"
                    />
                  </label>

                  <div className="size-9 border bg-muted/40 flex items-center justify-center shrink-0">
                    <Boxes className="size-4 text-muted-foreground/70" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" title={m.name}>
                      {m.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatBytes(m.fileSize)} · {formatDate(m.createdAt)}
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyUrl(m.id, m.fileUrl)}
                      title="Copy URL"
                    >
                      <Copy />
                      {copyingId === m.id ? "Copied" : "URL"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteOne(m.id)}
                      aria-label="Delete model"
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <ChevronRight className="size-4 text-muted-foreground/60 shrink-0" />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((m) => {
              const isSelected = selected.has(m.id);
              return (
                <div
                  key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/app/models/${m.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      navigate(`/app/models/${m.id}`);
                    }
                  }}
                  className={cn(
                    "relative border bg-card shadow-sm flex flex-col group transition-colors cursor-pointer",
                    isSelected
                      ? "border-primary ring-1 ring-primary"
                      : "hover:border-primary/40",
                  )}
                >
                  <label
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      "absolute top-2 left-2 z-10 flex items-center justify-center size-5 border bg-background cursor-pointer transition-opacity",
                      isSelected || selected.size > 0
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(m.id)}
                      className="size-4 cursor-pointer"
                    />
                  </label>

                  <div className="flex items-center justify-center h-32 bg-muted/40 border-b">
                    <Boxes className="size-10 text-muted-foreground/60" />
                  </div>

                  <div className="p-3 flex flex-col gap-1 flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" title={m.name}>
                      {m.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {formatBytes(m.fileSize)} · {formatDate(m.createdAt)}
                    </div>
                  </div>

                  <div
                    className="border-t p-2 flex items-center gap-1 justify-end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyUrl(m.id, m.fileUrl)}
                      title="Copy URL"
                    >
                      <Copy />
                      {copyingId === m.id ? "Copied" : "URL"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      asChild
                      title="Customize"
                    >
                      <Link to={`/app/models/${m.id}`}>
                        <Settings2 />
                      </Link>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteOne(m.id)}
                      aria-label="Delete model"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
