import { useEffect, useRef, useState } from "react";
import "./DraggableList.css";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ItemSettings } from "./ItemSettings";

function SortableItem({
  children,
  id,
  items,
  item,
  onChange,
  index,
  activeItemId,
  setActiveItemId,
  setActiveId,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const active = activeItemId === id;
  const title = item?.title || `List ${item?.id || ""}`;

  // dnd-kit needs a real DOM node + handle; everything inside is web components.
  return (
    <div
      ref={setNodeRef}
      className={`dl-item${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <s-box border="base" borderRadius="base" background="base">
        <s-grid
          gridTemplateColumns="auto minmax(0, 1fr) auto"
          gap="small-200"
          alignItems="center"
        >
          <button
            type="button"
            className="dl-handle"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <s-icon type="drag-handle"></s-icon>
          </button>
          <s-clickable
            padding="small-200"
            accessibilityLabel={`${active ? "Collapse" : "Edit"} ${title}`}
            onClick={() => {
              setActiveItemId(active ? null : id);
              setActiveId(active ? null : id);
            }}
          >
            {/* Title takes the free space; the chevron keeps a fixed column so
                it lines up on every row. */}
            <s-grid
              gridTemplateColumns="minmax(0, 1fr) auto"
              gap="small-200"
              alignItems="center"
            >
              <s-text type="strong">
                {title.length > 20 ? `${title.slice(0, 17)}...` : title}
              </s-text>
              <s-icon type={active ? "chevron-up" : "chevron-down"}></s-icon>
            </s-grid>
          </s-clickable>
          <s-stack direction="inline" gap="small-100">
            <s-button
              variant="tertiary"
              icon="duplicate"
              accessibilityLabel={`Duplicate ${title}`}
              onClick={() =>
                onChange([
                  ...items.slice(0, index),
                  { ...item, id: String(items.length + 1) },
                  ...items.slice(index),
                ])
              }
            ></s-button>
            {items.length > 1 ? (
              <s-button
                variant="tertiary"
                tone="critical"
                icon="x"
                accessibilityLabel={`Remove ${title}`}
                onClick={() => onChange(items.filter((i) => i.id !== id))}
              ></s-button>
            ) : null}
          </s-stack>
        </s-grid>
        {/* Kept mounted (just hidden) so upload selections still apply. */}
        <s-box padding="small" display={active ? "auto" : "none"}>
          <s-stack gap="base">{children}</s-stack>
        </s-box>
      </s-box>
    </div>
  );
}

export default function DraggableList({
  items,
  onChange,
  files,
  setFiles,
  isUploading,
  fileProgress,
  uploadAndSelectedFile,
  setUploadAndSelectedFile,
  uploadAndSelectedImage,
  setUploadedAndSelectedImg,
  setIsUploading,
  submit,
  handleSubmitFile,
  selectedFile,
  setSelectedFile,
  setSelectedImgs,
  loaderData,
  ...props
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const [activeId, setActiveId] = useState(items?.[0]?.id || null);
  function handleDragEnd(event) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex((item) => item.id === active.id);
      const newIndex = items.findIndex((item) => item.id === over.id);
      onChange(arrayMove(items, oldIndex, newIndex));
    }
  }

  const [activeItemId, setActiveItemId] = useState(items?.[0]?.id || null);

  // Auto-open the newly added item whenever items length increases.
  // This catches Add Track, Duplicate, or any other path that grows the list.
  const prevLenRef = useRef(items?.length || 0);
  useEffect(() => {
    const prev = prevLenRef.current;
    const next = items?.length || 0;
    if (next > prev) {
      const newItem = items[next - 1];
      if (newItem?.id) {
        setActiveItemId(newItem.id);
        setActiveId(newItem.id);
      }
    }
    prevLenRef.current = next;
  }, [items]);

  const addTrack = () => {
    const existingIds = items
      .map((i) => Number(i?.id))
      .filter((n) => Number.isFinite(n));
    const nextId = String(
      (existingIds.length ? Math.max(...existingIds) : 0) + 1,
    );
    onChange([
      ...items,
      {
        id: nextId,
        poster:
          "https://placehold.co/500x500/15803d/fff/svg?text=Placeholder+Image\n+\nAudio+Player\nby+bPlugins&font=roboto",
      },
    ]);
    setActiveItemId(nextId);
    setActiveId(nextId);
  };

  return (
    <s-stack gap="small">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items?.map((item, index) =>
            item?.id ? (
              <SortableItem
                key={item?.id + index}
                id={item?.id}
                items={items}
                onChange={onChange}
                index={index}
                activeItemId={activeItemId}
                setActiveItemId={setActiveItemId}
                item={item}
                setActiveId={setActiveId}
              >
                <ItemSettings
                  item={item}
                  items={items}
                  setUploadAndSelectedFile={setUploadAndSelectedFile}
                  setUploadedAndSelectedImg={setUploadedAndSelectedImg}
                  uploadAndSelectedImage={uploadAndSelectedImage}
                  uploadAndSelectedFile={uploadAndSelectedFile}
                  activeId={activeId}
                  index={index}
                  onChange={onChange}
                  handleSubmitFile={handleSubmitFile}
                  selectedFile={selectedFile}
                  setSelectedFile={setSelectedFile}
                  setSelectedImgs={setSelectedImgs}
                  loaderData={loaderData}
                  submit={submit}
                  isUploading={isUploading || fileProgress}
                  setIsUploading={setIsUploading}
                  files={files}
                  setFiles={setFiles}
                  {...props}
                />
              </SortableItem>
            ) : null,
          )}
        </SortableContext>
      </DndContext>
      <s-button icon="plus" onClick={addTrack}>
        Add track
      </s-button>
    </s-stack>
  );
}
