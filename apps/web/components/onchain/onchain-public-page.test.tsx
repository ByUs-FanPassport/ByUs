import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PublicOnchainResult } from "@/server/onchain/public-types";
import { OnchainPublicPage } from "./onchain-public-page";

const available: PublicOnchainResult = {
  state: "available",
  snapshot: {
    version: 2,
    network: "GIWA Sepolia",
    chainId: 91342,
    hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d",
    environmentId: "0xenvironment",
    schemaUid: "0xschema",
    fromBlock: "35954883",
    blockNumber: "35955000",
    blockHash: "0xblock",
    blockTimestamp: "2026-09-13T00:00:00.000Z",
    generatedAt: "2026-09-13T00:01:00.000Z",
    deployments: [
      { label: "Legacy ActionHub", hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d", fromBlock: "35954883", actionCount: 2, writeStatus: "current" },
      { label: "New ActionHub", hubAddress: "0xbd9991a26d0a0bf744ecdb8ad4f59f60a9132956", fromBlock: "35969543", actionCount: 0, writeStatus: "pending_activation" },
    ],
    business: { uniqueActiveWallets: 1, actionCounts: { 10: 0 }, passportCredentials: 0, mintedCredentials: 0, lifecycleTransactions: 1, currentActionTransactions: 0 },
    raw: { uniqueActiveWallets: 1, actionCounts: { 10: 1 }, passportCredentials: 0, mintedCredentials: 0, lifecycleTransactions: 3, currentActionTransactions: 1 },
    excludedQaWallets: ["0x29b000d7791c671a9556a0c83b985b7487364082"],
    excludedQaActions: 1,
    historicalActions: 0,
    actions: [
      { actionId: "0xaction", occurrenceId: "0xoccurrence", sourceOccurrence: "0xsource", revision: 0, actionCode: 10, wallet: "0x29b000d7791c671a9556a0c83b985b7487364082", creatorId: "creator", campaignId: "campaign", occurredDay: 20709, easUid: "0xeas", txHash: "0xtx", blockNumber: "35954999", hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d", environmentId: "0xenvironment", sourceDeployment: "Legacy ActionHub", status: "ACTIVE", current: true, qa: true, origin: "NATIVE", credentials: [] },
      { actionId: "0xexpired", occurrenceId: "0xexpired-occurrence", sourceOccurrence: "0xexpired-source", revision: 0, actionCode: 9, wallet: "0x0000000000000000000000000000000000000001", creatorId: "", campaignId: "", occurredDay: 20708, easUid: "0xexpired-eas", txHash: "0xexpired-tx", blockNumber: "35954998", hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d", environmentId: "0xenvironment", sourceDeployment: "Legacy ActionHub", status: "ACTIVE", current: false, qa: false, origin: "NATIVE", credentials: [] },
    ],
    transactions: [
      { txHash: "0xtx", blockNumber: "35954999", hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d", kind: "record", qa: true, origin: "NATIVE" },
      { txHash: "0xcorrect", blockNumber: "35955000", hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d", kind: "correct", qa: true, origin: "NATIVE" },
      { txHash: "0xinvalidate", blockNumber: "35955001", hubAddress: "0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d", kind: "invalidate", qa: true, origin: "NATIVE" },
    ],
  },
};

describe("OnchainPublicPage", () => {
  it("keeps an unavailable snapshot distinct from zero and publishes all action definitions", () => {
    render(<OnchainPublicPage locale="ko" result={{ state: "unavailable" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("수치를 0으로 표시하지 않습니다");
    expect(screen.getAllByText("—").length).toBeGreaterThan(4);
    expect(screen.getByRole("table", { name: "행동 정의와 공개 상태" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(12);
    expect(screen.getByText("회원가입 수, 전체 댓글 수, 구매 인증은 현재 이 원장에 기록되지 않습니다. 값이 없는 항목은 0건이 아니라 미기록 상태입니다.")).toBeInTheDocument();
  });

  it("labels QA evidence and links every public proof surface", () => {
    render(<OnchainPublicPage locale="en" result={available} />);
    const evidence = screen.getByRole("heading", { name: "Daily check-in", level: 3 }).closest("li");
    expect(evidence).not.toBeNull();
    expect(within(evidence!).getByText("QA")).toBeInTheDocument();
    expect(within(evidence!).getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Excluded from current count")).toBeInTheDocument();
    expect(within(evidence!).getByRole("link", { name: /Transaction/ })).toHaveAttribute("href", "https://sepolia-explorer.giwa.io/tx/0xtx");
    expect(within(evidence!).getByText("0xeas")).toBeInTheDocument();
    expect(within(evidence!).getByRole("link", { name: /EAS issuance log/ })).toHaveAttribute("href", "https://sepolia-explorer.giwa.io/tx/0xtx#logs");
    expect(within(evidence!).getByRole("link", { name: /Legacy ActionHub/ })).toHaveAttribute("href", "https://sepolia-explorer.giwa.io/address/0xba3d8f804a316ef0675083e0ed6a1b5435b7bf0d");
    expect(screen.getByText("QA record only")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Correction 0xcorrect/ })).toHaveAttribute("href", "https://sepolia-explorer.giwa.io/tx/0xcorrect");
    expect(screen.getByRole("link", { name: /Invalidation 0xinvalidate/ })).toHaveAttribute("href", "https://sepolia-explorer.giwa.io/tx/0xinvalidate");
    expect(screen.getByRole("link", { name: "Download full JSON" })).toHaveAttribute("href", "/api/public/onchain");
  });
});
