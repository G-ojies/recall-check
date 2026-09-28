# Friction log

Building a self-hosted MCP add-on for Alexa+ from Amazon's public documentation, 28 September 2026. Every entry was reproduced on that date. Severity: **Blocker** stops the work, **Major** costs hours or forces a workaround, **Minor** costs minutes.

## 1. The toolkit, CLI and simulator cannot be obtained

- **Task:** install the `alexa-ai` CLI and test the add-on in the web simulator.
- **Steps:** followed `set-up-your-development-environment.html`; ran `npm view @alexa-ai/cli`.
- **Expected:** a package to install, or a clear statement up front that access is limited.
- **Actual:** the public npm registry answers 404 for `@alexa-ai/cli`. The documentation home page says the MCP Toolkit is "available to select partners only", while the quickstart reads as if anyone can follow it. Amazon staff confirmed on the hackathon forum that participants cannot get access.
- **Severity:** Blocker for testing on the real platform.
- **Workaround:** built a simulated host that connects to the server with a real MCP client and measures each call against the 500 ms limit.
- **Suggestion:** put the access notice at the top of the quickstart and the CLI reference, not only on the home page. Publish a local conformance tool that does not need partner access: a command that connects to a server URL and reports which requirements pass.

## 2. The documentation has no index page

- **Task:** open the add-on documentation from its base address.
- **Steps:** requested `https://developer.amazon.com/docs/alexaplus/add-ons/`.
- **Expected:** a landing page or a redirect.
- **Actual:** 404. The content is at `home.html` in the same directory.
- **Severity:** Minor.
- **Workaround:** guessed `home.html`.
- **Suggestion:** redirect the directory address to `home.html`.

## 3. Sample payloads use older protocol versions than the one required

- **Task:** confirm which protocol version the Alexa+ client sends, to test version negotiation.
- **Steps:** read the sample `initialize` requests.
- **Expected:** `2025-11-25`, the version the overview says is supported and the hackathon requires.
- **Actual:** `mcp-toolkit-client-lifecycle.html` shows `"protocolVersion": "2025-03-26"`. `mcp-toolkit-local-inspector.html` shows `"protocolVersion":"2025-06-18"`.
- **Severity:** Major. A developer cannot tell which version the production client sends, and the three versions differ in what a tool result may contain.
- **Workaround:** the server supports 2025-11-25 and negotiates older versions. Both sample payloads were replayed against it.
- **Suggestion:** update both samples, and state the version the production client sends.

## 4. The 500 ms requirement and the 3 second best practice disagree

- **Task:** decide whether a tool may call a slow upstream API.
- **Steps:** read the quickstart and the functional requirements.
- **Expected:** one latency budget.
- **Actual:** the quickstart says the server "must meet a round-trip query response latency of less than 500 ms". The functional requirements give "Return results within 3 seconds" as best practice. Neither page mentions the other.
- **Severity:** Major. It decides the architecture. The recall agencies' APIs take 1 to 25 seconds, so this add-on had to move all of them off the answer path.
- **Workaround:** designed for 500 ms. Data is indexed locally and refreshed in the background.
- **Suggestion:** state whether 500 ms applies to every tool call or to a first response, what happens when a call exceeds it, and whether a tool can return an interim result.

## 5. Authentication departs from the MCP specification without saying so

- **Task:** plan account linking.
- **Steps:** read `mcp-toolkit-authentication.html`.
- **Expected:** the MCP authorization flow, in which a 401 carries a `WWW-Authenticate` header pointing to the resource metadata.
- **Actual:** the page lists `WWW-Authenticate` headers, Dynamic Client Registration and OpenID Connect as not supported. A server built to the MCP specification sends that header; the page does not say whether sending it is harmless or an error.
- **Severity:** Minor, because it is documented, but it is easy to miss in a list.
- **Workaround:** the server sends the header, because other MCP clients follow it, and also returns the JSON body from Amazon's sample (`"error": "unauthorized"`).
- **Suggestion:** add a short section titled "Differences from the MCP authorization specification", and say whether an unsupported header is ignored.

## 6. No guidance on limits for tools and payloads

