import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedCelebrity } from "@/server/content/content-domain";
import type { BenefitCatalogItem } from "../domain/benefit";
import type { RaffleList } from "../domain/raffle";

const mocks = vi.hoisted(() => ({
  loadSeoCreator: vi.fn(),
  listRaffles: vi.fn(),
  createRaffleDependencies: vi.fn(),
  findBenefit: vi.fn(),
  createBenefitRepository: vi.fn(),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/seo/public-content", () => ({
  loadSeoCreator: mocks.loadSeoCreator,
}));
vi.mock("@/server/raffle/raffle-dependencies", () => ({
  createRaffleDependencies: mocks.createRaffleDependencies,
}));
vi.mock("@/server/g4/benefit-repository", () => ({
  createBenefitRepositoryFromEnvironment: mocks.createBenefitRepository,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

import CreatorRafflesPage from "@/app/c/[slug]/raffles/page";
import CreatorRaffleDetailPage from "@/app/c/[slug]/raffles/[benefitId]/page";

const benefitId = "11111111-1111-4111-8111-111111111111";
const otherBenefitId = "22222222-2222-4222-8222-222222222222";

const celebrity = (locale: "ko" | "en"): PublishedCelebrity => ({
  slug: "ifewknow",
  locale,
  name: locale === "ko" ? "이퓨" : "ifew",
  summary: "Creator summary",
  image: { url: "/ifew.jpg", alt: "ifew", position: "center" },
  roles: ["creator"],
  themes: [],
  socialLinks: [],
  displayOrder: 0,
  fanCount: 10,
});

const raffle = (id = benefitId): RaffleList["raffles"][number] => ({
  id,
  benefitId: id,
  title: "뱅크시 관람권",
  summary: "5명에게 2장씩",
  imageUrl: null,
  winnerQuantity: 5,
  status: "open",
  entryOpensAt: "2026-09-01T00:00:00.000+09:00",
  entryClosesAt: "2026-09-20T00:00:00.000+09:00",
  fulfillmentMethod: "digital",
  perFanTicketLimit: null,
});

const publicBenefit = (locale: "ko" | "en"): BenefitCatalogItem => ({
  id: benefitId,
  slug: "banksy-ticket",
  title: "뱅크시 관람권",
  summary: "Benefit summary",
  eligibilityLabel: "Open",
  deliveryLabel: locale === "ko" ? "현장 수령 안내" : "On-site pickup instructions",
  deliveryType: "unique_code",
  allocationMode: "application_selection",
  applicationStatus: null,
  claimOpensAt: "2026-09-01T00:00:00.000Z",
  claimClosesAt: "2026-09-20T00:00:00.000Z",
  minimumScore: 0,
  minimumLevel: "Silver",
  requiredStampType: null,
  requiredActivityType: null,
  state: "eligible",
  entry: null,
});

function stubServerEnvironment() {
  const values = {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NEXT_PUBLIC_PRIVY_APP_ID: "test-app",
    NEXT_PUBLIC_BYUS_DATA_ENVIRONMENT: "development",
    NEXT_PUBLIC_PRIVY_APP_ENVIRONMENT: "development",
    NEXT_PUBLIC_PRIVY_APPLE_LOGIN_ENABLED: "false",
    NEXT_PUBLIC_PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
    PRIVY_APP_ID: "test-app",
    PRIVY_APP_SECRET: "test-secret-value",
    BYUS_DATA_ENVIRONMENT: "development",
    PRIVY_APP_ENVIRONMENT: "development",
    PRIVY_APPLE_LOGIN_ENABLED: "false",
    PRIVY_TEST_ACCOUNT_LOGIN_ENABLED: "false",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    GIWA_CHAIN_ID: "91342",
    GIWA_RPC_URL: "https://rpc.example.test",
    GIWA_EXPLORER_URL: "https://explorer.example.test",
    BYUS_PASSPORT_CONTRACT_ADDRESS: `0x${"1".repeat(40)}`,
    BYUS_STAMP_CONTRACT_ADDRESS: `0x${"2".repeat(40)}`,
    BYUS_RELAYER_ADDRESS: `0x${"3".repeat(40)}`,
  } as const;
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  stubServerEnvironment();
  mocks.createRaffleDependencies.mockReturnValue({ list: mocks.listRaffles });
  mocks.createBenefitRepository.mockReturnValue({ find: mocks.findBenefit });
});

describe("creator raffle server pages", () => {
  it.each(["ko", "en"] as const)("keeps a one-gift creator on the catalog route (%s)", async (locale) => {
    const creator = celebrity(locale);
    const oneGift = [raffle()];
    mocks.loadSeoCreator.mockResolvedValue(creator);
    mocks.listRaffles.mockResolvedValue({ raffles: oneGift });

    const page = await CreatorRafflesPage({
      params: Promise.resolve({ slug: creator.slug }),
      searchParams: Promise.resolve({ locale }),
    });

    expect(mocks.loadSeoCreator).toHaveBeenCalledWith("ifewknow", locale);
    expect(mocks.listRaffles).toHaveBeenCalledWith(expect.objectContaining({ celebritySlug: "ifewknow", locale, now: expect.any(Date) }));
    expect(page.props).toMatchObject({ celebrity: creator, locale, raffles: oneGift });
    expect(page.props.benefitId).toBeUndefined();
  });

  it("returns 404 before reading the catalog when the creator is missing", async () => {
    mocks.loadSeoCreator.mockResolvedValue(null);

    await expect(CreatorRafflesPage({
      params: Promise.resolve({ slug: "missing" }),
      searchParams: Promise.resolve({ locale: "ko" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.listRaffles).not.toHaveBeenCalled();
  });

  it("returns 404 when the benefit is absent from the creator's public raffle list", async () => {
    mocks.loadSeoCreator.mockResolvedValue(celebrity("ko"));
    mocks.listRaffles.mockResolvedValue({ raffles: [raffle(otherBenefitId)] });
    mocks.findBenefit.mockResolvedValue(publicBenefit("ko"));

    await expect(CreatorRaffleDetailPage({
      params: Promise.resolve({ slug: "ifewknow", benefitId }),
      searchParams: Promise.resolve({ locale: "ko" }),
    })).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.createBenefitRepository).not.toHaveBeenCalled();
    expect(mocks.findBenefit).not.toHaveBeenCalled();
  });

  it("propagates a public catalog failure without falling back to the benefit detail repository", async () => {
    const failure = new Error("public raffle catalog unavailable");
    mocks.loadSeoCreator.mockResolvedValue(celebrity("ko"));
    mocks.listRaffles.mockRejectedValue(failure);
    mocks.findBenefit.mockResolvedValue(publicBenefit("ko"));

    await expect(CreatorRaffleDetailPage({
      params: Promise.resolve({ slug: "ifewknow", benefitId }),
      searchParams: Promise.resolve({ locale: "ko" }),
    })).rejects.toBe(failure);

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(mocks.createBenefitRepository).not.toHaveBeenCalled();
    expect(mocks.findBenefit).not.toHaveBeenCalled();
  });

  it.each(["ko", "en"] as const)("loads a valid public detail anonymously and passes delivery instructions (%s)", async (locale) => {
    const creator = celebrity(locale);
    const oneGift = [raffle()];
    const benefit = publicBenefit(locale);
    mocks.loadSeoCreator.mockResolvedValue(creator);
    mocks.listRaffles.mockResolvedValue({ raffles: oneGift });
    mocks.findBenefit.mockResolvedValue(benefit);

    const page = await CreatorRaffleDetailPage({
      params: Promise.resolve({ slug: creator.slug, benefitId }),
      searchParams: Promise.resolve({ locale }),
    });

    expect(mocks.findBenefit).toHaveBeenCalledWith(expect.objectContaining({
      benefitId,
      locale,
      appUserId: null,
      now: expect.any(Date),
    }));
    expect(page.props).toMatchObject({
      celebrity: creator,
      locale,
      raffles: oneGift,
      benefitId,
      deliveryInstructions: benefit.deliveryLabel,
    });
  });
});
