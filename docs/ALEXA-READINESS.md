# Readiness for a real Alexa+ listing

The Alexa+ MCP Toolkit is in preview with select partners, so this add-on could not be deployed to Alexa+ during the hackathon. This page records where it stands against Amazon's published requirements, read on 28 September 2026 from `developer.amazon.com/docs/alexaplus/add-ons/`.

## Done

| Requirement | Source page | Status |
| --- | --- | --- |
| MCP 2025-11-25 | mcp-toolkit-overview | Done. The SDK's latest protocol version is 2025-11-25. |
| Streamable HTTP, remote URL | mcp-toolkit-quickstart | Done. `POST /mcp`. Needs a public HTTPS host. |
| Round trip under 500 ms | mcp-toolkit-quickstart | Done locally (3 to 15 ms). To be measured on the chosen host. |
| Voice responses under 30 seconds | functional-requirements | Done, enforced by a test. |
| At most 5 options | functional-requirements | Done. At most 3 recalls are spoken, at most 5 are returned. |
| Explicit confirmation before deletion | functional-requirements | Done, enforced on the server. |
| Errors through `isError`, nothing internal in customer-facing text | mcp-addon-tools-schema-data-design | Done, enforced by a test. |
| Both `content` and `structuredContent` returned | mcp-addon-tools-schema-data-design | Done. |
| Every listed tool works | functional-requirements | Done. Seven tools, all covered by tests. |
| Add-on manifest | alexa-ai-cli-reference | Drafted in `addon-package/addon.json`. Name 12 of 30 characters, short description 82 of 123. |

## Remaining

| Item | What it needs |
| --- | --- |
| Account linking | OAuth 2.1 authorization code flow with PKCE (S256), a static client, refresh tokens with every access token, protected resource metadata at `/.well-known/oauth-protected-resource`, and a 401 without a `WWW-Authenticate` header. The household id then comes from the token's subject. Today `src/auth.ts` accepts configured bearer tokens. |
| Public host | An always-on HTTPS host. A host that sleeps when idle would break the 500 ms limit on the first request. |
| Household storage | One file per household works on a single instance. More than one instance needs shared storage; `Store` in `src/store.ts` is the interface to implement. |
| Store listing assets | Icons in six sizes, at least one 600 by 900 carousel image, privacy policy and terms of use pages. The manifest holds placeholder addresses for the last two. |
| Proactive alerts | Alexa+ add-ons answer when asked. Telling the owner about a new recall without being asked needs a notification channel Amazon has not documented for add-ons. |
