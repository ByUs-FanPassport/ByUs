import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Country } from "react-phone-number-input";

import { RecipientPhoneField } from "./recipient-phone-field";

function PhoneHarness({ locale = "ko", onCountry }: { locale?: "ko" | "en"; onCountry?: (country: Country) => void }) {
  const [country, setCountry] = useState<Country>("KR");
  const [value, setValue] = useState("");
  return <RecipientPhoneField
    id="phone"
    locale={locale}
    label={locale === "ko" ? "연락처" : "Phone number"}
    requiredLabel={locale === "ko" ? "필수 입력" : "Required"}
    country={country}
    value={value}
    onCountryChange={(nextCountry) => {
      setCountry(nextCountry);
      onCountry?.(nextCountry);
    }}
    onChange={setValue}
  />;
}

describe("RecipientPhoneField", () => {
  it("searches countries by localized name and calling code", () => {
    render(<PhoneHarness />);
    fireEvent.click(screen.getByRole("combobox", { name: "국가번호" }));
    const search = screen.getByPlaceholderText("국가명 또는 국가번호 검색");
    fireEvent.change(search, { target: { value: "일본" } });
    expect(screen.getByRole("option", { name: /일본JP · \+81/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /미국US/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "+1" } });
    expect(screen.getByRole("option", { name: /미국US · \+1/ })).toBeInTheDocument();
  });

  it("selects with the keyboard and restores focus to the combobox", async () => {
    const onCountry = vi.fn();
    render(<PhoneHarness locale="en" onCountry={onCountry} />);
    const combobox = screen.getByRole("combobox", { name: "Country calling code" });
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    const search = screen.getByPlaceholderText("Search country or calling code");
    fireEvent.change(search, { target: { value: "Japan" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onCountry).toHaveBeenCalledWith("JP");
    await waitFor(() => expect(combobox).toHaveFocus());
    expect(combobox).toHaveTextContent("+81");
  });

  it("closes the country list with Escape and keeps the phone input labeled", async () => {
    render(<PhoneHarness locale="en" />);
    const combobox = screen.getByRole("combobox", { name: "Country calling code" });
    fireEvent.click(combobox);
    const search = screen.getByPlaceholderText("Search country or calling code");
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(combobox).toHaveFocus());
    expect(screen.getByLabelText(/Phone number/)).toHaveAttribute("inputmode", "tel");
  });
});
