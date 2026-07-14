import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./ColorPicker";

describe("ColorPicker", () => {
  it("supports keyboard adjustment and locks when disabled", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker value={{ h: 210, s: 50, v: 50 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getAllByRole("slider")[0]!, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith({ h: 210, s: 51, v: 50 });
    onChange.mockClear();
    rerender(<ColorPicker value={{ h: 210, s: 50, v: 50 }} onChange={onChange} disabled />);
    fireEvent.keyDown(screen.getAllByRole("slider")[0]!, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