- **Task:** decide how many tools to expose and how much data to return.
- **Steps:** searched the quickstart, the functional requirements and the tool design guide.
- **Expected:** limits on the number of tools, on description length and on response size.
- **Actual:** none found. Limits are given for the store listing only.
- **Severity:** Minor.
- **Workaround:** seven tools, responses capped at five recalls.
- **Suggestion:** publish the limits, or say there are none.

## 7. No guidance on tool annotations

- **Task:** mark which tools only read and which one deletes.
- **Steps:** searched the documentation for `readOnlyHint` and `destructiveHint`.
- **Expected:** a statement on whether Alexa+ uses them, for example to decide when to ask for confirmation.
- **Actual:** not mentioned.
- **Severity:** Minor.
- **Workaround:** set the annotations, and enforced confirmation on the server so it does not depend on them.
- **Suggestion:** document which annotations the client reads.

## 8. The authentication page contradicts itself on which scope a service token carries

- **Task:** implement the client credentials grant (service level).
- **Steps:** read `mcp-toolkit-authentication.html`, 28 September 2026.
- **Expected:** one answer to "which scope does a client credentials token carry?"
- **Actual:** two. "Token endpoint requirements" says to "Restrict issued scopes to service-level only (`mcp:service`)". Step 5 of "Client credentials runtime flow" says the server "issues access token with `mcp:tools`, `mcp:resource`, or self-defined scope". That step also spells the scope `mcp:resource`, where the rest of the page has `mcp:resources`.
- **Severity:** Major. A server built to step 5 hands user-level scopes to a caller with no user.
- **Workaround:** followed the requirements section and the checklist: `mcp:service` only, and a test refuses anything else.
- **Suggestion:** correct step 5 to `mcp:service`, and fix the spelling.

## 9. OpenID Connect is unsupported, and the samples request the `openid` scope

- **Task:** decide which scopes to list in the protected resource metadata.
- **Steps:** compared the two pages. `mcp-toolkit-authentication.html` lists "OpenID Connect (OIDC)" under "What isn't supported" and shows `scopes_supported` as `mcp:tools`, `mcp:resources`. `mcp-toolkit-account-linking.html` shows `scopes_supported` as `openid`, `your-custom-scope`, and its sample authorization request carries `scope=openid%20your-scope`.
- **Expected:** the same scopes on both pages, and no `openid` if OpenID Connect is not supported.
- **Actual:** it is unclear whether Alexa+ will send `openid`, and whether a server should accept it.
- **Severity:** Minor.
- **Workaround:** the server offers `mcp:tools` and `mcp:resources`, and drops any scope it does not know instead of failing the request, so a request that includes `openid` still links.
- **Suggestion:** use one set of scopes in every sample, and say what Alexa+ sends by default.

## 10. Which tools a service token may call is left to the reader

- **Task:** decide what to do when Alexa+ calls a tool with a service token.
- **Steps:** read "Transition to user-level authentication" and step 1b of the account linking page.
- **Expected:** a way to declare, per tool, whether it needs a linked account.
- **Actual:** the pages say the switch to account linking happens "only when a user-specific tool is invoked" and that the server should return 401 or 403. Nothing in the manifest or the tool definition marks a tool as user-specific, so Alexa+ can only find out by calling it and being refused.
- **Severity:** Minor. It works, at the cost of one failed call per customer.
- **Workaround:** `search_recalls` answers with a service token. The six household tools return 401 until an account is linked.
- **Suggestion:** a tool annotation or manifest field, for example `requiresAccountLinking`, so Alexa+ can start linking before the first call.

# Feature requests

| Request | Why it matters | Priority |
| --- | --- | --- |
| A conformance checker that runs without partner access | Developers outside the preview cannot verify anything. A checker would raise the quality of submissions before they reach certification. | Critical |
| A way for an add-on to notify the user | A recall published tomorrow matters more than one found today. Without a notification the user has to keep asking. | Important |
| A documented way to return an interim answer | Some lookups cannot finish in 500 ms. "I am checking, ask me in a moment" works, and a supported pattern would be better. | Important |
| Documented limits for tools and payloads | Removes guesswork. | Nice to have |
