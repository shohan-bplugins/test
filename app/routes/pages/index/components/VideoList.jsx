import {
  ChoiceList,
  EmptyState,
  IndexFilters,
  IndexFiltersMode,
  LegacyCard,
  useIndexResourceState,
  useSetIndexFiltersMode,
  IndexTable,
  Box,
  Text,
  Link as PolarisLink,
  InlineStack,
  Button,
  SkeletonBodyText,
} from "@shopify/polaris";
import React, { useEffect, useState } from "react";
import {
  DeleteIcon,
  CheckIcon,
  CodeIcon,
  ClipboardIcon,
  EditIcon,
} from "@shopify/polaris-icons";
import {
  json,
  useLocation,
  useSearchParams,
  Link as RemixLink,
  useNavigate,
} from "@remix-run/react";
import ModernDeleteModal from "../../../../components/deleteModal/ModernDeleteModal";
import { flag } from "../../../../utils/polarisWebComponents";
import "./VideoList.css";

export const VideoList = ({
  videos,
  isLoading,
  nav,
  submit,
  toggleModal,
  paginationInfo,
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  //-------------------------Search / Filter / Sort---------------------------//
  // While the loader for a filter change is still running, useSearchParams
  // keeps returning the OLD url, so quick successive clicks (e.g. picking a
  // sort category and then a direction) would read stale state. Read from the
  // pending navigation location when there is one so the UI updates instantly.
  const effectiveParams = new URLSearchParams(
    nav?.location && nav.location.pathname.includes("/app/videos")
      ? nav.location.search
      : location.search,
  );

  const searchFromUrl = effectiveParams.get("search") || "";
  const videoTypesFromUrl = (effectiveParams.get("videoType") || "")
    .split(",")
    .filter(Boolean);
  const sortFromUrl = effectiveParams.get("sort") || "newest";

  const [queryValue, setQueryValue] = useState(searchFromUrl);
  // Start in Filtering mode so the search field and filters are visible
  // immediately, instead of hidden behind the search toggle button.
  const { mode, setMode } = useSetIndexFiltersMode(IndexFiltersMode.Filtering);

  const updateFilterParams = (updates) => {
    const params = new URLSearchParams(effectiveParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    // Filters changed, so start back at the first page of results
    params.delete("page");
    setSearchParams(params, { replace: true });
  };

  // Debounce the search input so we don't refetch on every keystroke
  useEffect(() => {
    if (queryValue === searchFromUrl) return;
    const timeout = setTimeout(() => {
      updateFilterParams({ search: queryValue.trim() });
    }, 400);
    return () => clearTimeout(timeout);
  }, [queryValue]);

  const sortToUrl = {
    "createdAt desc": "newest",
    "createdAt asc": "oldest",
    "title asc": "title-asc",
    "title desc": "title-desc",
  };
  const sortFromUrlToPolaris = {
    newest: "createdAt desc",
    oldest: "createdAt asc",
    "title-asc": "title asc",
    "title-desc": "title desc",
  };

  const sortOptions = [
    {
      label: "Date created",
      value: "createdAt desc",
      directionLabel: "Newest first",
    },
    {
      label: "Date created",
      value: "createdAt asc",
      directionLabel: "Oldest first",
    },
    { label: "Title", value: "title asc", directionLabel: "A-Z" },
    { label: "Title", value: "title desc", directionLabel: "Z-A" },
  ];

  const videoTypeLabels = {
    html5: "Uploaded / Direct URL",
    youtube: "YouTube",
    vimeo: "Vimeo",
  };

  const filters = [
    {
      key: "videoType",
      label: "Video source",
      filter: (
        <ChoiceList
          title="Video source"
          titleHidden
          allowMultiple
          choices={Object.entries(videoTypeLabels).map(([value, label]) => ({
            label,
            value,
          }))}
          selected={videoTypesFromUrl}
          onChange={(selected) =>
            updateFilterParams({ videoType: selected.join(",") })
          }
        />
      ),
      shortcut: true,
    },
  ];

  const appliedFilters = videoTypesFromUrl.length
    ? [
        {
          key: "videoType",
          label: `Source: ${videoTypesFromUrl
            .map((type) => videoTypeLabels[type] || type)
            .join(", ")}`,
          onRemove: () => updateFilterParams({ videoType: "" }),
        },
      ]
    : [];

  const handleClearAll = () => {
    setQueryValue("");
    updateFilterParams({ search: "", videoType: "" });
  };

  const hasActiveFilters =
    Boolean(searchFromUrl) ||
    videoTypesFromUrl.length > 0 ||
    sortFromUrl !== "newest";

  const [videoForDelete, setVideoForDelete] = useState(null);
  const [activeMultipleDeleteModal, setActiveMultipleDeleteModal] =
    useState(false);
  const [copiedData, setCopiedData] = useState({ id: null, type: null });

  const handleCopy = (id, type, code) => {
    navigator.clipboard.writeText(code);
    shopify.toast.show(
      `Copied ${
        type === "embed"
          ? "embed code"
          : type === "iframe"
            ? "iFrame code — paste it on any website"
            : "player ID"
      }!`,
    );
    setCopiedData({ id, type });
    setTimeout(() => {
      setCopiedData((prev) =>
        prev.id === id && prev.type === type ? { id: null, type: null } : prev,
      );
    }, 2000);
  };
  const resourceName = {
    singular: "player",
    plural: "players",
  };

  const startIndex = paginationInfo?.page ? (paginationInfo.page - 1) * 10 : 0;

  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(Array.isArray(videos) ? videos : []);

  const [sortDateSelected, setSortDateSelected] = useState(
    sortFromUrlToPolaris[sortFromUrl] || "createdAt desc",
  );

  // The three copy buttons differed only in icon, label and payload.
  const COPY_ACTIONS = [
    {
      type: "embed",
      title: "Embed",
      icon: CodeIcon,
      label: "Copy embed code",
      value: (v) =>
        `<s-box class="video-plyr-by-bplugins" data-id="${v.id}"></s-box>`,
    },
    {
      type: "iframe",
      title: "iFrame",
      icon: CodeIcon,
      label: "Copy iFrame embed \u2014 works on any website, no setup",
      // Zero-setup embed: works on any site with no app embed, theme block or
      // script. The wrapper keeps it responsive at 16:9. window.location.origin
      // is this app's own host, since the admin page is served from it.
      value: (v) =>
        `<iframe src="${window.location.origin}/embed/${v.id}"\n  style="width:100%;aspect-ratio:16/9;min-height:220px;border:0;display:block"\n  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"\n  allowfullscreen title="Video"></iframe>`,
    },
    {
      type: "id",
      title: "ID",
      icon: ClipboardIcon,
      label: "Copy player ID",
      value: (v) => v.id,
    },
  ];

  const rows = Array.isArray(videos) ? videos : [];

  const videoRowMarkup = rows.map((video, index) => (
    <IndexTable.Row
      id={video?.id}
      key={video?.id}
      selected={selectedResources.includes(video?.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text fontWeight="bold" as="span">
          {startIndex + index + 1}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {/* stopPropagation: without it, following the title link ALSO toggles
            this row's IndexTable selection. */}
        <PolarisLink
          removeUnderline
          onClick={(ev) => {
            // Both are needed: preventDefault keeps Remix in charge of the
            // navigation, stopPropagation keeps the click from also toggling
            // this row's IndexTable selection.
            ev.preventDefault();
            ev.stopPropagation();
            navigate(`/app/customize/${video?.id}`);
          }}
        >
          <Text fontWeight="bold" as="span">
            {(video?.title?.length ?? 0) > 80
              ? video.title.substring(0, 80) + "..."
              : video?.title || "Untitled player"}
          </Text>
        </PolarisLink>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {/* InlineStack replaces the hand-rolled .modern-action-group, and
            Button replaces five raw <button className="modern-btn">. The
            e.stopPropagation() calls are load-bearing: without them a click
            here would also toggle the row's IndexTable selection. */}
        <InlineStack wrap={false} gap="200">
          {COPY_ACTIONS.map((action) => {
            const isCopied =
              copiedData.id === video.id && copiedData.type === action.type;
            return (
              <Button
                key={action.type}
                icon={isCopied ? CheckIcon : action.icon}
                accessibilityLabel={action.label}
                disabled={flag(isLoading)}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopy(video.id, action.type, action.value(video));
                }}
              >
                {isCopied ? "Copied!" : action.title}
              </Button>
            );
          })}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack wrap={false} gap="200">
          <Button
            variant="primary"
            icon={EditIcon}
            accessibilityLabel={`Edit ${video?.title || "player"}`}
            disabled={flag(isLoading)}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/app/customize/${video?.id}`);
            }}
          >
            Edit
          </Button>
          <Button
            tone="critical"
            icon={DeleteIcon}
            accessibilityLabel={`Delete ${video?.title || "player"}`}
            disabled={flag(isLoading)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // ModernDeleteModal opens off `videoForDelete`; the old
              // shopify.modal.show("delete-confirmation-modal") call that used to
              // follow this pointed at a <ui-modal> that no longer exists.
              setVideoForDelete(video);
            }}
          >
            Delete
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const promotedBulkActions = [
    {
      icon: DeleteIcon,
      destructive: true,
      content: "Delete Selected Players",
      onAction: () => {
        setActiveMultipleDeleteModal(true);
      },
    },
  ];

  const TableSkeleton = () => (
    // aria-busy + role=status: previously a screen reader was read an empty
    // data table on every filter, sort and page change.
    <Box
      paddingBlockEnd="400"
      role="status"
      aria-busy="true"
      aria-label="Loading video players"
    >
      <IndexTable
        resourceName={resourceName}
        itemCount={5}
        headings={[
          { title: "Player No." },
          { title: "Title" },
          { title: "Copy" },
          { title: "Actions" },
        ]}
        selectable={false}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <IndexTable.Row key={i} id={`skel-${i}`} position={i}>
            <IndexTable.Cell>
              <SkeletonBodyText lines={1} />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <SkeletonBodyText lines={1} />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <SkeletonBodyText lines={1} />
            </IndexTable.Cell>
            <IndexTable.Cell>
              <SkeletonBodyText lines={1} />
            </IndexTable.Cell>
          </IndexTable.Row>
        ))}
      </IndexTable>
    </Box>
  );

  const isNavLoading =
    nav.state === "loading" &&
    nav.location &&
    nav.location.pathname.includes("/app/videos");

  const filtersBar = (
    <IndexFilters
      sortOptions={sortOptions}
      sortSelected={[sortDateSelected]}
      onSort={(selected) => {
        // Polaris keeps the previous direction when switching category, which
        // reads as broken (picking "Title" while on "Newest first" lands on
        // Z-A). Default each category to its natural direction instead.
        const [key] = selected[0].split(" ");
        const [prevKey] = (
          sortFromUrlToPolaris[sortFromUrl] || "createdAt desc"
        ).split(" ");
        const effective =
          key !== prevKey
            ? key === "title"
              ? "title asc"
              : "createdAt desc"
            : selected[0];
        const value = sortToUrl[effective] || "newest";
        updateFilterParams({ sort: value === "newest" ? "newest" : value });
      }}
      queryValue={queryValue}
      queryPlaceholder="Search players by title"
      onQueryChange={setQueryValue}
      onQueryClear={() => {
        setQueryValue("");
        updateFilterParams({ search: "" });
      }}
      filters={filters}
      appliedFilters={appliedFilters}
      onClearAll={handleClearAll}
      tabs={[]}
      selected={0}
      onSelect={() => {}}
      mode={mode}
      setMode={setMode}
      canCreateNewView={false}
      cancelAction={{ onAction: () => {} }}
      loading={isNavLoading}
    />
  );

  useEffect(() => {
    setSortDateSelected(sortFromUrlToPolaris[sortFromUrl] || "createdAt desc");
  }, [sortFromUrl]);

  return (
    <>
      <Box className="vp-videolist-footer">
        {rows.length === 0 && !hasActiveFilters && !isNavLoading ? (
          <LegacyCard sectioned>
            <EmptyState
              heading="Upload a file to get started"
              action={{ content: "Add New Player", onAction: toggleModal }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              fullWidth
            >
              <Text as="p">
                You can use the Files section to upload Video. This example
                shows the content with a centered layout and full width.
              </Text>
            </EmptyState>
          </LegacyCard>
        ) : (
          <LegacyCard>
            {filtersBar}
            {isNavLoading ? (
              <TableSkeleton />
            ) : rows.length > 0 ? (
              <IndexTable
                resourceName={resourceName}
                itemCount={rows.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                promotedBulkActions={promotedBulkActions}
                pagination={{
                  hasNext: paginationInfo?.hasNextPage,
                  hasPrevious: paginationInfo?.hasPreviousPage,
                  onNext: () => {
                    const params = new URLSearchParams(effectiveParams);
                    params.set("page", paginationInfo?.page + 1);
                    setSearchParams(params);
                  },
                  onPrevious: () => {
                    const params = new URLSearchParams(effectiveParams);
                    params.set("page", Math.max(1, paginationInfo?.page - 1));
                    setSearchParams(params);
                  },
                }}
                headings={[
                  { title: "Player No." },
                  { title: "Title" },
                  { title: "Copy" },
                  { title: "Actions" },
                ]}
              >
                {videoRowMarkup}
              </IndexTable>
            ) : (
              <LegacyCard.Section>
                <EmptyState
                  heading="No players found"
                  action={{
                    content: "Clear filters",
                    onAction: handleClearAll,
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  fullWidth
                >
                  <Text as="p">
                    No video players match your search or filters. Try changing
                    the search term or clearing the filters.
                  </Text>
                </EmptyState>
              </LegacyCard.Section>
            )}
          </LegacyCard>
        )}
      </Box>
      {/* Modern Deletion Modal - Handles both Single and Bulk */}
      <ModernDeleteModal
        open={videoForDelete !== null || activeMultipleDeleteModal}
        isBulk={activeMultipleDeleteModal}
        selectedItems={
          activeMultipleDeleteModal
            ? rows.filter((v) => selectedResources.includes(v.id))
            : videoForDelete
              ? [videoForDelete]
              : []
        }
        onClose={() => {
          setVideoForDelete(null);
          setActiveMultipleDeleteModal(false);
        }}
        onConfirm={() => {
          if (activeMultipleDeleteModal) {
            submit(
              {
                videoList: JSON.stringify(selectedResources),
                intent: "delete",
              },
              { method: "POST" },
            );
            shopify.toast.show("Selected Video players deleted!");
            setActiveMultipleDeleteModal(false);
            clearSelection();
          } else if (videoForDelete) {
            submit(
              { data: videoForDelete.id, intent: "delete" },
              { method: "POST" },
            );
            shopify.toast.show("Successfully Deleted!!");
            setVideoForDelete(null);
          }
        }}
      />
    </>
  );
};
