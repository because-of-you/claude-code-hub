# OIDC-First Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `acitrus.cn` OIDC the default login action and reveal API key login only through an accessible inline disclosure, with a direct API key fallback when OIDC is unavailable.

**Architecture:** Keep the behavior inside the existing login page, replacing the OIDC boolean with an explicit presentation-state union and adding one disclosure boolean. Render the existing API key form conditionally without introducing a modal, menu, route, dependency, or authentication-protocol change. Keep all five auth locale files structurally identical.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, next-intl, existing Button/Input/Card components, Vitest, Biome, Bun 1.3.10.

## Global Constraints

- The primary user-facing action names `acitrus.cn`; the domain is identical in every locale.
- OIDC `loading` and `enabled` states are OIDC-first; `disabled` and status-request failure states show API key login directly.
- The existing locale-aware return target remains intact, including `/zh-CN/dashboard`.
- Password login expands in place through a keyboard-operable button with `aria-expanded` and `aria-controls`.
- Do not add a modal, dropdown menu, route, dependency, or authentication-protocol change.
- Preserve existing HTTP warning, login error, password visibility, validation, and submit behavior.

---

### Task 1: OIDC-first login card and localized disclosure

**Files:**
- Modify: `src/app/[locale]/login/page.tsx:3-430`
- Modify: `messages/en/auth.json`
- Modify: `messages/zh-CN/auth.json`
- Modify: `messages/zh-TW/auth.json`
- Modify: `messages/ja/auth.json`
- Modify: `messages/ru/auth.json`
- Test: `tests/unit/login/login-ui-redesign.test.tsx`
- Test: `tests/unit/login/login-footer-version.test.tsx`
- Test: `tests/unit/i18n/auth-login-keys.test.ts`

**Interfaces:**
- Consumes: `resolveOidcRedirectTarget(locale: string, from: string): string` from `src/app/[locale]/login/redirect-safety.ts`.
- Produces: `type OidcPresentationState = "loading" | "enabled" | "disabled"` local to the login page.
- Produces translation keys: `actions.loginWithAcitrus`, `actions.showPasswordLogin`, and `actions.hidePasswordLogin` in every auth locale.
- Produces DOM contract: disclosure button with `aria-controls="password-login-form"`; form region with `id="password-login-form"`.

- [ ] **Step 1: Add failing OIDC-first and disclosure behavior tests**

Add tests to `tests/unit/login/login-ui-redesign.test.tsx` that drive the real page and assert observable DOM behavior:

```tsx
it("shows OIDC first and keeps password login collapsed while status is loading", async () => {
  global.fetch = vi.fn(() => new Promise(() => {})) as typeof fetch;
  await render();
  expect(container.querySelector('a[href^="/api/auth/oidc/login?"]')).not.toBeNull();
  expect(container.querySelector("input#apiKey")).toBeNull();
  const disclosure = container.querySelector(
    'button[aria-controls="password-login-form"]'
  ) as HTMLButtonElement;
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
```

Keep the locale-return-path assertion literal: `/api/auth/oidc/login?from=%2Fzh-CN%2Fdashboard`.

- [ ] **Step 2: Add failing locale copy assertions**

Extend `tests/unit/i18n/auth-login-keys.test.ts` with literal expected values and removal of the obsolete action key:

```ts
it("brands the primary login action as acitrus.cn in every locale", () => {
  const expected = {
    en: "Continue with acitrus.cn",
    "zh-CN": "使用 acitrus.cn 登录",
    "zh-TW": "使用 acitrus.cn 登入",
    ja: "acitrus.cn でログイン",
    ru: "Войти через acitrus.cn",
  };
  for (const [locale, data] of Object.entries(locales)) {
    const actions = data.actions as Record<string, string>;
    expect(actions.loginWithAcitrus).toBe(expected[locale as keyof typeof expected]);
    expect(actions).not.toHaveProperty("loginWithAuthelia");
    expect(actions.showPasswordLogin).toBeTruthy();
    expect(actions.hidePasswordLogin).toBeTruthy();
  }
});
```

