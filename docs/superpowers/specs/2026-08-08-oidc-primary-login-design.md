# OIDC-First Login Design

## Goal

Make the configured OIDC provider the default login path while keeping API key login available as a secondary recovery path. Brand the primary action as `acitrus.cn` instead of exposing the underlying Authelia implementation.

## User Experience

While OIDC availability is loading and after it is confirmed enabled, the login card shows a full-width primary button labeled with the locale-specific equivalent of `Continue with acitrus.cn`. Beneath it, a secondary disclosure control labeled with the locale-specific equivalent of `Use password login` expands the API key form in place. The disclosure indicator reflects the expanded or collapsed state, and the control can collapse the form again. Treating the loading state as OIDC-first prevents the API key form from flashing before the status request resolves.

When OIDC is disabled or the OIDC status request fails, the API key form is shown immediately. In that fallback state, the OIDC button and password disclosure control are omitted so that a usable login path is always visible.

The existing locale-aware OIDC return target remains unchanged. For example, a Chinese login continues to return to `/zh-CN/dashboard`.

## Components and State

The existing login page owns one additional boolean state for whether the password form is expanded and replaces the OIDC availability boolean with an explicit `loading`, `enabled`, or `disabled` presentation state. OIDC availability determines the presentation:

- OIDC loading: primary OIDC button visible; API key form collapsed by default.
- OIDC available: primary OIDC button visible; API key form collapsed by default.
- OIDC unavailable or status lookup failed: API key form visible directly.
- User activates disclosure: API key form expands or collapses in place.

The current Card, Button, form, validation, HTTP warning, error alert, and password visibility behavior remain in place. No modal, dropdown menu, new route, or authentication protocol change is introduced.

## Copy and Localization

All five authentication message files receive localized copy for:

- The primary `acitrus.cn` login action. The domain remains unchanged in every locale.
- The password-login disclosure action.
- The collapse action or accessible expanded-state label where needed.

The old user-facing Authelia name is removed from the login action. Internal OIDC and Authelia implementation names remain unchanged.

## Accessibility

The password disclosure is a real button with `aria-expanded` and an association to the collapsible form region. It is keyboard operable, has a visible focus state, and does not place the form inside a menu. The form keeps its existing labels and password visibility control.

## Error Handling

Failure to fetch OIDC status is treated as OIDC unavailable for presentation purposes, so the API key form becomes visible. Existing login and OIDC authentication errors continue to use the current alert surface.

## Testing

Login-page behavior tests will verify:

- OIDC availability shows `acitrus.cn` as the primary action.
- The initial loading state is OIDC-first and does not flash the API key form.
- The API key form is hidden initially when OIDC is available.
- Activating the password disclosure reveals the real API key form.
- OIDC disabled or a status request failure shows the API key form directly.
- The OIDC link retains the locale-prefixed return target.
- All locale files expose the required authentication keys.

Focused login tests, lint, type checking, and the production build will be run before integration. Existing unrelated full-suite failures will be reported separately rather than silently attributed to this UI change.
