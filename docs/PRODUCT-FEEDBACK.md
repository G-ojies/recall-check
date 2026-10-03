# Product feedback

Final answers for the five feedback questions on the Devpost submission form. The full list of issues, with steps and suggestions, is in [FRICTION-LOG.md](FRICTION-LOG.md).

## 1. Which developer tools, APIs and SDKs did you use and for what?

I built Recall Check as an Alexa+ add-on, which is an MCP server, so the Alexa+ add-on docs were my main reference: the quickstart, the functional requirements, the tool design guide, and the authentication and account linking pages. For the server itself I used the official MCP TypeScript SDK (spec version 2025-11-25) over Streamable HTTP, with input and output schemas on all seven tools. I wrote the OAuth 2.1 side myself, following the Alexa pages: client credentials for the service token, and authorization code with PKCE for account linking. The recall data comes from the public CPSC, NHTSA and openFDA APIs. I could not use the Alexa+ MCP Toolkit, the alexa-ai CLI or the simulator, because they are not open to hackathon participants, so I built a small simulator of my own to test the conversation and the linking flow.

## 2. What worked well?

The functional requirements page is very concrete. Lines like "keep voice responses under 30 seconds" and "ask for confirmation before a high-consequence action" turned straight into tests in my repo. The tool design guide's idea of one tool per customer intent kept me from building one giant "do everything" tool. The account linking page was the best page in the whole set. It says clearly what Alexa handles and what I have to build, and its checklist was enough for me to build the whole authorization server without ever touching the real platform. And because Alexa+ uses MCP, an open standard, I could start building on day one with tools I already had.

## 3. What needs work?

The biggest problem for me was that the toolkit, the CLI and the simulator are partner-only, and the quickstart does not say so. I spent time looking for them before I realised I was building against the docs alone, with no way to check my server against the real thing. After that, the inconsistencies hurt more than they should have, because I had no simulator to settle them. The sample payloads use protocol versions 2025-03-26 and 2025-06-18 while the requirement is 2025-11-25. The docs ask for 500 ms responses in one place and give 3 seconds as best practice in another. The authentication page says a service token carries only mcp:service in one section and mcp:tools in another. I logged ten issues like these, each with steps and a suggested fix, in the friction log in my repo.

## 4. How was your onboarding experience?

Mixed. The very first link I opened, the docs base address, returned a 404, which was not a great start. Getting a working MCP server running took only a few hours, because MCP and its SDK are well documented. But a "hello world" on real Alexa+ was never possible for me. The platform tools are limited to partners, and Alexa+ is not available in Nigeria, where I live, so I could not test on a device either. Everything I know about how it behaves on Alexa came from reading the docs carefully.

## 5. Would you build with these devices and services again?

Yes. A recall check is something nobody opens an app for, but asking out loud is easy, so a voice assistant that is already in the home is the right place for it. It matters where I live too: a lot of the cars, car seats and electronics people buy in Nigeria are used imports from the US, often with a recall nobody fixed, and asking "is my car recalled?" should be as easy as asking the time. Because Alexa+ add-ons are MCP servers, the work is not locked to one assistant, which makes it a safe bet for a solo developer. What would bring me back faster is access to the simulator or a conformance checker, so I am building against the platform and not just against the docs.
