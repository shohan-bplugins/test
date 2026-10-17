import React, { useState, useCallback } from "react";
import ColorController from "../ColorController/ColorController";
import { WebNumberField, WebSelect } from "../PolarisWeb/fields";
import "./BoxShadow.css";
import { produce } from "immer";

const BoxShadow = ({ value, onChange, props, defaults = [] }) => {
  const [inset, setInset] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const toggleModal = useCallback(
    () => setModalOpen((modalOpen) => !modalOpen),
    [],
  );

  const defaultVal = [
    {
      hOffset: "0px",
      vOffset: "0px",
      blur: "0px",
      spreed: "0px",
      color: "#dddddd",
      isInset: false,
    },
  ];
  const shadow =
    (value?.length ? value : null) ||
    (defaults?.length ? defaults : null) ||
    defaultVal;

  const updateShadow = (property, val) => {
    const newShadow = produce(shadow, (draft) => {
      if (draft === null || draft === undefined) {
        draft = [];
      }
      draft[activeIndex][property] = val;
    });
    onChange(newShadow);
  };

  const duplicateShadow = (e) => {
    e.preventDefault();
    onChange([
      ...shadow.slice(0, activeIndex),
      { ...shadow[activeIndex] },
      ...shadow.slice(activeIndex),
    ]);

    setActiveIndex(activeIndex + 1);
  };

  const removeShadow = (e) => {
    e.preventDefault();

    onChange([
      ...shadow.slice(0, activeIndex),
      ...shadow.slice(activeIndex + 1),
    ]);

    setActiveIndex(0 === activeIndex ? 0 : activeIndex - 1);
  };

  const {
    hOffset = "0px",
    vOffset = "0px",
    blur = "0px",
    spreed = "0px",
    color = "#dddddd",
    isInset = false,
  } = shadow[activeIndex] || {};

  const SLIDERS = [
    { label: "Horizontal", value: parseInt(hOffset), setter: "hOffset", min: -100, max: 100 },
    { label: "Vertical", value: parseInt(vOffset), setter: "vOffset", min: -100, max: 100 },
    { label: "Blur", value: parseInt(blur), setter: "blur", min: 0, max: 100 },
    { label: "Spread", value: parseInt(spreed), setter: "spreed", min: -50, max: 50 },
  ];

  return (
    <s-stack key={props?.screen} gap="small">
      <s-stack
        direction="inline"
        justifyContent="space-between"
        alignItems="center"
      >
        <s-text>Shadow</s-text>
        <s-button
          icon={modalOpen ? "chevron-up" : "edit"}
          accessibilityLabel={modalOpen ? "Close shadow editor" : "Edit shadow"}
          onClick={toggleModal}
        ></s-button>
      </s-stack>

      {modalOpen ? (
        <s-box padding="small" border="base" borderRadius="base">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">Shadow:</s-text>
              {shadow.map((_, i) => (
                <s-button
                  key={i}
                  variant={activeIndex === i ? "primary" : undefined}
                  onClick={() => setActiveIndex(i)}
                >
                  {i + 1}
                </s-button>
              ))}
            </s-stack>

            <ColorController
              label="Color"
              value={color}
              onChange={(val) => updateShadow("color", val)}
            />

            {SLIDERS.map(({ label, value, setter, min, max }) => (
              <s-stack key={setter} gap="small-300">
                <s-text>{label}</s-text>
                <s-grid
                  gridTemplateColumns="minmax(0, 1fr) 88px"
                  gap="small"
                  alignItems="center"
                >
                  {/* No range-slider web component yet. */}
                  <input
                    type="range"
                    className="bs-range"
                    aria-label={label}
                    min={min}
                    max={max}
                    value={value || 0}
                    onChange={(e) => updateShadow(setter, +e.target.value)}
                  />
                  <WebNumberField
                    label={label}
                    labelAccessibilityVisibility="exclusive"
                    value={String(value || 0)}
                    min={min}
                    max={max}
                    onChange={(v) => {
                      const n = parseFloat(v);
                      if (!Number.isNaN(n)) updateShadow(setter, n);
                    }}
                  />
                </s-grid>
              </s-stack>
            ))}

            <WebSelect
              label="Position"
              value={isInset ? "inset" : "outline"}
              options={[
                { label: "Outline", value: "outline" },
                { label: "Inset", value: "inset" },
              ]}
              onChange={(v) => updateShadow("isInset", v === "inset")}
            />

            <s-stack direction="inline" gap="small-200">
              <s-button
                tone="critical"
                icon="x"
                onClick={(e) => removeShadow(e)}
              >
                Remove
              </s-button>
              <s-button icon="duplicate" onClick={(e) => duplicateShadow(e)}>
                Duplicate
              </s-button>
              <s-button
                icon="plus"
                onClick={() => {
                  onChange([...shadow, defaultVal[0]]);
                  setActiveIndex(shadow.length);
                }}
              >
                Add shadow
              </s-button>
            </s-stack>
          </s-stack>
        </s-box>
      ) : null}
    </s-stack>
  );
};

export default BoxShadow;
