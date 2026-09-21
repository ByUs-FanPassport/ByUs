import { render, waitFor, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BanksyOutboundLinks, BanksyVisitTracker } from "./banksy-campaign";
const params = vi.hoisted(() => ({ value: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => params.value }));
const A = "10000000-0000-4000-8000-000000000001", B = "10000000-0000-4000-8000-000000000002", V = "20000000-0000-4000-8000-000000000001";
beforeEach(() => { sessionStorage.clear(); params.value = new URLSearchParams(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe("campaign client session", () => {
  it("records once and preserves attribution on internal navigation", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ visitId: V }));
    params.value.set("campaign_link", A);
    const view = render(<><BanksyVisitTracker /><BanksyOutboundLinks locale="ko" surface="raffle_list" /></>);
    await waitFor(() => expect(screen.getByText("전시 자세히 보기").getAttribute("href")).toContain(V));
    params.value = new URLSearchParams(); view.rerender(<><BanksyVisitTracker /><BanksyOutboundLinks locale="ko" surface="raffle_list" /></>);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({ linkId: A, sequence: 0 });
  });
  it("retries a failed later touch rather than treating the old visit ID as success", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ visitId: V }));
    params.value.set("campaign_link", A);
    const view = render(<BanksyVisitTracker />);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("byus.banksy.touch.v1")!).recordedSequence).toBe(0));
    fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    params.value = new URLSearchParams({ campaign_link: B }); view.rerender(<BanksyVisitTracker />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    view.unmount(); render(<BanksyVisitTracker />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toMatchObject({ linkId: B, sequence: 1 });
  });
  it("keeps the first source after its request fails and another link arrives", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValue(Response.json({ visitId: V }));
    params.value.set("campaign_link", A);
    const view = render(<BanksyVisitTracker />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    params.value = new URLSearchParams({ campaign_link: B }); view.rerender(<BanksyVisitTracker />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ firstLinkId: A, linkId: B, sequence: 1 });
  });
  it("stores a delayed success after leaving the list so the receipt stays linked", async () => {
    let resolve!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    params.value.set("campaign_link", A);
    const view = render(<BanksyVisitTracker />);
    view.unmount();
    render(<BanksyOutboundLinks locale="ko" surface="raffle_receipt" />);
    resolve(Response.json({ visitId: V }));
    await waitFor(() => expect(screen.getByText("전시 자세히 보기").getAttribute("href")).toContain(V));
  });
  it("gives intentional clicks new retry keys and works without stored identity", () => {
    render(<BanksyOutboundLinks locale="ko" surface="raffle_receipt" />);
    const anchor = screen.getByText("전시 자세히 보기");
    anchor.addEventListener("click", e => e.preventDefault());
    fireEvent.click(anchor); const first = anchor.getAttribute("href");
    fireEvent.click(anchor); const second = anchor.getAttribute("href");
    expect(first).toContain("request="); expect(first).not.toBe(second); expect(second).not.toContain("visit=");
  });
});