- [ ] **Step 3: Run the new tests and verify RED**

Run:

```powershell
& 'C:\Users\mail\AppData\Local\npm-cache\_npx\b0e2f39cb236944d\node_modules\@oven\bun-windows-x64\bin\bun.exe' run test -- tests/unit/login/login-ui-redesign.test.tsx tests/unit/i18n/auth-login-keys.test.ts
```

Expected: FAIL because the API key form is still rendered during OIDC loading, the disclosure button does not exist, and the new locale action keys do not exist.

- [ ] **Step 4: Implement the minimal OIDC presentation state**

In `src/app/[locale]/login/page.tsx`, add `ChevronDown`, replace the boolean state, and derive presentation booleans:

```tsx
type OidcPresentationState = "loading" | "enabled" | "disabled";
const [oidcState, setOidcState] = useState<OidcPresentationState>("loading");
const [passwordLoginExpanded, setPasswordLoginExpanded] = useState(false);
const showOidcLogin = oidcState !== "disabled";
const showPasswordLogin = oidcState === "disabled" || passwordLoginExpanded;
```

Update the existing status effect so every settled branch is explicit:

```tsx
void fetch("/api/auth/oidc/status")
  .then((response) => response.json() as Promise<{ enabled?: unknown }>)
  .then((data) => {
    if (active) setOidcState(data.enabled === true ? "enabled" : "disabled");
  })
  .catch(() => {
    if (active) setOidcState("disabled");
  });
```

- [ ] **Step 5: Render the primary action and accessible inline disclosure**

Replace the existing OIDC block and unconditional form with this structure while retaining the existing form contents unchanged:

```tsx
{showOidcLogin ? (
  <div className="mb-6 space-y-3">
    <Button asChild className="w-full">
      <a href={`/api/auth/oidc/login?from=${encodeURIComponent(oidcReturnPath)}`}>
        <LogIn className="mr-2 h-4 w-4" />
        {t("actions.loginWithAcitrus")}
      </a>
    </Button>
    <Button
      type="button"
      variant="ghost"
      className="w-full text-muted-foreground"
      aria-expanded={passwordLoginExpanded}
      aria-controls="password-login-form"
      onClick={() => setPasswordLoginExpanded((expanded) => !expanded)}
    >
      {passwordLoginExpanded
        ? t("actions.hidePasswordLogin")
        : t("actions.showPasswordLogin")}
      <ChevronDown
        className={`ml-2 h-4 w-4 transition-transform ${passwordLoginExpanded ? "rotate-180" : ""}`}
      />
    </Button>
  </div>
) : null}
{showPasswordLogin ? (
  <form id="password-login-form" onSubmit={handleSubmit} className="space-y-6">
```

Keep every current child of the form unchanged, then close the conditional immediately after the current `</form>`:

```tsx
  </form>
) : null}
```

- [ ] **Step 6: Add all five locale strings**

Replace `actions.loginWithAuthelia` and add the disclosure strings:

```json
// en
"loginWithAcitrus": "Continue with acitrus.cn",
"showPasswordLogin": "Use password login",
"hidePasswordLogin": "Hide password login"

// zh-CN
"loginWithAcitrus": "使用 acitrus.cn 登录",
"showPasswordLogin": "使用密码登录",
"hidePasswordLogin": "收起密码登录"

// zh-TW
"loginWithAcitrus": "使用 acitrus.cn 登入",
"showPasswordLogin": "使用密碼登入",
"hidePasswordLogin": "收合密碼登入"

// ja
"loginWithAcitrus": "acitrus.cn でログイン",
"showPasswordLogin": "パスワードでログイン",
"hidePasswordLogin": "パスワードログインを閉じる"

// ru
"loginWithAcitrus": "Войти через acitrus.cn",
"showPasswordLogin": "Войти с паролем",
"hidePasswordLogin": "Скрыть вход с паролем"
```

- [ ] **Step 7: Stabilize the existing login footer assertion for the OIDC status request**

