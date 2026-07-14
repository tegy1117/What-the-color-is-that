import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { BrandHeader, PRODUCT_TITLE } from "./BrandHeader";

describe("BrandHeader", () => {
  it("keeps the English product title in every locale and has no player avatar", async () => {
    const instance = i18n.cloneInstance();
    await instance.changeLanguage("ko");
    const { container, rerender } = render(<I18nextProvider i18n={instance}><BrandHeader /></I18nextProvider>);
    expect(screen.getByText(PRODUCT_TITLE)).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    await instance.changeLanguage("en");
    rerender(<I18nextProvider i18n={instance}><BrandHeader /></I18nextProvider>);
    expect(screen.getByText(PRODUCT_TITLE)).toBeInTheDocument();
  });
});

