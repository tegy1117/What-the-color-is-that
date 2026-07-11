import { useCallback, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { HsvColor } from "../lib/color";
import styles from "../styles.module.css";

interface ColorPickerProps {
  value: HsvColor;
  onChange: (color: HsvColor) => void;
  disabled?: boolean;
}

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value));

export function ColorPicker({ value, onChange, disabled = false }: ColorPickerProps) {
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const updateSquare = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !squareRef.current) return;
    const rect = squareRef.current.getBoundingClientRect();
    onChange({
      ...value,
      s: clamp(((event.clientX - rect.left) / rect.width) * 100),
      v: clamp(100 - ((event.clientY - rect.top) / rect.height) * 100),
    });
  }, [disabled, onChange, value]);

  const updateHue = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    onChange({ ...value, h: clamp(((event.clientX - rect.left) / rect.width) * 360, 0, 360) });
  }, [disabled, onChange, value]);

  const handlePointer = (event: PointerEvent<HTMLDivElement>, updater: (event: PointerEvent<HTMLDivElement>) => void) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    updater(event);
  };

  const handleSquareKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 5 : 1;
    const changes: Record<string, HsvColor> = {
      ArrowLeft: { ...value, s: clamp(value.s - step) },
      ArrowRight: { ...value, s: clamp(value.s + step) },
      ArrowUp: { ...value, v: clamp(value.v + step) },
      ArrowDown: { ...value, v: clamp(value.v - step) },
    };
    const next = changes[event.key];
    if (next) {
      event.preventDefault();
      onChange(next);
    }
  };

  const handleHueKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    onChange({ ...value, h: (value.h + direction * (event.shiftKey ? 10 : 2) + 360) % 360 });
  };

  return (
    <div className={styles.colorPicker} data-disabled={disabled || undefined}>
      <div
        ref={squareRef}
        className={styles.colorSquare}
        style={{ backgroundColor: `hsl(${value.h} 100% 50%)` }}
        onPointerDown={(event) => handlePointer(event, updateSquare)}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSquare(event); }}
        onKeyDown={handleSquareKey}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="채도와 밝기"
        aria-valuetext={`채도 ${Math.round(value.s)}, 밝기 ${Math.round(value.v)}`}
        aria-disabled={disabled}
      >
        <span className={styles.colorThumb} style={{ left: `${value.s}%`, top: `${100 - value.v}%` }} />
      </div>
      <div
        ref={hueRef}
        className={styles.hueBar}
        onPointerDown={(event) => handlePointer(event, updateHue)}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateHue(event); }}
        onKeyDown={handleHueKey}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="색조"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(value.h)}
        aria-disabled={disabled}
      >
        <span className={styles.hueThumb} style={{ left: `${(value.h / 360) * 100}%` }} />
      </div>
    </div>
  );
}