In `tests/unit/login/login-footer-version.test.tsx`, replace the order-dependent first-call assertion:

```ts
expect(global.fetch).toHaveBeenCalledWith("/api/version");
```

This asserts the footer's real contract without assuming whether the version or OIDC effect runs first.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
& 'C:\Users\mail\AppData\Local\npm-cache\_npx\b0e2f39cb236944d\node_modules\@oven\bun-windows-x64\bin\bun.exe' run test -- tests/unit/login/login-ui-redesign.test.tsx tests/unit/login/login-footer-version.test.tsx tests/unit/auth/login-redirect-safety.test.ts tests/unit/api/oidc-callback-route.test.ts tests/unit/i18n/auth-login-keys.test.ts
```

Expected: all focused files and tests PASS, including the literal locale-prefixed return URL.

- [ ] **Step 9: Commit the self-contained login behavior**

```powershell
git add -- 'src/app/[locale]/login/page.tsx' 'src/app/[locale]/login/redirect-safety.ts' 'messages/en/auth.json' 'messages/zh-CN/auth.json' 'messages/zh-TW/auth.json' 'messages/ja/auth.json' 'messages/ru/auth.json' 'tests/unit/login/login-ui-redesign.test.tsx' 'tests/unit/login/login-footer-version.test.tsx' 'tests/unit/api/oidc-callback-route.test.ts' 'tests/unit/i18n/auth-login-keys.test.ts'
git commit -m "feat: make OIDC the primary login path"
```

Before committing, confirm `git diff --cached --name-only` contains only these intended files. Do not stage Windows line-ending-only status noise.

### Task 2: Full verification and handoff

**Files:**
- Verify only; no planned production-file changes.

**Interfaces:**
- Consumes: the completed login behavior and locale keys from Task 1.
- Produces: verification evidence for integration and a precise list of any pre-existing failures.

- [ ] **Step 1: Run lint**

Run: `& 'C:\Users\mail\AppData\Local\npm-cache\_npx\b0e2f39cb236944d\node_modules\@oven\bun-windows-x64\bin\bun.exe' run lint`

Expected: repository scan completes with exit code 0.

- [ ] **Step 2: Run type checking**

Run: `& 'C:\Users\mail\AppData\Local\npm-cache\_npx\b0e2f39cb236944d\node_modules\@oven\bun-windows-x64\bin\bun.exe' run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

Run: `& 'C:\Users\mail\AppData\Local\npm-cache\_npx\b0e2f39cb236944d\node_modules\@oven\bun-windows-x64\bin\bun.exe' run build`

Expected: Next.js compilation, static page generation, and standalone-copy steps complete with exit code 0. Existing Edge Runtime warnings may remain but must not become errors.

- [ ] **Step 4: Re-run the previously failing files with Git Bash and Bun on PATH**

Run:

```powershell
$env:Path = 'C:\Users\mail\AppData\Local\npm-cache\_npx\b0e2f39cb236944d\node_modules\@oven\bun-windows-x64\bin;C:\Program Files\Git\bin;' + $env:Path
& 'C:\Users\mail\AppData\Local\npm-cache\_npx\b0e2f39cb236944d\node_modules\@oven\bun-windows-x64\bin\bun.exe' run test -- tests/unit/k8s-cch-update-flow.test.ts tests/unit/k8s-deploy-shell-helpers.test.ts tests/unit/login/login-footer-version.test.tsx src/components/ui/__tests__/language-switcher.test.tsx tests/unit/api/v1/openapi-types-drift.test.ts
```

Expected: K8s shell-helper and login-footer tests pass. If the pre-existing LanguageSwitcher sessionStorage assertion or generated OpenAPI drift still fails, report them by exact test name; do not change those unrelated subsystems in this feature.

- [ ] **Step 5: Inspect the final commit and branch state**

Run:

```powershell
git diff HEAD^ --check
git show --stat --oneline HEAD
git status --short
```

Expected: the feature commit contains only intended login, locale, and test files; remaining working-tree entries, if any, are identified as line-ending-only noise rather than staged content.
