import { useCallback, useState, useRef, useEffect } from "react";
import { CustomButton, CustomBox } from "../../utils/polarisWebComponents";
import UploadField from "../UploadField/UploadField";

// Duplicate icon
const DuplicateIcon = () => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
    <path d="M6 6V2a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1h-4v4a1 1 0 01-1 1H2a1 1 0 01-1-1V7a1 1 0 011-1h4zm2 0h4a1 1 0 011 1v4h3V3H8v3zm-1 2H3v8h8V8H7z" />
  </svg>
);

// Generate a unique ID
const generateId = () =>
  `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Ensure every item has a unique _id
const ensureIds = (items) =>
  items.map((item) => (item._id ? item : { ...item, _id: generateId() }));

const MultipleVideoItems = ({
  items,
  setItems,
  shopify,
  activeItemIndex,
  setActiveItemIndex,
  setUploadedAndSelectedFile,
  setUploadedAndSelectedImg,
}) => {
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const dragCounter = useRef({});
  const initialized = useRef(false);

  // Assign IDs to items on first render & auto-expand first item
  useEffect(() => {
    if (!initialized.current && items.length > 0) {
      initialized.current = true;
      const itemsWithIds = ensureIds(items);
      // Check if any items were missing IDs
      const needsUpdate = items.some((item) => !item._id);
      if (needsUpdate) {
        setItems(itemsWithIds);
      }
      // Expand first item by default
      setExpandedId(itemsWithIds[0]._id);
    }
  }, [items, setItems]);

  // --- Expand/Collapse by ID ---
  const toggleExpand = useCallback((id) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // --- Drag & Drop Handlers ---
  // IMPORTANT: e.stopPropagation() prevents events from bubbling up
  // to the parent Shopify DropZone, which would trigger a file upload
  // with undefined data and cause a GraphQL error.
  const handleDragStart = useCallback((e, index) => {
    e.stopPropagation();
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", index.toString());
    if (e.target && e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(e.target, 0, 0);
    }
  }, []);

  const handleDragEnd = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    setDragIndex(null);
    setDragOverIndex(null);
    dragCounter.current = {};
  }, []);

  const handleDragEnter = useCallback((e, index) => {
    e.stopPropagation();
    e.preventDefault();
    if (!dragCounter.current[index]) dragCounter.current[index] = 0;
    dragCounter.current[index]++;
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback((e, index) => {
    e.stopPropagation();
    e.preventDefault();
    if (dragCounter.current[index]) dragCounter.current[index]--;
    if (dragCounter.current[index] === 0) {
      setDragOverIndex((prev) => (prev === index ? null : prev));
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback(
    (e, dropIndex) => {
      e.stopPropagation();
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (isNaN(fromIndex) || fromIndex === dropIndex) {
        setDragIndex(null);
        setDragOverIndex(null);
        dragCounter.current = {};
        return;
      }
      setItems((prevItems) => {
        const newItems = [...prevItems];
        const [movedItem] = newItems.splice(fromIndex, 1);
        newItems.splice(dropIndex, 0, movedItem);
        return newItems;
      });
      setDragIndex(null);
      setDragOverIndex(null);
      dragCounter.current = {};
    },
    [setItems],
  );

  // --- Item CRUD ---
  const addItem = useCallback(() => {
    const newId = generateId();
    setItems((prev) => [...prev, { _id: newId, video: "", poster: "" }]);
    setExpandedId(newId);
  }, [setItems]);

  const removeItem = useCallback(
    (index, id) => {
      setItems((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((_, i) => i !== index);
      });
      setExpandedId((prevId) => (prevId === id ? null : prevId));
    },
    [setItems],
  );

  const duplicateItem = useCallback(
    (index) => {
      const newId = generateId();
      setItems((prev) => {
        const newItems = [...prev];
        const clone = { ...newItems[index], _id: newId };
        newItems.splice(index + 1, 0, clone);
        return newItems;
      });
      setExpandedId(newId);
    },
    [setItems],
  );

  const updateItem = useCallback(
    (index, field, value) => {
      setItems((prev) =>
        prev.map((item, i) =>
          i === index ? { ...item, [field]: value } : item,
        ),
      );
    },
    [setItems],
  );

  return (
    <CustomBox
      className="mvi-container"
      // Block any drag events from this whole container from reaching parent DropZone
      onDragOver={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {/* Scrollable items list */}
      <CustomBox className="mvi-items-list">
        {items.map((item, index) => {
          const id = item._id;
          const isExpanded = expandedId === id;
          const isDragging = dragIndex === index;
          const isDragOver = dragOverIndex === index && dragIndex !== index;

          return (
            <CustomBox
              key={id || index}
              className={`mvi-item${isDragging ? " mvi-dragging" : ""}${isDragOver ? " mvi-drag-over" : ""}${isExpanded ? " mvi-expanded" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragLeave={(e) => handleDragLeave(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
            >
              {/* Clickable header row */}
              <div className="mvi-item-header" onClick={() => toggleExpand(id)}>
                {/* Drag handle */}
                <div
                  className="mvi-drag-handle"
                  onClick={(e) => e.stopPropagation()}
                >
                  <s-icon type="drag-handle" />
                </div>

                {/* Item label badge — always "Video N" */}
                <span className="mvi-item-badge">Video {index + 1}</span>

                {/* Duplicate button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    duplicateItem(index);
                  }}
                  title="Duplicate item"
                  className="mvi-action-btn mvi-duplicate-btn"
                >
                  <DuplicateIcon />
                </button>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    removeItem(index, id);
                  }}
                  disabled={items.length <= 1}
                  title="Remove item"
                  className={`mvi-action-btn mvi-delete-btn${items.length <= 1 ? " disabled" : ""}`}
                >
                  <s-icon type="delete" />
                </button>
              </div>

              {/* Expandable fields area */}
              <CustomBox
                className={`mvi-item-fields-wrapper${isExpanded ? " expanded" : ""}`}
              >
                <CustomBox className="mvi-item-fields">
                  {/* Both fields previously shared one id (FileUpload-${id}),
                      so each item rendered duplicate ids and the Poster label
                      pointed at the Video input. UploadField owns its ids. */}
                  <UploadField
                    label="Video URL"
                    value={item.video || ""}
                    onChange={(next) => updateItem(index, "video", next)}
                    pickLabel="Choose a video"
                    onPick={(e) => {
                      e.preventDefault();
                      setActiveItemIndex(index);
                      // Reset so useEffect fires fresh on the new selection
                      if (setUploadedAndSelectedFile)
                        setUploadedAndSelectedFile(null);
                      if (shopify) shopify.modal.show("upload-video");
                    }}
                  />

                  <UploadField
                    label="Poster URL"
                    value={item.poster || ""}
                    onChange={(next) => updateItem(index, "poster", next)}
                    pickLabel="Choose a poster image"
                    onPick={(e) => {
                      e.preventDefault();
                      setActiveItemIndex(index);
                      if (setUploadedAndSelectedImg)
                        setUploadedAndSelectedImg(null);
                      if (shopify) shopify.modal.show("upload-img");
                    }}
                  />
                </CustomBox>
              </CustomBox>
            </CustomBox>
          );
        })}
      </CustomBox>

      {/* Sticky Add Item button */}
      <CustomBox className="mvi-add-btn-wrapper">
        <CustomButton
          type="button"
          onClick={(e) => {
            e.preventDefault();
            addItem();
          }}
          className="mvi-add-btn"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
          </svg>
          Add video item
        </CustomButton>
      </CustomBox>
    </CustomBox>
  );
};

export default MultipleVideoItems;
