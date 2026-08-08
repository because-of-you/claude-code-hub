# OIDC Locale-Aware Redirect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OIDC callbacks return to the active localized route instead of the nonexistent unprefixed `/dashboard` route.

**Architecture:** Keep middleware and callback behavior unchanged. At the localized login-page boundary, sanitize the internal `from` path with the existing redirect-safety logic, remove any stale locale prefix, and prepend the active `next-intl` locale before sending it to the OIDC login endpoint.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl, TypeScript, Vitest, happy-dom

## Global Constraints

- Preserve the always-prefixed locale routing strategy.
- Preserve safe deep-link paths, query strings, and fragments.
- Do not change OIDC discovery, token exchange, session creation, callback origin handling, Dockerfiles, or image tags.
- Keep all code free of emoji and pass the repository's build, lint, typecheck, and test commands.

---

### Task 1: Localize the OIDC return path

**Files:**
- Modify: `tests/unit/login/login-ui-redesign.test.tsx`
- Modify: `src/app/[locale]/login/redirect-safety.ts`
- Modify: `src/app/[locale]/login/page.tsx`

**Interfaces:**
- Consumes: `sanitizeRedirectPath(from: string): string` and `useLocale(): string`
- Produces: `resolveOidcRedirectTarget(locale: string, from: string): string`

- [ ] **Step 1: Write the failing login-page test**

Add a test that sets locale `zh-CN`, supplies `from=/dashboard`, enables OIDC through the status response, renders the real login page, and asserts the OIDC anchor has this literal URL:

```tsx
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
  expect(oidcLink?.getAttribute("href")).toBe(
    "/api/auth/oidc/login?from=%2Fzh-CN%2Fdashboard"
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bunx vitest run tests/unit/login/login-ui-redesign.test.tsx --configLoader bundle
```

Expected: the new assertion fails because the anchor still contains `%2Fdashboard` without `%2Fzh-CN`.

- [ ] **Step 3: Implement the minimal locale-aware target**

Add this redirect-safety helper:

```ts
export function resolveOidcRedirectTarget(locale: string, from: string): string {
  return `/${locale}${sanitizeRedirectPath(from)}`;
}
```

In the login page, read `useLocale()`, compute the OIDC target with `resolveOidcRedirectTarget`, and encode that target in the existing OIDC login anchor.

- [ ] **Step 4: Verify GREEN and related regressions**

Run:

```bash
bunx vitest run tests/unit/login/login-ui-redesign.test.tsx tests/unit/auth/login-redirect-safety.test.ts tests/unit/api/oidc-callback-route.test.ts --configLoader bundle
```

Expected: all selected tests pass.

- [ ] **Step 5: Run repository verification**

Run `bun run format`, inspect the diff, then run `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build`. Expected: every command exits 0.

- [ ] **Step 6: Commit and publish**

Commit the test and production changes with `fix: preserve locale after OIDC login`, push `codex/authelia-oidc`, and confirm the non-main image workflow starts for the new head commit.
