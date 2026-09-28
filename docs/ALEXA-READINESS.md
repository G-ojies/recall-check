# Readiness for a real Alexa+ listing

The Alexa+ MCP Toolkit is in preview with select partners, so this add-on could not be deployed to Alexa+ during the hackathon. This page records where it stands against Amazon's published requirements, read on 28 September 2026 from `developer.amazon.com/docs/alexaplus/add-ons/`.

## Done

| Requirement | Source page | Status |
| --- | --- | --- |
| MCP 2025-11-25 | mcp-toolkit-overview | Done. The SDK's latest protocol version is 2025-11-25. |
| Streamable HTTP, remote URL | mcp-toolkit-quickstart | Done. `POST https://recall-check-sage.vercel.app/mcp`. |
| Round trip under 500 ms | mcp-toolkit-quickstart | Done: 3 to 15 ms locally, 30 to 200 ms on the live host when warm, measured 28 September 2026. A cold start takes one to two seconds. |
| Voice responses under 30 seconds | functional-requirements | Done, enforced by a test. |
| At most 5 options | functional-requirements | Done. At most 3 recalls are spoken, at most 5 are returned. |
| Explicit confirmation before deletion | functional-requirements | Done, enforced on the server. |
| Errors through `isError`, nothing internal in customer-facing text | mcp-addon-tools-schema-data-design | Done, enforced by a test. |
| Both `content` and `structuredContent` returned | mcp-addon-tools-schema-data-design | Done. |
| Every listed tool works | functional-requirements | Done. Seven tools, all covered by tests. |
| Add-on manifest | alexa-ai-cli-reference | Drafted in `addon-package/addon.json`. Name 12 of 30 characters, short description 82 of 123. |
| Service-level authentication | mcp-toolkit-authentication | Done. Client credentials grant, HTTP Basic or body credentials, `resource` checked, `mcp:service` only, one hour, no refresh token. A service token can initialize, list tools and search recalls. |
| Account linking | mcp-toolkit-account-linking | Done. Authorization code grant with PKCE (S256 only), a refresh token with every access token, static clients, any number of registered redirect addresses, `resource` checked. Metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`. Household tools return 401 until an account is linked. |
| Privacy policy and terms of use | mcp-toolkit-account-linking | Done. Served at `/privacy` and `/terms`. |
| Storage shared between instances | | Done. Redis over REST when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set, files otherwise. |

## Remaining

| Item | What it needs |
| --- | --- |
| Registering with Alexa+ | The client id, the client secret and Amazon's list of redirect addresses come from `alexa-ai configure-account-linking`, which needs partner access. They go in `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET` and `OAUTH_REDIRECT_URIS`. |
| An always-on host | The demonstration runs as a serverless function. A request that starts a new instance loads the index first, which takes one to two seconds. A listing needs a host that stays warm. |
| Account recovery | Accounts are an email address and a password. There is no password reset or email verification yet. Login with Amazon would remove the need for both. |
| Store listing assets | Icons and a carousel image are in `addon-package/assets/`. The sizes Amazon requires are in the Developer Hub, which needs partner access, so these are unverified. |
| Proactive alerts | Alexa+ add-ons answer when asked. Telling the owner about a new recall without being asked needs a notification channel Amazon has not documented for add-ons. |
