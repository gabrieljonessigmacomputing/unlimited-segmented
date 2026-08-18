import { useEffect, useMemo, type CSSProperties } from "react";
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
]);

type Primitive = string | number;

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

  const selected = useMemo(() => toStringSet(value), [value]);

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

  const commit = (next: Set<string>) => {
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
      commit(selected.has(key) && showAll ? new Set() : new Set([key]));
      return;
    }
    const next = new Set(selected);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    commit(next);
  };

  const clear = () => commit(new Set());

  return (
    <div className="usc-root" style={{ "--usc-accent": accent } as CSSProperties}>
      <div className={`usc-row ${wrap ? "usc-row--wrap" : "usc-row--scroll"}`}>
        {showAll && (
          <button
            type="button"
            className="usc-pill usc-pill--clear"
            aria-pressed={selected.size === 0}
            onClick={clear}
          >
            All
          </button>
        )}
        {options.map((opt) => {
          const key = String(opt);
          return (
            <button
              key={key}
              type="button"
              className="usc-pill"
              aria-pressed={selected.has(key)}
              onClick={() => pick(opt)}
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
