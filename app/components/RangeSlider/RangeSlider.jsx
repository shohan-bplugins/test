import React, { useState, useEffect, useMemo } from 'react';
import './RangeSlider.css';
// Reusable Range Slider Component
// It combines a range slider and a number input for precise control.
const RangeSlider = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  initialValue = 50,
  onChange, // Callback for when the value changes: (newValue) => void
}) => {
  // Controlled component pattern: manages internal state, but exposes changes via onChange.
  const [currentValue, setCurrentValue] = useState(value || initialValue);
  
  // Sync internal state if the initialValue prop changes externally
  useEffect(() => {
    setCurrentValue(value || initialValue);
  }, [initialValue,value]);

  // Calculate the percentage of progress for the custom track styling
  const progressPercentage = useMemo(() => {
    const clampedValue = Math.max(min, Math.min(max, currentValue));
    // Calculate progress as a percentage
    return ((clampedValue - min) / (max - min)) * 100;
  }, [currentValue, min, max]);


  // Handler for both range and number inputs
  const handleChange = (e) => {
    let newValue = parseFloat(e.target.value);
    
    // If input is cleared or invalid, revert to min or previous valid value
    if (isNaN(newValue)) {
      newValue = min; 
    }
    
    // Clamp the value to ensure it stays within min/max bounds
    const clampedValue = Math.max(min, Math.min(max, newValue));

    setCurrentValue(clampedValue);
    
    // Trigger the external onChange handler
    if (onChange) {
      onChange(clampedValue);
    }
  };

  // Handler for number input blur/commit (to enforce min/max when user finishes typing)
  const handleBlur = (e) => {
     let newValue = parseFloat(e.target.value);
     if (isNaN(newValue)) {
      newValue = min;
     }
     const clampedValue = Math.max(min, Math.min(max, newValue));
     setCurrentValue(clampedValue);
     if (onChange) {
       onChange(clampedValue);
     }
  };
  


  return (
    <div className="slider-container">

      {/* Label (Uppercase as in the image) */}
      <label htmlFor={`range-slider-${label}`} className="slider-label">
        {label}
      </label>

      <div className="input-wrapper">
        {/* Main Range Slider Input */}
        <input
          id={`range-slider-${label}`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={currentValue}
          onChange={handleChange}
          className="custom-range-slider"
          // Set the CSS variable for dynamic track filling
          style={{ '--progress': `${progressPercentage}%` }}
        />

        {/* Text Input for Display and Manual Entry */}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={currentValue}
          onChange={handleChange}
          onBlur={handleBlur}
          className="number-input"
          aria-label={`${label} value`}
        />
      </div>
    </div>
  );
};

export default RangeSlider;