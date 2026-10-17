import { useState, useEffect } from "react";
import "./GradientSelector.css";
import ColorController from "../ColorController/ColorController";

export default function GradientSelector({
  textColor,
  setTextColor,
  backgroundColor,
  setBackgroundColor,
  selectedPreset,
  setSelectedPreset,
  selectionType,
  setSelectionType,
}) {
  const presetGradients = [
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #FF5E5E, #2ECECE)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #00E676, #1E88E5)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #29B6F6, #4FC3F7)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #B388FF, #FF8A80)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #1A237E, #283593)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #FF8A80, #FFCDD2)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #00BCD4, #FFEB3B)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #CE93D8, #B39DDB)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #880E4F, #AD1457)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #FF9800, #F44336)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #FF5722, #FF9800)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #FF9800, #FFEB3B)",
    },
    {
      text: "#000000",
      background: "linear-gradient(to bottom right, #BCAAA4, #D7CCC8)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #8D6E63, #A1887F)",
    },
    {
      text: "#000000",
      background: "linear-gradient(to bottom right, #FFF176, #FFEE58)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #66BB6A, #81C784)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #7E57C2, #9575CD)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #26A69A, #4DB6AC)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #212121, #424242)",
    },
    {
      text: "#000000",
      background: "linear-gradient(to bottom right, #ECEFF1, #CFD8DC)",
    },
    {
      text: "#000000",
      background: "linear-gradient(to bottom right, #E1F5FE, #B3E5FC)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #311B92, #4527A0)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #D50000, #B71C1C)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #004D40, #00796B)",
    },
    {
      text: "#FFFFFF",
      background: "linear-gradient(to bottom right, #00BFA5, #1DE9B6)",
    },
  ];

  useEffect(() => {
    if (!backgroundColor) {
      setBackgroundColor(presetGradients[0]?.background);
      setTextColor(presetGradients[0]?.text);
      setSelectedPreset(0);
      setSelectionType("preset");
    }
  }, []);

  return (
    <s-stack gap="small">
      <s-stack direction="inline" gap="small-200">
        <s-button
          variant={selectionType === "preset" ? "primary" : undefined}
          onClick={() => setSelectionType("preset")}
        >
          Preset gradients
        </s-button>
        <s-button
          variant={selectionType === "custom" ? "primary" : undefined}
          onClick={() => setSelectionType("custom")}
        >
          Custom
        </s-button>
      </s-stack>

      {selectionType === "preset" ? (
        <s-grid gridTemplateColumns="repeat(5, 1fr)" gap="small-200">
          {presetGradients.map((gradient, index) => (
            // Gradient swatches need arbitrary backgrounds, so they stay
            // small custom buttons.
            <button
              key={index}
              type="button"
              aria-label={`Gradient ${index + 1}`}
              className={`preset-button${selectedPreset === index ? " is-selected" : ""}`}
              style={{ background: gradient?.background }}
              onClick={() => {
                setSelectedPreset(index);
                setBackgroundColor(gradient?.background);
                setTextColor(gradient?.text);
              }}
            >
              {selectedPreset === index ? <s-icon type="check"></s-icon> : null}
            </button>
          ))}
        </s-grid>
      ) : (
        <s-stack gap="small">
          <ColorController
            label="Icons color"
            value={textColor}
            onChange={setTextColor}
          />
          <ColorController
            label="Background color"
            value={backgroundColor}
            onChange={setBackgroundColor}
          />
        </s-stack>
      )}
    </s-stack>
  );
}
