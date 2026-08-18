import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { client, useConfig, useElementData, useVariable } from "@sigmacomputing/plugin";

// NOTE: don't restrict the Target Control field's allowedTypes by multiSelect —
// it's unverified whether Sigma classifies a native multi-select list control as
// 'text-list' to the plugin SDK, and an over-eager restriction can hide the very
// control multi-select needs. Multi-select only works end-to-end when Target
// Control is bound to a control whose Selection Mode is actually "Multiple";
// a single-select control can only ever hold one value no matter what we send it.
client.config.configureEditorPanel([
  { name: "source", type: "element", label: "Options Source" },
  {
    name: "optionColumn",
    type: "column",
    source: "source",
    allowMultiple: false,
    label: "Option Column",
  },
  { name: "control", type: "variable", label: "Target Control" },
  { name: "multiSelect", type: "toggle", label: "Multi-select", defaultValue: false },
  { name: "wrap", type: "toggle", label: "Wrap to rows", defaultValue: true },
  { name: "showAll", type: "toggle", label: 'Show "All" clear pill', defaultValue: false },
  { name: "accent", type: "color", label: "Accent Color" },
  { name: "sortOrder", type: "dropdown", values: ["asc", "desc"], label: "Sort Order" },
  {
    name: "shape",
    type: "dropdown",
    values: ["pill", "segmented"],
    defaultValue: "pill",
    label: "Shape",
  },
  {
    name: "horizontalAlign",
    type: "dropdown",
    values: ["left", "center", "right"],
    defaultValue: "left",
    label: "Horizontal Align",
  },
  {
    name: "verticalAlign",
    type: "dropdown",
    values: ["top", "center", "bottom"],
    defaultValue: "top",
    label: "Vertical Align",
  },
  { name: "label", type: "text", label: "Label", placeholder: "e.g. Vertical" },
  { name: "showLabel", type: "toggle", label: "Show Label", defaultValue: true },
]);

type Primitive = string | number;

const JUSTIFY_MAP: Record<string, "flex-start" | "center" | "flex-end"> = {
  left: "flex-start",
  top: "flex-start",
  center: "center",
  right: "flex-end",
  bottom: "flex-end",
};

const TEXT_ALIGN_MAP: Record<string, "left" | "center" | "right"> = {
  left: "left",
  center: "center",
  right: "right",
};

// Sigma variable values sometimes arrive wrapped (e.g. { value: ... }) rather than raw.
function unwrapVariable(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if ("value" in obj) return unwrapVariable(obj.value);
    if ("defaultValue" in obj) return unwrapVariable(obj.defaultValue);
    return null;
  }
  return raw;
}

function toStringSet(value: unknown): Set<string> {
  const unwrapped = unwrapVariable(value);
  if (unwrapped === null || unwrapped === undefined || unwrapped === "") return new Set();
  if (Array.isArray(unwrapped)) return new Set(unwrapped.map(String));
  return new Set([String(unwrapped)]);
}

type PillItem = {
  key: string;
  label: string;
  pressed: boolean;
  onClick: () => void;
  isClear?: boolean;
};

function pillClassName(shape: string, item: PillItem, index: number, total: number): string {
  const classes = ["usc-pill"];
  if (item.isClear) classes.push("usc-pill--clear");
  if (shape === "segmented") {
    classes.push("usc-pill--segmented");
    if (index === 0) classes.push("usc-pill--seg-first");
    if (index === total - 1) classes.push("usc-pill--seg-last");
  }
  return classes.join(" ");
}

