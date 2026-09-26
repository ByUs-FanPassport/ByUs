import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APP_LOCALES } from "../../i18n/locales";
import { FanLanguageSwitch } from "./fan-language-switch";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("FanLanguageSwitch", () => {
  beforeEach(() => push.mockReset());

  it("opens an accessible 11-language menu and preserves route state", async () => {
    render(
      <FanLanguageSwitch
        locale="ko"
        href="/c/kara?tab=notice&locale=en&source=home#latest"
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "언어 선택, 현재 한국어" });
    expect(trigger).toHaveValue("ko");
    fireEvent.click(trigger);

    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option")).toHaveLength(APP_LOCALES.length);
    expect(within(listbox).getByRole("option", { name: "한국어" })).toHaveAttribute("aria-selected", "true");

    const japanese = within(listbox).getByRole("option", { name: "日本語" });
    fireEvent.pointerDown(japanese, { button: 0, pointerType: "mouse" });
    fireEvent.click(japanese);
    expect(push).toHaveBeenCalledWith("/c/kara?tab=notice&locale=ja&source=home#latest");
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    render(<FanLanguageSwitch locale="en" href="/live?locale=ko" />);
    const trigger = screen.getByRole("combobox", { name: "Choose language, currently English" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const listbox = await screen.findByRole("listbox");
    fireEvent.keyDown(listbox, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(push).not.toHaveBeenCalled();
  });
});
