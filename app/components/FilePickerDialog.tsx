import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Box, Search } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

import type { FileItem } from "~/routes/api.files";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentUrl: string | null;
  onSelect: (file: FileItem) => void;
};

function formatBytes(n: number | null) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function FilePickerDialog({
  open,
  onOpenChange,
  currentUrl,
  onSelect,
}: Props) {
  const fetcher = useFetcher<{ files: FileItem[] }>();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetcher.load(`/api/files?q=${encodeURIComponent(query)}`);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      fetcher.load(`/api/files?q=${encodeURIComponent(query)}`);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const loading = fetcher.state !== "idle";
  const files = fetcher.data?.files ?? [];
  const selected = files.find((f) => f.id === selectedId);

  function handleConfirm() {
    if (selected) {
      onSelect(selected);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Choose a 3D model from Files</DialogTitle>
          <DialogDescription>
            Showing .glb / .gltf files from Shopify Files. Upload more via the
            Upload button if you don&apos;t see what you need.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder="Search by filename"
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[400px] overflow-y-auto border rounded-md">
          {loading && files.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Loading files…
            </div>
          )}
          {!loading && files.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No .glb or .gltf files found in this store.
            </div>
          )}
          {files.length > 0 && (
            <ul className="divide-y">
              {files.map((file) => {
                const isCurrent = currentUrl === file.url;
                const isSelected = file.id === selectedId;
                return (
                  <li key={file.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(file.id)}
                      onDoubleClick={() => {
                        onSelect(file);
                        onOpenChange(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent transition-colors",
                        isSelected && "bg-primary/10 hover:bg-primary/15",
                      )}
                    >
                      <div className="shrink-0 size-9 rounded bg-muted flex items-center justify-center">
                        <Box className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {file.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatBytes(file.size)}
                          {isCurrent && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              Current
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!selected}>
            Assign selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
