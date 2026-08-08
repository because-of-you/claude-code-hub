import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import LoginPage from "@/app/[locale]/login/page";

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
const mockUseRouter = vi.hoisted(() => vi.fn(() => ({ push: mockPush, refresh: mockRefresh })));
const mockUseSearchParams = vi.hoisted(() => vi.fn(() => ({ get: vi.fn(() => null) })));
const mockUseTranslations = vi.hoisted(() => vi.fn(() => (key: string) => `t:${key}`));
const mockUseLocale = vi.hoisted(() => vi.fn(() => "en"));
const mockUsePathname = vi.hoisted(() => vi.fn(() => "/login"));

vi.mock("next/navigation", () => ({
  useSearchParams: mockUseSearchParams,
  useRouter: mockUseRouter,
  usePathname: mockUsePathname,
}));

vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
  useLocale: mockUseLocale,
}));

vi.mock("@/i18n/routing", () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
  useRouter: mockUseRouter,
  usePathname: mockUsePathname,
}));

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "system", setTheme: vi.fn() })),
}));

describe("LoginPage UI Redesign", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  const render = async () => {
    await act(async () => {
      root.render(<LoginPage />);
    });
  };

  it("password toggle changes input type between password and text", async () => {
    await render();

    const input = container.querySelector("input#apiKey") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe("password");

    const toggleButton = container.querySelector(
      'button[aria-label="t:form.showPassword"]'
    ) as HTMLButtonElement;
    expect(toggleButton).not.toBeNull();

    await act(async () => {
      toggleButton.click();
    });

    expect(input.type).toBe("text");

    const hideButton = container.querySelector(
      'button[aria-label="t:form.hidePassword"]'
    ) as HTMLButtonElement;
    expect(hideButton).not.toBeNull();

    await act(async () => {
      hideButton.click();
    });

    expect(input.type).toBe("password");
  });

  it("ThemeSwitcher renders in the top-right control area", async () => {
    await render();

    const topRightArea = container.querySelector(".fixed.top-4.right-4");
    expect(topRightArea).not.toBeNull();

    const buttons = topRightArea?.querySelectorAll("button");
    expect(buttons?.length).toBeGreaterThanOrEqual(2);
  });

  it("brand panel has data-testid login-brand-panel", async () => {
    await render();

    const brandPanel = container.querySelector('[data-testid="login-brand-panel"]');
    expect(brandPanel).not.toBeNull();
  });

  it("brand panel is hidden on mobile (has hidden class without lg:flex)", async () => {
    await render();

    const brandPanel = container.querySelector('[data-testid="login-brand-panel"]');
    expect(brandPanel).not.toBeNull();
    expect(brandPanel?.className).toContain("hidden");
    expect(brandPanel?.className).toContain("lg:flex");
  });

  it("mobile brand header is visible on mobile (has lg:hidden class)", async () => {
    await render();

    const formPanel = container.querySelector(".lg\\:w-\\[55\\%\\]");
    expect(formPanel).not.toBeNull();

    const mobileHeader = formPanel?.querySelector(".lg\\:hidden");
    expect(mobileHeader).not.toBeNull();
  });

  it("card header icon is hidden on desktop (has lg:hidden class)", async () => {
    await render();

    const card = container.querySelector('[data-slot="card"]');
    expect(card).not.toBeNull();

    const headerIcon = card?.querySelector(".lg\\:hidden");
    expect(headerIcon).not.toBeNull();
  });

  it("input has padding for both key icon and toggle button", async () => {
    await render();

    const input = container.querySelector("input#apiKey") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.className).toContain("pl-9");
    expect(input.className).toContain("pr-10");
  });

  it("shows OIDC first and keeps password login collapsed while status is loading", async () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch;

    await render();

    expect(container.querySelector('a[href^="/api/auth/oidc/login?"]')).not.toBeNull();
    expect(container.querySelector("input#apiKey")).toBeNull();
    const disclosure = container.querySelector(
      'button[aria-controls="password-login-form"]'
    ) as HTMLButtonElement;
    expect(disclosure).not.toBeNull();
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  });

  it("reveals password login in place when the disclosure is activated", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => (String(input) === "/api/auth/oidc/status" ? { enabled: true } : {}),
    })) as typeof fetch;

    await render();
    const disclosure = container.querySelector(
      'button[aria-controls="password-login-form"]'
    ) as HTMLButtonElement;

    await act(async () => disclosure.click());

    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("#password-login-form input#apiKey")).not.toBeNull();
  });

  it("shows password login directly when OIDC status lookup fails", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/oidc/status") throw new Error("status unavailable");
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    await render();
    await act(async () => Promise.resolve());

    expect(container.querySelector('a[href^="/api/auth/oidc/login?"]')).toBeNull();
    expect(container.querySelector("input#apiKey")).not.toBeNull();
  });

  it("localizes the OIDC return path with the active locale", async () => {
    mockUseLocale.mockReturnValue("zh-CN");
    mockUseSearchParams.mockReturnValue({
      get: vi.fn((key: string) => (key === "from" ? "/dashboard" : null)),
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => (String(input) === "/api/auth/oidc/status" ? { enabled: true } : {}),
    })) as typeof fetch;

    await render();

    const oidcLink = container.querySelector('a[href^="/api/auth/oidc/login?"]');
    expect(oidcLink?.getAttribute("href")).toBe("/api/auth/oidc/login?from=%2Fzh-CN%2Fdashboard");
  });
});
