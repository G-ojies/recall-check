# Product feedback

Draft answers to the five questions on the submission form. Edit them so they are in your own words before submitting.

## 1. Which developer tools, APIs and SDKs did you use and for what?

- **Alexa+ add-on documentation** (`developer.amazon.com/docs/alexaplus/add-ons/`): the requirements the server was built to. The quickstart, functional requirements, tool design guide, authentication page, account linking page and CLI reference were the most used.
- **Model Context Protocol, specification 2025-11-25**, through `@modelcontextprotocol/sdk` 1.30: the server (Streamable HTTP, tools with input and output schemas) and the client inside the simulated host.
- **OAuth 2.1**, as the authentication and account linking pages describe it: the client credentials grant for the service-level token, and the authorization code grant with PKCE for account linking. Both are implemented in the server itself.
- **Public recall APIs** from the CPSC, NHTSA and openFDA: the data.

The Alexa+ MCP Toolkit, the `alexa-ai` CLI and the web simulator were not used because they are not available to hackathon participants.

## 2. What worked well?

- The functional requirements page is specific. Rules such as "Keep voice responses under 30 seconds" and "Require explicit confirmation ... before any high-consequence action" could be turned directly into tests.
- The tool design guide's advice to design each tool around one customer intent led to a small, clear set of seven tools.
- The account linking page is the clearest in the set. Its list of what Alexa handles and what the developer builds, and its pre-flight checklist, were enough to build the authorization server without access to the platform.
- Choosing an open standard means the server was built and tested with the standard MCP SDK, with nothing proprietary needed to get started.

## 3. What needs work?

Ten issues are written up with steps and suggestions in [FRICTION-LOG.md](FRICTION-LOG.md). The four that cost the most:

1. The toolkit, CLI and simulator cannot be obtained, and the quickstart does not say so.
2. Sample payloads show protocol versions 2025-03-26 and 2025-06-18 while 2025-11-25 is required.
3. The 500 ms requirement and the 3 second best practice are not reconciled.
4. The authentication page says in one section that a service token carries only `mcp:service`, and in another that it carries `mcp:tools`.

## 4. How was your onboarding experience?

Getting to a working MCP server took a few hours, because the protocol and its SDK are well documented. Getting to "hello world" on Alexa+ was not possible: the platform tools are limited to partners. The documentation base address returning 404 was the first thing encountered.

## 5. Would you build with these devices and services again?

Yes. A voice assistant that is already in the home is the right place for something like a recall check, which people will not open an app for. The open protocol means the work is not tied to one assistant. Access to a conformance checker or the simulator would make the difference between building to the documentation and building to the platform.