export default function App() {
  const config = useConfig();
  const optionColumn = Array.isArray(config.optionColumn)
    ? config.optionColumn[0]
    : config.optionColumn;
  const data = useElementData(config.source ?? "");
  const [value, setValue] = useVariable(config.control ?? "");

  const wrap = config.wrap ?? true;
  const multiSelect = Boolean(config.multiSelect);
  const showAll = Boolean(config.showAll);
  const accent = (config.accent as string) || "#7AC142";
  const sortOrder = config.sortOrder === "desc" ? "desc" : "asc";
  const shape = config.shape === "segmented" ? "segmented" : "pill";
  const horizontalAlign = config.horizontalAlign in JUSTIFY_MAP ? config.horizontalAlign : "left";
  const verticalAlign = config.verticalAlign in JUSTIFY_MAP ? config.verticalAlign : "top";
  const label = (config.label as string) || "";
  const showLabel = config.showLabel ?? true;

  const ready = Boolean(config.source && optionColumn && config.control);

  useEffect(() => {
    client.config.setLoadingState(!ready);
  }, [ready]);

  const options = useMemo<Primitive[]>(() => {
    if (!optionColumn) return [];
    const raw = (data?.[optionColumn] ?? []) as Primitive[];
    const deduped = [...new Set(raw.filter((v) => v !== null && v !== undefined))];
    deduped.sort((a, b) => {
      const cmp = String(a).localeCompare(String(b), undefined, { numeric: true });
      return sortOrder === "desc" ? -cmp : cmp;
    });
    return deduped;
  }, [data, optionColumn, sortOrder]);

  // The plugin owns pill highlighting locally rather than deriving it fresh from
  // the bound control's echoed value on every render. A control that can only
  // hold one value (single-select) would otherwise immediately "forget" every
  // pill but the most recently clicked one, even in multi-select mode — the
  // plugin's own selection state is the thing that should persist a click,
  // independent of what the workbook control is actually capable of storing.
  // Seed it exactly once per control binding, as soon as that control's current
  // value is known; after that, only user clicks change it.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const seededControlRef = useRef<string | null>(null);

  useEffect(() => {
    const controlKey = config.control ?? null;
    if (seededControlRef.current === controlKey) return;
    if (value === undefined) return;
    seededControlRef.current = controlKey;
    setSelected(toStringSet(value));
  }, [config.control, value]);

  if (!config.source) {
    return <div className="usc-message">Select an options source.</div>;
  }
  if (!optionColumn) {
    return <div className="usc-message">Select an option column.</div>;
  }
  if (!config.control) {
    return <div className="usc-message">Bind a target control.</div>;
  }
  if (options.length === 0) {
    return <div className="usc-message">No options found in the selected column.</div>;
  }

  // Update the plugin's own highlighting immediately (this is what the user
  // sees and clicks against) and separately, best-effort, push the new
  // selection out to the bound control. Whether the workbook actually filters
  // on all of it depends on that control's own capacity (Selection Mode), but
  // the plugin's pills always reflect exactly what was clicked either way.
  const applySelection = (next: Set<string>) => {
    setSelected(next);
    if (multiSelect) {
      // The SDK's underlying setVariable(configId, ...values) is variadic —
      // list-typed control variables are written as spread positional values,
      // not a single array argument (mirrors the documented range-variable pattern).
      void setValue(...next);
    } else {
      void setValue([...next][0] ?? "");
    }
  };

  const pick = (opt: Primitive) => {
    const key = String(opt);
    if (!multiSelect) {
      applySelection(selected.has(key) && showAll ? new Set() : new Set([key]));
      return;
    }
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    applySelection(next);
  };

  const clear = () => applySelection(new Set());

  const pillItems: PillItem[] = [
    ...(showAll
      ? [{ key: "__all__", label: "All", pressed: selected.size === 0, onClick: clear, isClear: true }]
      : []),
    ...options.map((opt) => {
      const key = String(opt);
      return { key, label: key, pressed: selected.has(key), onClick: () => pick(opt) };
    }),
  ];

  return (
    <div
      className="usc-root"
      style={
        {
          "--usc-accent": accent,
          justifyContent: JUSTIFY_MAP[verticalAlign],
        } as CSSProperties
      }
    >
      {showLabel && label && (
        <div className="usc-label" style={{ textAlign: TEXT_ALIGN_MAP[horizontalAlign] }}>
          {label}
        </div>
      )}
      <div
        className={`usc-row ${wrap ? "usc-row--wrap" : "usc-row--scroll"} ${
          shape === "segmented" ? "usc-row--segmented" : "usc-row--pill"
        }`}
        style={{ justifyContent: JUSTIFY_MAP[horizontalAlign] }}
      >
        {pillItems.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={pillClassName(shape, item, index, pillItems.length)}
            aria-pressed={item.pressed}
            onClick={item.onClick}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
