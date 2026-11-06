import { useState } from "react";

export function NumericField({ field, value, onChange }: {
  field: { label: string; unit: string; min: number; max: number; step: number; help: string };
  value: number;
  onChange: (value: number) => void;
}) {
  const scale = field.unit === "%" ? 100 : 1;
  const display = Number((value * scale).toPrecision(12));
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  return <label className="strategy-field">
    <span>{field.label} <span className="muted">{field.unit}</span></span>
    <input aria-label={field.label} type="number" value={editing ? text : String(display)} min={field.min * scale} max={field.max * scale} step={field.step * scale}
      onFocus={() => { setText(String(display)); setEditing(true); }}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value) / scale;
        if (e.target.value !== "" && Number.isFinite(v) && v >= field.min && v <= field.max) onChange(v);
      }} onBlur={() => setEditing(false)} />
    <small>{field.help}</small>
  </label>;
}
