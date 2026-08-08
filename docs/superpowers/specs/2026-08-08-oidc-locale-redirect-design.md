# OIDC Locale-Aware Redirect Design

## Problem

The application uses an always-prefixed locale routing strategy. The OIDC login link currently
uses `/dashboard` as its default return path, so a successful callback redirects to a route that
does not exist instead of a localized route such as `/zh-CN/dashboard`.

## Design

The localized login page will read its active locale and prefix the OIDC default return path with
that locale. When no explicit `from` value is present, `/zh-CN/login` will initiate OIDC with
`from=/zh-CN/dashboard`; the same behavior applies to every supported locale.

An explicit safe `from` value remains authoritative so deep-link return behavior is preserved.
The callback route and its origin-preservation behavior remain unchanged.

## Testing

A focused login-page test will verify that the generated OIDC login URL includes the active locale
in its default dashboard return path. The test must fail against the current branch before the
production change and pass afterward. Existing OIDC and login tests will then be run for regression
coverage.

## Scope

This change only corrects locale propagation into the OIDC return path. It does not alter OIDC
discovery, token exchange, session creation, authorization, or redirect-origin handling.
