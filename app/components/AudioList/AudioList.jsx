import React, { useEffect, useRef, useState } from "react";
import { useAppBridge, Modal, TitleBar } from "@shopify/app-bridge-react";
import { useNavigate, useSearchParams } from "@remix-run/react";
import { useWebComponentEvent } from "../../utils/useWebComponentEvent";
import { WebCheckbox } from "../PolarisWeb/fields";
import { EmptyState } from "../PageState/PageState";

const TYPE_LABELS = {
  "single-audio": "Single Audio",
  "playlist-audio": "Playlist",
  "sticky-player": "Sticky Player",
  "sticky-single-button": "Sticky Button",
};

const SORT_OPTIONS = [
  { label: "Newest first", value: "created desc" },
  { label: "Oldest first", value: "created asc" },
  { label: "Title A–Z", value: "title asc" },
  { label: "Title Z–A", value: "title desc" },
];

const AudioList = ({
  nav,
  isLoading,
  loaderData,
  uploadAudio,
  pagination,
  submit,
}) => {
  const { page, totalPages, handlePagination } = pagination;
  const shopify = useAppBridge();
  const navigate = useNavigate();
  const user = loaderData?.user;

  // ── Search · filter · sort (server-side via URL params) ──
  const [searchParams, setSearchParams] = useSearchParams();
  const queryFromUrl = loaderData?.q || "";
  const typeValue = loaderData?.type || "";
  const sortValue = loaderData?.sort || "created desc";
  const [queryValue, setQueryValue] = useState(queryFromUrl);

  const setParam = (mutate) => {
    const p = new URLSearchParams(searchParams);
    mutate(p);
    p.delete("page"); // any filter change resets to the first page
    setSearchParams(p);
  };

  // Debounce the search box before pushing it to the URL (re-runs the loader).
  useEffect(() => {
    const current = searchParams.get("q") || "";
    if (queryValue.trim() === current) return;
    const timer = setTimeout(() => {
      setParam((p) => {
        if (queryValue.trim()) p.set("q", queryValue.trim());
        else p.delete("q");
      });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryValue]);

  const searchRef = useRef(null);
  const typeRef = useRef(null);
  const sortRef = useRef(null);
  useWebComponentEvent(searchRef, "input", (e) =>
    setQueryValue(e.currentTarget.value || ""),
  );
  useWebComponentEvent(typeRef, "change", (e) => {
    const v = e.currentTarget.value;
    setParam((p) => (v ? p.set("type", v) : p.delete("type")));
  });
  useWebComponentEvent(sortRef, "change", (e) => {
    const v = e.currentTarget.value;
    setParam((p) =>
      v && v !== "created desc" ? p.set("sort", v) : p.delete("sort"),
    );
  });

  const handleClearAll = () => {
    setQueryValue("");
    setParam((p) => {
      p.delete("q");
      p.delete("type");
    });
  };

  // Whether the shop has any players at all (not just on this page).
  const hasAnyAudio = (loaderData?.totalAudio || 0) > 0;
  // Search / filter / sort / page change in progress on this page.
  const isRefreshing =
    nav?.state === "loading" && nav.location?.pathname === "/app/audios";
  const hasActiveFilter = !!(queryFromUrl || typeValue);
  const visibleAudios = loaderData?.audio?.slice(0, user?.cardits) || [];

  // ── Copy embed code / ID ──
  const [copyState, setCopyState] = useState({});

  // A player can only be copied/embedded once its required fields are set.
  // Required: a title and an audio source (a track URL for playlist players).
  const getMissingFields = (audio) => {
    const missing = [];
    if (!audio?.title || !audio.title.trim()) missing.push("title");

    let hasSource = !!(audio?.url && String(audio.url).trim());
    if (!hasSource && audio?.audioPlayList) {
      try {
        const list =
          typeof audio.audioPlayList === "string"
            ? JSON.parse(audio.audioPlayList)
            : audio.audioPlayList;
        if (Array.isArray(list)) {
          hasSource = list.some((t) => t?.url && String(t.url).trim());
        }
      } catch {
        hasSource = false;
      }
    }
    if (!hasSource) missing.push("audio source");

    return missing;
  };

  const handleCopy = (audio, text, type) => {
    const id = audio.id;
    const missing = getMissingFields(audio);
    if (missing.length) {
      shopify.toast.show(
        `Add a ${missing.join(" and ")} to this player before copying its ${
          type === "embed" ? "embed code" : "ID"
        }.`,
        { isError: true },
      );
      return;
    }
    navigator.clipboard.writeText(text);
    setCopyState((prev) => ({ ...prev, [`${id}-${type}`]: true }));
    shopify.toast.show(
      `${type === "embed" ? "Embed Code" : "ID"} Copied Successfully`,
    );
    setTimeout(() => {
      setCopyState((prev) => ({ ...prev, [`${id}-${type}`]: false }));
    }, 2000);
  };

  // ── Selection + delete ──
  const [selectedIds, setSelectedIds] = useState([]);
  const [audioForDelete, setAudioForDelete] = useState(null);

  // A new page / filter result means a new set of rows: start unselected.
  useEffect(() => {
    setSelectedIds([]);
  }, [loaderData?.audio]);

  const allSelected =
    visibleAudios.length > 0 && selectedIds.length === visibleAudios.length;
  const toggleAll = (checked) =>
    setSelectedIds(checked ? visibleAudios.map((a) => a.id) : []);
  const toggleOne = (id, checked) =>
    setSelectedIds((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id),
    );

  const customizeUrl = (audio) =>
    `/app/customize/${audio.id}/${audio.playerType || "single-audio"}`;

  const renderEmptyState = ({ heading, text, action }) => (
    <s-section>
      <EmptyState heading={heading} message={text} action={action} />
    </s-section>
  );

  const deleteModalBody = ({ heading, badge, text }) => (
    <s-box padding="base">
      <s-stack gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-icon type="delete" tone="critical"></s-icon>
          <s-heading>{heading}</s-heading>
        </s-stack>
        <s-stack direction="inline">
          <s-badge tone="critical">{badge}</s-badge>
        </s-stack>
        <s-paragraph color="subdued">{text}</s-paragraph>
      </s-stack>
    </s-box>
  );

  return (
    <>
      {/* Single-player delete modal */}
      <Modal id="delete-confirmation-modal">
        {deleteModalBody({
          heading: "Delete this player?",
          badge: audioForDelete?.title || "audio player",
          text: "This will permanently remove the player and all its settings. This action cannot be undone.",
        })}
        <TitleBar title="">
          <button
            variant="primary"
            tone="critical"
            onClick={() => {
              if (!audioForDelete) return;
              // The result toast is shown by the page once the delete finishes.
              submit({ data: audioForDelete.id }, { method: "DELETE" });
              shopify.modal.hide("delete-confirmation-modal");
              setAudioForDelete(null);
            }}
          >
            Delete
          </button>
          <button
            onClick={() => {
              setAudioForDelete(null);
              shopify.modal.hide("delete-confirmation-modal");
            }}
          >
            Cancel
          </button>
        </TitleBar>
      </Modal>

      {/* Bulk-delete modal */}
      <Modal id="multiple-delete-confirmation-modal">
        {deleteModalBody({
          heading: "Delete selected players?",
          badge: `${selectedIds.length} player${
            selectedIds.length !== 1 ? "s" : ""
          } selected`,
          text: "This will permanently remove all selected players and their settings. This action cannot be undone.",
        })}
        <TitleBar title="">
          <button
            variant="primary"
            tone="critical"
            onClick={() => {
              submit(
                { audioList: JSON.stringify(selectedIds) },
                { method: "DELETE" },
              );
              shopify.modal.hide("multiple-delete-confirmation-modal");
            }}
          >
            Delete
          </button>
          <button
            onClick={() =>
              shopify.modal.hide("multiple-delete-confirmation-modal")
            }
          >
            Cancel
          </button>
        </TitleBar>
      </Modal>

      {!hasAnyAudio && !hasActiveFilter ? (
        renderEmptyState({
          heading: "Your Player List is Empty",
          text: "It looks like you haven't created any players yet. Click 'Add New Player' to add your first one!",
          action: (
            <s-button variant="primary" icon="plus" onClick={uploadAudio}>
              Add New Player
            </s-button>
          ),
        })
      ) : (
        <s-section padding="none">
          <s-stack gap="none">
            {/* Toolbar: search · type filter · sort */}
            <s-box padding="base">
              <s-stack gap="small">
                <s-grid
                  gridTemplateColumns="minmax(0, 1fr) auto auto"
                  gap="small"
                  alignItems="center"
                >
                  <s-search-field
                    ref={searchRef}
                    label="Search players"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Search players by title"
                    value={queryValue}
                  ></s-search-field>
                  <s-select
                    ref={typeRef}
                    label="Player type"
                    labelAccessibilityVisibility="exclusive"
                    value={typeValue}
                  >
                    <s-option value="">All types</s-option>
                    {Object.entries(TYPE_LABELS).map(([value, label]) => (
                      <s-option key={value} value={value}>
                        {label}
                      </s-option>
                    ))}
                  </s-select>
                  <s-select
                    ref={sortRef}
                    label="Sort"
                    labelAccessibilityVisibility="exclusive"
                    value={sortValue}
                  >
                    {SORT_OPTIONS.map((o) => (
                      <s-option key={o.value} value={o.value}>
                        {o.label}
                      </s-option>
                    ))}
                  </s-select>
                </s-grid>

                {hasActiveFilter || selectedIds.length > 0 ? (
                  <s-stack
                    direction="inline"
                    gap="small"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="inline" gap="small" alignItems="center">
                      {selectedIds.length > 0 ? (
                        <>
                          <s-text type="strong">
                            {selectedIds.length} selected
                          </s-text>
                          <s-button
                            tone="critical"
                            icon="delete"
                            onClick={() =>
                              shopify.modal.show(
                                "multiple-delete-confirmation-modal",
                              )
                            }
                          >
                            Delete selected
                          </s-button>
                          <s-button
                            variant="tertiary"
                            onClick={() => setSelectedIds([])}
                          >
                            Clear selection
                          </s-button>
                        </>
                      ) : null}
                    </s-stack>
                    {hasActiveFilter ? (
                      <s-button variant="tertiary" onClick={handleClearAll}>
                        Clear filters
                      </s-button>
                    ) : null}
                  </s-stack>
                ) : null}
              </s-stack>
            </s-box>

            {visibleAudios.length === 0 ? (
              hasActiveFilter ? (
                <EmptyState
                  compact
                  heading="No players match your search"
                  message="Try a different search term or clear the filters."
                  action={
                    <s-button onClick={handleClearAll}>Clear filters</s-button>
                  }
                />
              ) : (
                // e.g. ?page=5 after deleting players from the last page.
                <EmptyState
                  compact
                  heading="No players on this page"
                  message="This page is past the end of your player list."
                  action={
                    <s-button onClick={() => handlePagination(1)}>
                      Go to first page
                    </s-button>
                  }
                />
              )
            ) : (
              <s-table loading={isRefreshing || undefined}>
                <s-table-header-row>
                  <s-table-header>
                    <WebCheckbox
                      accessibilityLabel="Select all players"
                      checked={allSelected}
                      indeterminate={selectedIds.length > 0 && !allSelected}
                      onChange={toggleAll}
                    />
                  </s-table-header>
                  <s-table-header>Player No.</s-table-header>
                  <s-table-header listSlot="primary">Title</s-table-header>
                  <s-table-header>Copy</s-table-header>
                  <s-table-header>Actions</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {visibleAudios.map((audio, index) => {
                    const embedCopied = copyState[`${audio.id}-embed`];
                    const idCopied = copyState[`${audio.id}-id`];
                    return (
                      <s-table-row key={audio.id}>
                        <s-table-cell>
                          <WebCheckbox
                            accessibilityLabel={`Select ${audio.title || "player"}`}
                            checked={selectedIds.includes(audio.id)}
                            onChange={(checked) => toggleOne(audio.id, checked)}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          {(page - 1) * loaderData?.pageSize + index + 1}
                        </s-table-cell>
                        <s-table-cell>
                          <s-link onClick={() => navigate(customizeUrl(audio))}>
                            {audio?.title && audio.title.length > 50
                              ? `${audio.title.slice(0, 50)}…`
                              : audio?.title || "Untitled Player"}
                          </s-link>
                        </s-table-cell>
                        <s-table-cell>
                          {/* Incomplete players stay clickable: handleCopy
                              explains what's missing in a toast. */}
                          <s-stack direction="inline" gap="small-200">
                            <s-button
                              variant="tertiary"
                              icon={embedCopied ? "check" : "code"}
                              disabled={isLoading || undefined}
                              onClick={() =>
                                handleCopy(
                                  audio,
                                  `<div class="html5-audio-plyr" data-id="${audio.id}"></div>`,
                                  "embed",
                                )
                              }
                            >
                              {embedCopied ? "Copied!" : "Embed"}
                            </s-button>
                            <s-button
                              variant="tertiary"
                              icon={idCopied ? "check" : "clipboard"}
                              disabled={isLoading || undefined}
                              onClick={() => handleCopy(audio, audio.id, "id")}
                            >
                              {idCopied ? "Copied!" : "ID"}
                            </s-button>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-200">
                            <s-button
                              icon="edit"
                              disabled={isLoading || undefined}
                              onClick={() => navigate(customizeUrl(audio))}
                            >
                              Edit
                            </s-button>
                            <s-button
                              variant="tertiary"
                              icon="chart-vertical"
                              accessibilityLabel={`Stats for ${audio.title || "player"}`}
                              onClick={() =>
                                navigate(`/app/audio-dashboard/${audio.id}`)
                              }
                            >
                              Stats
                            </s-button>
                            <s-button
                              tone="critical"
                              icon="delete"
                              disabled={isLoading || undefined}
                              onClick={() => {
                                setAudioForDelete(audio);
                                shopify.modal.show("delete-confirmation-modal");
                              }}
                            >
                              Delete
                            </s-button>
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            )}

            {totalPages > 1 ? (
              <s-box padding="base">
                <s-stack
                  direction="inline"
                  gap="small"
                  alignItems="center"
                  justifyContent="center"
                >
                  <s-button
                    icon="chevron-left"
                    accessibilityLabel="Previous page"
                    disabled={page <= 1 || undefined}
                    onClick={() => handlePagination(page - 1)}
                  ></s-button>
                  <s-text color="subdued">
                    Page {page} of {totalPages}
                  </s-text>
                  <s-button
                    icon="chevron-right"
                    accessibilityLabel="Next page"
                    disabled={page >= totalPages || undefined}
                    onClick={() => handlePagination(page + 1)}
                  ></s-button>
                </s-stack>
              </s-box>
            ) : null}
          </s-stack>
        </s-section>
      )}
    </>
  );
};

export default AudioList;
