# OIDC Locale-Aware Redirect Design

## Problem

The application uses an always-prefixed locale routing strategy. The OIDC login link currently
uses `/dashboard` as its default return path, so a successful callback redirects to a route that
does not exist instead of a localized route such as `/zh-CN/dashboard`.

## Design

The localized login page will read its active locale and prefix the normalized OIDC return path
with that locale. The authentication middleware intentionally stores `from` without a locale so
normal locale-aware navigation can add it later; the raw OIDC callback cannot do that. Therefore
`/zh-CN/login?from=/dashboard` will initiate OIDC with `from=/zh-CN/dashboard`, and localized deep
links will retain their path, query, and fragment under the active locale.

Unsafe, empty, or locale-only `from` values fall back to the localized dashboard. Existing locale
prefixes are normalized before the active locale is applied, preventing doubled or stale locale
segments. The callback route and its origin-preservation behavior remain unchanged.

## Testing

A focused login-page test will verify that the generated OIDC login URL converts an unprefixed
`from=/dashboard` value into the active locale's `/zh-CN/dashboard` return path. The test must fail
against the current branch before the production change and pass afterward. Existing redirect,
OIDC, and login tests will then be run for regression coverage.

## Image Publication

No Dockerfile or image workflow change is required. After the fix is pushed to the non-main
`codex/authelia-oidc` branch, the existing `dev.yml` workflow builds and publishes both the moving
`codex-authelia-oidc` GHCR tag and an immutable `codex-authelia-oidc-<short-sha>` tag.

Aliyun ACR publication is intentionally not configured in this source repository. The deployment
repository remains responsible for mirroring the published GHCR image into ACR. Completion must
include checking the source repository image workflow after the implementation push.

## Scope

This change only corrects locale propagation into the OIDC return path. It does not alter OIDC
discovery, token exchange, session creation, authorization, or redirect-origin handling.
