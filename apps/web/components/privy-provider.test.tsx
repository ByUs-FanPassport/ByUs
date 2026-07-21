import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ByUsPrivyProvider } from "./privy-provider";

const provider = vi.fn(({ children }: { children: React.ReactNode }) => children);
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: { children: React.ReactNode }) => provider(props),
}));

describe("ByUs Privy provider policy", () => {
  it("keeps production authentication Google-only", () => {
    render(<ByUsPrivyProvider appId="app-production"><span>child</span></ByUsPrivyProvider>);
    expect(provider).toHaveBeenLastCalledWith(expect.objectContaining({
      config: expect.objectContaining({ loginMethods: ["google"] }),
    }));
  });

  it("adds Privy's official email OTP method only for an already-approved Test Account path", () => {
    render(<ByUsPrivyProvider appId="app-development" testAccountLoginEnabled><span>child</span></ByUsPrivyProvider>);
    expect(provider).toHaveBeenLastCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        loginMethods: ["google", "email"],
        embeddedWallets: { ethereum: { createOnLogin: "all-users" } },
      }),
    }));
  });
});
