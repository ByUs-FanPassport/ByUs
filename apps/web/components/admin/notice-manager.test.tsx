import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoticeManager } from "./notice-manager";

const getAccessToken = vi.fn(async () => "token");
const setImageRun = vi.fn();
const editor = {
  isEditable: true,
  setEditable: vi.fn(),
  getJSON: () => ({ type: "doc", content: [{ type: "paragraph" }] }),
  commands: { setContent: vi.fn() },
  chain: () => ({
    focus: () => ({
      toggleBold: () => ({ run: vi.fn() }), toggleItalic: () => ({ run: vi.fn() }),
      toggleUnderline: () => ({ run: vi.fn() }), toggleBulletList: () => ({ run: vi.fn() }),
      toggleOrderedList: () => ({ run: vi.fn() }), extendMarkRange: () => ({ setLink: () => ({ run: vi.fn() }) }),
      setImage: () => ({ run: setImageRun }),
    }),
  }),
};
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken }) }));
vi.mock("@tiptap/react", () => ({
  useEditor: (options: { editable: boolean }) => ({ ...editor, isEditable: options.editable }),
  EditorContent: () => <div data-testid="editor" />,
}));
vi.mock("../notice/tiptap-extensions", () => ({ noticeExtensions: [] }));
vi.mock("../notice/notice-body", () => ({ NoticeBody: () => <div /> }));

const noticeRow = {
  id: "notice-1", slug: "hello", publication_status: "draft", pinned: false,
  published_at: null, archived_at: null, archive_reason: null, revision: 1,
  celebrity_notice_localizations: [
    { locale: "ko", title: "첫 공지", body_json: { type: "doc", content: [{ type: "paragraph" }] } },
    { locale: "en", title: "First notice", body_json: { type: "doc", content: [{ type: "paragraph" }] } },
  ],
};

describe("notice manager mutations", () => {
  beforeEach(() => {
    getAccessToken.mockReset();
    getAccessToken.mockResolvedValue("token");
    setImageRun.mockReset();
    editor.setEditable.mockReset();
  });

  it("guards before a delayed token, blocks stale edit targets, and exposes a recoverable error", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response(null, { status: 500 })
        : Response.json({ notices: [noticeRow] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NoticeManager celebrityId="celebrity-1" celebrityName="스타" role="operator" locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: /첫 공지/ }));
    await screen.findByDisplayValue("hello");

    let resolveToken!: (token: string) => void;
    getAccessToken.mockImplementation(() => new Promise((resolve) => { resolveToken = resolve; }));
    const save = screen.getByRole("button", { name: /저장/ });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: /새 공지/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "EN" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /첫 공지/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "공개" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "이미지 업로드" })).toBeDisabled();
    expect(screen.getByDisplayValue("hello")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("저장하는 중입니다");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    resolveToken("token");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /저장/ })).toBeEnabled());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("keeps editing locked through the save refresh and surfaces a GET failure", async () => {
    let resolveRefresh!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ notices: [noticeRow] }))
      .mockResolvedValueOnce(Response.json({ id: "notice-1" }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }))
      .mockResolvedValueOnce(Response.json({ notices: [{ ...noticeRow, revision: 2 }] }));
    vi.stubGlobal("fetch", fetchMock);
    render(<NoticeManager celebrityId="celebrity-1" celebrityName="스타" role="operator" locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: /첫 공지/ }));
    await screen.findByDisplayValue("hello");
    fireEvent.click(screen.getByRole("button", { name: /저장/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(screen.getByDisplayValue("hello")).toBeDisabled();
    expect(screen.getByRole("button", { name: "EN" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("저장하는 중입니다");
    resolveRefresh(new Response(null, { status: 500 }));

    expect(await screen.findByRole("alert")).toHaveTextContent("변경은 처리됐지만 최신 상태를 불러오지 못했습니다");
    expect(screen.queryByText("공지를 저장했습니다.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^저장$/ })).toBeDisabled();
    const recovery = screen.getByRole("button", { name: "최신 상태 불러오기" });
    expect(recovery).toBeEnabled();
    const postCount = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(recovery);
    await waitFor(() => expect(screen.getByRole("button", { name: /^저장$/ })).toBeEnabled());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postCount);
  });

  it("keeps the editor instance alive while an image upload waits for its token", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ url: "https://cdn.example/image.webp" })
        : Response.json({ notices: [noticeRow] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "prompt").mockReturnValue("응원 이미지");
    const { container } = render(<NoticeManager celebrityId="celebrity-1" celebrityName="스타" role="operator" locale="ko" />);
    fireEvent.click(await screen.findByRole("button", { name: /첫 공지/ }));
    await screen.findByDisplayValue("hello");

    let resolveToken!: (token: string) => void;
    getAccessToken.mockImplementation(() => new Promise((resolve) => { resolveToken = resolve; }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "proof.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByRole("button", { name: "이미지 업로드" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    resolveToken("token");
    await waitFor(() => expect(setImageRun).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("이미지를 추가했습니다");
  });
});
