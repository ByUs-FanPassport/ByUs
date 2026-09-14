"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Grid2X2,
  Link as LinkIcon,
  Search,
  X,
} from "lucide-react";
import { CreatorAvatar } from "@/components/fan-ui/creator-avatar";
import { CreatorImage } from "@/components/fan-ui/creator-image";
import { FanWordmarkLink } from "@/components/fan-shell/fan-wordmark-link";
import { AccessibleOverlay } from "@/components/ui/overlay/accessible-overlay";
import {
  BusinessInquiryProvider,
  InquiryButton,
} from "@/components/us-fanmeetings/inquiry-dialog";
import {
  promotionCopy,
  resolveProfile,
  searchProfiles,
  type PromotionProfile,
} from "../domain/promotion";
import styles from "./promotion-page.module.css";

type Locale = "ko" | "en";
export function PromotionPage({
  profiles,
  locale,
  initialSlug,
  unavailable = false,
}: {
  profiles: readonly PromotionProfile[];
  locale: Locale;
  initialSlug?: string;
  unavailable?: boolean;
}) {
  const en = locale === "en";
  const t = (ko: string, english: string) => (en ? english : ko);
  const [slug, setSlug] = useState(
    () => resolveProfile(profiles, initialSlug ?? "")?.slug ?? "",
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(slug);
  const [page, setPage] = useState(0);
  const [mobile, setMobile] = useState(false);
  const [feedback, setFeedback] = useState<{
    key: string;
    success: boolean;
    text: string;
  } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = resolveProfile(profiles, slug);
  const copy = selected ? promotionCopy(selected.slug, locale) : null;
  const result = searchProfiles(profiles, query);
  const pageSize = mobile ? 9 : 12;
  const pageCount = Math.max(1, Math.ceil(result.length / pageSize));
  const visiblePage = Math.min(page, pageCount - 1);
  const guideHref = (path: string, targetLocale = locale) =>
    `${path}?${new URLSearchParams({ locale: targetLocale, ...(slug ? { celebrity: slug } : {}) })}`;
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const choose = (next: string) => {
    setSlug(next);
    setFeedback(null);
    const url = new URL(window.location.href);
    url.searchParams.set("celebrity", next);
    window.history.replaceState(null, "", url);
    try {
      window.sessionStorage.setItem("byus-promotion-selection", next);
    } catch {
      /* optional preference storage */
    }
  };
  useEffect(() => {
    if (initialSlug) return;
    try {
      const stored = window.sessionStorage.getItem("byus-promotion-selection");
      if (stored && resolveProfile(profiles, stored)) setSlug(stored);
    } catch {
      /* private browsing can disable storage */
    }
  }, [initialSlug, profiles]);
  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback({
        key,
        success: true,
        text: t(
          "복사했어요. 원하는 곳에 붙여넣어 주세요.",
          "Copied. Paste it wherever you want to share it.",
        ),
      });
    } catch {
      setFeedback({
        key,
        success: false,
        text: t(
          "복사하지 못했어요. 아래 문구를 직접 선택해서 복사해 주세요.",
          "Couldn't copy. Select and copy the text below instead.",
        ),
      });
    }
  };
  const copyButton = (
    key: string,
    label: string,
    text?: string,
    primary = false,
  ) => (
    <button
      type="button"
      className={`${styles.button} ${primary ? styles.primary : ""}`}
      disabled={!text}
      onClick={() => void copyText(key, text!)}
    >
      {feedback?.key === key && feedback.success ? (
        <Check size={17} />
      ) : (
        <Copy size={17} />
      )}
      {feedback?.key === key && feedback.success
        ? t("복사 완료", "Copied")
        : label}
    </button>
  );
  const avatar = (
    profile: PromotionProfile,
    isSelected: boolean,
    onClick: () => void,
    extra = "",
  ) => (
    <button
      key={profile.slug}
      type="button"
      aria-pressed={isSelected}
      className={`${styles.person} ${extra}`}
      onClick={onClick}
    >
      <span className={styles.avatarRing}>
        <CreatorAvatar
          slug={profile.slug}
          src={profile.image.url}
          photos={profile.image.photos}
          position={profile.image.position}
          size={{ mobile: 52, desktop: 64 }}
        />
      </span>
      <span>{profile.name}</span>
    </button>
  );
  const openPicker = (search = "") => {
    setFeedback(null);
    setQuery(search);
    setPage(0);
    setDraft(slug);
    setOpen(true);
  };
  const methods = [
    {
      title: t("프로필에 링크 넣기", "Add your link to your profile"),
      description: t(
        "소개란에 팬페이지 링크를 등록해두세요.\n팬들이 언제든 내 소식과 활동을 찾아볼 수 있어요.",
        "Add your fan page link to your bio so fans can find your updates and activities anytime.",
      ),
      label: t("프로필용 한 줄", "A line for your bio"),
      content: copy?.bio,
      button: t("프로필 문구 복사", "Copy bio text"),
      hint: t(
        "프로필 편집 → 링크 추가 → 내 팬페이지 주소 붙여넣기",
        "Edit profile → Add link → Paste your fan page URL",
      ),
    },
    {
      title: t("라이브 전에 스토리 올리기", "Post a story before going live"),
      description: t(
        "라이브를 시작하기 전에 스토리로 알려주세요.\n문구와 함께 링크 스티커를 꼭 넣어주세요.",
        "Let fans know before you go live. Add a link sticker along with your message.",
      ),
      label: t("스토리용 문구", "Text for your story"),
      content: copy?.story,
      button: t("스토리 문구 복사", "Copy story text"),
      hint: t(
        "스토리 작성 → 링크 스티커 → 내 팬페이지 주소 붙여넣기",
        "Create story → Link sticker → Paste your fan page URL",
      ),
    },
    {
      title: t(
        "라이브 화면에 주소 띄우기",
        "Show your URL on your live screen",
      ),
      description: t(
        "방송을 보던 팬이 바로 찾아올 수 있도록\n짧은 주소를 화면에 띄우고 말로도 안내해주세요.",
        "Show your short URL on screen and mention it during your live so viewers can find your fan page.",
      ),
      label: t("방송 중 안내 멘트", "What to say during your live"),
      content: copy?.live,
      button: t("안내 멘트 복사", "Copy live script"),
      hint: t(
        "화면에는 짧은 주소를, 말로는 팬페이지에서 할 일을 안내하기",
        "Show the short URL and tell fans what they can do on your page",
      ),
    },
  ];
  return (
    <BusinessInquiryProvider locale={locale} kind="creator">
      <div className={styles.root}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <FanWordmarkLink locale={locale} />
            <span>{t("셀럽 가이드", "Celebrity guides")}</span>
          </div>
          <nav aria-label={t("셀럽 가이드", "Celebrity guides")}>
            <a
              className={styles.desktopNav}
              aria-current="page"
              href={guideHref("/bias/promotion")}
            >
              {t("홍보 안내", "Promotion")}
            </a>
            <a
              className={styles.desktopNav}
              href={guideHref("/bias/instagram")}
            >
              {t("Instagram 연결", "Connect Instagram")}
            </a>
            <a className={styles.desktopNav} href={`/?locale=${locale}`}>
              {t("ByUs로 이동", "Go to ByUs")} ↗
            </a>
            <a className={styles.mobileNav} href={guideHref("/bias")}>
              {t("전체 가이드", "All guides")}
            </a>
            <a
              href={guideHref("/bias/promotion", en ? "ko" : "en")}
              lang={en ? "ko" : "en"}
            >
              {en ? "한국어" : "EN"}
            </a>
          </nav>
        </header>
        <main className={styles.main}>
          <div className={styles.breadcrumb}>
            {t("셀럽 가이드 / 홍보 안내", "Celebrity guides / Promotion")}
          </div>
          <section className={styles.hero}>
            <h1>
              {t(
                "내 팬페이지를\n팬들에게 알려주세요",
                "Let fans know about\nyour fan page",
              )}
            </h1>
            <p>
              {t(
                "팬들이 언제든 찾아올 수 있도록.\n내 링크를 확인하고, 홍보 문구를 복사해 사용하세요.",
                "Help fans find you anytime.\nFind your link and copy a message to share.",
              )}
            </p>
          </section>
          <section className={styles.selector} aria-labelledby="find-title">
            <div className={styles.selectorHeading}>
              <h2 id="find-title">
                {t("01  내 팬페이지 찾기", "01  Find your fan page")}
              </h2>
              <button
                className={styles.searchTrigger}
                onClick={() => openPicker()}
              >
                <Search size={20} />
                {t("이름 또는 핸들로 검색", "Search by name or handle")}
              </button>
            </div>
            {unavailable ? (
              <p role="alert">
                {t(
                  "지금은 목록을 불러올 수 없어요.",
                  "The list is unavailable right now.",
                )}{" "}
                <a href={guideHref("/bias/promotion")}>
                  {t("다시 시도", "Try again")}
                </a>
              </p>
            ) : profiles.length === 0 ? (
              <p>
                {t(
                  "아직 공개된 팬페이지가 없어요.",
                  "No fan pages are published yet.",
                )}
              </p>
            ) : (
              <div className={styles.shortcuts}>
                {profiles
                  .slice(0, 8)
                  .map((profile, index) =>
                    avatar(
                      profile,
                      slug === profile.slug,
                      () => choose(profile.slug),
                      index >= 3 ? styles.desktopPerson : "",
                    ),
                  )}
                <button className={styles.person} onClick={() => openPicker()}>
                  <span className={styles.allCircle}>
                    <Grid2X2 size={23} />
                  </span>
                  <span>{t("전체 보기", "View all")}</span>
                </button>
              </div>
            )}
            <div className={styles.selected}>
              <div>
                <p>
                  {selected
                    ? t(
                        `${selected.name}님의 팬페이지`,
                        `${selected.name}'s fan page`,
                      )
                    : t("내 프로필을 선택해 주세요", "Choose your profile")}
                </p>
                <div className={styles.url}>
                  {copy?.shortUrl ??
                    t("나만의 링크를 확인하세요", "Find your own link")}
                </div>
              </div>
              <div className={styles.actions}>
                {copy ? (
                  <a
                    className={styles.button}
                    href={copy.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("팬페이지 열기", "Open fan page")}
                    <ArrowUpRight size={17} />
                  </a>
                ) : (
                  <button className={styles.button} disabled>
                    {t("팬페이지 열기", "Open fan page")}
                  </button>
                )}
                {copyButton(
                  "url",
                  t("링크 복사", "Copy link"),
                  copy?.url,
                  true,
                )}
              </div>
            </div>
          </section>
          <section className={styles.general}>
            <div>
              <h2>{t("이 문구로 시작해보세요", "Start with this message")}</h2>
              <p>
                {t(
                  "게시글이나 팬 커뮤니티에\n그대로 복사해 사용할 수 있어요.",
                  "Copy it into a post or share it with your fan community.",
                )}
              </p>
              <div className={styles.generalDesktop}>
                {copyButton(
                  "general",
                  t("홍보 글 복사", "Copy message"),
                  copy?.general,
                )}
              </div>
            </div>
            <div>
              <p className={styles.copyText}>
                {copy ? (
                  <>
                    {copy.general.slice(0, -copy.url.length)}
                    <span className={styles.copyUrl}>{copy.url}</span>
                  </>
                ) : (
                  t(
                    "위에서 내 프로필을 선택하면\n팬페이지 링크가 담긴 홍보 글이 준비돼요.",
                    "Choose your profile above to get a message with your fan page link.",
                  )
                )}
              </p>
              <div className={styles.generalMobile}>
                {copyButton(
                  "general",
                  t("홍보 글 복사", "Copy message"),
                  copy?.general,
                )}
              </div>
            </div>
          </section>
          <section className={styles.methods}>
            <div className={styles.methodHeading}>
              <h2>
                {t(
                  "02  편한 방법으로 팬들에게 알려주세요",
                  "02  Share it in a way that works for you",
                )}
              </h2>
            </div>
            <p className={styles.intro}>
              {t(
                "아래 방법 중 편한 것 하나부터 시작해 보세요. 팬들이 내 소식과 참여할 활동을 더 쉽게 찾을 수 있어요.",
                "Start with the option that works best for you. Help your fans find your updates and activities more easily.",
              )}
            </p>
            {methods.map((method, index) => (
              <article key={method.title} className={styles.method}>
                <div>
                  <span className={styles.letter}>{"ABC"[index]}</span>
                  <h3>{method.title}</h3>
                  <p className={styles.description}>{method.description}</p>
                  <div className={styles.copyBox}>
                    <span>{method.label}</span>
                    <p className={styles.copyText}>
                      {method.content ??
                        t(
                          "내 프로필을 선택하면 문구를 확인할 수 있어요.",
                          "Choose your profile to see your message.",
                        )}
                    </p>
                  </div>
                  <div className={styles.actions}>
                    {copyButton(
                      `method-${index}`,
                      method.button,
                      method.content,
                    )}
                    <button
                      className={styles.textButton}
                      disabled={!copy}
                      onClick={() =>
                        copy && void copyText(`link-${index}`, copy.url)
                      }
                    >
                      {t("링크만 복사", "Copy link only")}
                    </button>
                  </div>
                  <p className={styles.hint}>{method.hint}</p>
                </div>
                <PromotionPreview
                  profile={selected}
                  locale={locale}
                  variant={index}
                />
              </article>
            ))}
          </section>
          <section className={styles.events}>
            <h2>
              {t("03  진행할 이벤트가 있나요?", "03  Have an event coming up?")}
            </h2>
            <p className={styles.description}>
              {t(
                "이벤트가 있다면 담당자와 일정·혜택을 먼저 협의해주세요.\n팬들이 참여 방법을 쉽게 이해하도록, 팬페이지 안내와 홍보 문구를 함께 준비해요.",
                "Agree on the schedule and benefits with your ByUs contact first.\nPrepare your fan page instructions and promotional messages together so fans know how to take part.",
              )}
            </p>
            <ol className={styles.steps}>
              {[
                [
                  t("일정과 혜택 협의", "Agree on the schedule and benefits"),
                  t(
                    "이벤트 날짜, 참여 대상과 선물을 담당자와 정해요.",
                    "Confirm the date, eligibility and gifts with your contact.",
                  ),
                ],
                [
                  t(
                    "팬페이지와 홍보 문구 준비",
                    "Prepare your fan page and messages",
                  ),
                  t(
                    "확정된 참여 방법과 링크를 팬들에게 안내해요.",
                    "Share the confirmed instructions and link with fans.",
                  ),
                ],
                [
                  t(
                    "이벤트 전·진행 중에 알리기",
                    "Share before and during the event",
                  ),
                  t(
                    "게시글과 스토리에서 참여할 곳을 알려주세요.",
                    "Use posts and stories to show fans where to take part.",
                  ),
                ],
              ].map(([title, body], index) => (
                <li key={title}>
                  <span>{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <InquiryButton className={styles.button}>
              {t("담당자에게 문의하기", "Contact the team")}
            </InquiryButton>
          </section>
          <section className={styles.related}>
            <div>
              <h2>
                {t(
                  "Instagram 소식도 팬페이지에 담아보세요",
                  "Bring your Instagram updates to your fan page",
                )}
              </h2>
              <p>
                {t(
                  "계정 연결 방법과 필요한 권한을 확인할 수 있어요.",
                  "Learn how to connect your account and which permissions are needed.",
                )}
              </p>
            </div>
            <a className={styles.button} href={guideHref("/bias/instagram")}>
              {t("Instagram 연결 안내", "Instagram connection guide")}
              <ArrowUpRight size={17} />
            </a>
          </section>
        </main>
        <footer className={styles.footer}>
          <span>© ByUs · Sallylab Inc.</span>
          <div>
            <a href={guideHref("/bias")}>
              {t("셀럽 가이드", "Celebrity guides")}
            </a>
            <InquiryButton>{t("문의하기", "Contact us")}</InquiryButton>
            <a href={`/privacy?locale=${locale}`}>
              {t("개인정보처리방침", "Privacy policy")}
            </a>
          </div>
        </footer>
        <div
          aria-live="polite"
          aria-atomic="true"
          className={feedback ? styles.toast : styles.srOnly}
        >
          {feedback?.text}
        </div>
        <AccessibleOverlay
          open={open}
          onClose={() => setOpen(false)}
          labelledBy="picker-title"
          initialFocusRef={searchRef}
          backdropClassName={styles.backdrop}
          contentClassName={styles.picker}
        >
          <div className={styles.pickerHeader}>
            <div>
              <h2 id="picker-title">
                {t("내 팬페이지 찾기", "Find your fan page")}
              </h2>
              <p>
                {t(
                  "프로필을 선택하면 내 링크와 홍보 문구가 준비돼요.",
                  "Choose a profile to get your link and messages.",
                )}
              </p>
            </div>
            <button
              className={styles.iconButton}
              onClick={() => setOpen(false)}
              aria-label={t("닫기", "Close")}
            >
              <X />
            </button>
          </div>
          <label className={styles.searchInput}>
            <Search size={20} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder={t(
                "이름 또는 핸들로 검색",
                "Search by name or handle",
              )}
              aria-label={t(
                "이름 또는 핸들로 검색",
                "Search by name or handle",
              )}
            />
            {query && (
              <button
                className={styles.iconButton}
                onClick={() => {
                  setQuery("");
                  setPage(0);
                  searchRef.current?.focus();
                }}
                aria-label={t("검색어 지우기", "Clear search")}
              >
                <X size={18} />
              </button>
            )}
          </label>
          <p className={styles.resultCount} aria-live="polite">
            {t(`전체 ${result.length}명`, `${result.length} profiles`)}
          </p>
          <div className={styles.pickerGrid}>
            {result
              .slice(visiblePage * pageSize, (visiblePage + 1) * pageSize)
              .map((profile) =>
                avatar(profile, draft === profile.slug, () =>
                  setDraft(profile.slug),
                ),
              )}
          </div>
          {!result.length && (
            <p className={styles.empty}>
              {t(
                "검색 결과가 없어요. 이름이나 핸들을 다시 확인해 주세요.",
                "No results. Check the name or handle and try again.",
              )}
            </p>
          )}
          <div className={styles.pagination}>
            <button
              className={styles.iconButton}
              aria-label={t("이전 페이지", "Previous page")}
              disabled={!visiblePage}
              onClick={() => setPage(visiblePage - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <span>
              {visiblePage + 1} / {pageCount}
            </span>
            <button
              className={styles.iconButton}
              aria-label={t("다음 페이지", "Next page")}
              disabled={visiblePage + 1 >= pageCount}
              onClick={() => setPage(visiblePage + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </div>
          <button
            className={`${styles.button} ${styles.primary} ${styles.confirm}`}
            disabled={!resolveProfile(profiles, draft)}
            onClick={() => {
              choose(draft);
              setOpen(false);
            }}
          >
            {resolveProfile(profiles, draft)?.name ?? t("프로필", "Profile")}{" "}
            {t("선택", "— select")}
          </button>
        </AccessibleOverlay>
      </div>
    </BusinessInquiryProvider>
  );
}

function PromotionPreview({
  profile,
  locale,
  variant,
}: {
  profile?: PromotionProfile;
  locale: Locale;
  variant: number;
}) {
  const en = locale === "en";
  const url = profile ? `byus.kr/${profile.slug}` : "byus.kr/…";
  const previewCopy = promotionCopy(profile?.slug ?? "", locale);
  const instagram = profile?.socialLinks.find(
    (link) => link.platform === "instagram",
  );
  const handle = instagram
    ? new URL(instagram.url).pathname.split("/").filter(Boolean)[0]
    : profile?.name;
  const avatar = profile ? (
    <CreatorAvatar
      slug={profile.slug}
      src={profile.image.url}
      photos={profile.image.photos}
      position={profile.image.position}
      size={64}
    />
  ) : (
    <span className={styles.placeholderAvatar} />
  );
  const photo = profile ? (
    <CreatorImage
      slug={profile.slug}
      src={profile.image.url}
      photos={profile.image.photos}
      position={profile.image.position}
      presentation={variant === 2 ? "collection" : "vertical"}
      alt=""
      fill
      sizes="(max-width: 767px) 318px, 344px"
    />
  ) : null;
  return (
    <div
      className={`${styles.preview} ${variant === 1 ? styles.storyPreview : ""}`}
      aria-label={en ? "Placement example" : "링크 배치 예시"}
    >
      {variant === 0 ? (
        <div className={styles.profileCard}>
          <div className={styles.previewIdentity}>
            {avatar}
            <div>
              <strong>{handle ?? (en ? "Your profile" : "내 프로필")}</strong>
              <span>{profile?.name}</span>
            </div>
          </div>
          <p>
            {previewCopy.bio.split("\n")[0]}
          </p>
          <div className={styles.previewLink}>
            <LinkIcon size={17} />
            {url}
          </div>
        </div>
      ) : variant === 1 ? (
        <>
          <div className={styles.story}>
            {photo}
            <div className={styles.storyShade} />
            <span className={styles.storyHandle}>{handle}</span>
            <div className={styles.storyText}>
              {previewCopy.story.split("\n")[0]}
              <span>{url} ↗</span>
            </div>
          </div>
          <p className={styles.previewCaption}>
            {en
              ? "Add a link sticker with your message"
              : "문구와 함께 링크 스티커 추가"}
          </p>
        </>
      ) : (
        <div className={styles.live}>
          {photo}
          <span className={styles.liveTag}>LIVE</span>
          <div className={styles.liveAddress}>
            <Image
              src="/images/guest-home/byus-wordmark.svg"
              alt="ByUs"
              width={80}
              height={30}
            />
            <strong>{url}</strong>
          </div>
        </div>
      )}
      {variant !== 1 && (
        <p className={styles.previewCaption}>
          {en
            ? variant === 0
              ? "Your fan page link in your profile"
              : "Keep the URL visible during your live"
            : variant === 0
              ? "프로필에서 팬페이지로 바로"
              : "방송 화면에 잘 보이게 띄우기"}
        </p>
      )}
    </div>
  );
}
