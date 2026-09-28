# Devpost submission

Text for the submission form at https://amazonappdev2026.devpost.com/ (Alexa+ track). Deadline 23 October 2026, 12:00 PT. Put it in your own words where you want to; the facts are checked against the repository.

| Field | Value |
| --- | --- |
| Project name | Recall Check |
| Tagline | Tell Alexa what you own. Hear about it when any of it is recalled, and what to do. |
| Track | Alexa+ |
| Repository | https://github.com/G-ojies/recall-check |
| Live demo | (the Render address, once deployed) |
| Video | (the YouTube address, once uploaded) |
| Built with | TypeScript, Node.js, Model Context Protocol (2025-11-25, Streamable HTTP), OAuth 2.1, Express, Zod, Redis, CPSC / NHTSA / openFDA public APIs |

## Inspiration

The United States recalls hundreds of products a year. A recall notice reaches the people who registered the product, and almost nobody registers an air fryer or a stroller. To find out for yourself you would have to remember everything you own and search three government websites, again and again.

A voice assistant is already in the room with those products. Saying "I just bought a Graco stroller" costs nothing. That is the whole idea: say what you own once, in passing, and let the assistant do the checking.

## What it does

Recall Check is an Alexa+ add-on. You tell Alexa what you own: a stroller, an air fryer, your car, a medicine. It compares your things with recalls from the Consumer Product Safety Commission, the National Highway Traffic Safety Administration and the Food and Drug Administration.

- "Alexa, add my Cosori air fryer, model CP158-AF." It is saved and checked at once. If it is recalled you hear so, and whether to stop using it.
- "What should I do about it?" You hear the remedy: a refund, a repair or a replacement.
- "I got the replacement." That recall is not mentioned again.
- "I drive a 2020 Honda Civic." Its open recalls are looked up and kept.
- "Is anything I own recalled?" New recalls since you last asked come first.

It is careful about how sure it is. It never reports a match on the brand alone. With a model number it says "is recalled". Without one it says "is probably affected" and asks you to compare the label. It never says "no recalls" about something it has not finished checking.

## How we built it

A self-hosted MCP server in TypeScript, on the official MCP SDK, built to Amazon's published Alexa+ requirements:

- **Seven tools**, each designed around one thing a person asks for. Every result carries a short paragraph written to be spoken and the same facts as data, with a card for a screen.
- **Under 500 ms.** Government APIs take 1 to 25 seconds, so no answer waits for one. Answers come from a local index of about 7,000 recalls, refreshed every six hours. Tool calls measure 3 to 20 ms. A vehicle lookup is given 250 ms; if the agency is slower, the item is saved, the user is told the check is running, and the result is stored in the background.
- **Authentication, both tiers.** The server is its own OAuth 2.1 authorization server. The client credentials grant gives Alexa+ a service token that can list tools and search recalls. The authorization code grant with PKCE links a household to an account. Household tools answer 401 until an account is linked, which is what makes Alexa+ start linking.
- **Rules enforced on the server, and by tests.** Removing an item needs an explicit yes. Nothing spoken carries a web address, an id or JSON. Every answer stays under about 75 words. 84 tests cover these, with no network and no keys needed.
- **A simulated Alexa+ device.** The Alexa+ developer tools are limited to partners, so the repository includes its own host: a page styled as an Echo Show. The assistant is simulated. The add-on behind it is real: every answer is a live MCP call over HTTP, timed against the 500 ms limit.

## Challenges we ran into

- **No access to the platform.** The MCP Toolkit, the CLI and the simulator are for select partners. Everything was built from the documentation, and the simulated host was written to stand in for the assistant.
- **Slow and unreliable data sources.** The agencies' endpoints drop connections and take seconds. The index carries each agency's rows over from the previous snapshot when that agency is down, so an outage never empties it.
- **Two bugs the demo recording caught.** Two saves to the same household could collide and lose a vehicle's recalls. And Alexa said "no recalls" while a vehicle check was still running. Both are fixed and have tests.
- **Telling a brand from a product.** "Cosori air fryer" and "Fisher Price sleeper" look alike. The recall data decides: "price" is mostly used by one maker, "air" by many.

## Accomplishments that we're proud of

- A working add-on that gives correct, careful answers from live government data.
- Account linking built to Amazon's pages without being able to test against Alexa+, with tests for replayed codes, forged tokens, wrong redirect addresses and refresh token rotation.
- A friction log of ten issues, each reproduced first-hand, including two places where Amazon's authentication pages contradict themselves.

## What we learned

Designing for voice changes the data model. A confidence level has to become a choice of words. A slow lookup has to become "ask me in a moment". And an error has to be a sentence someone can say.

## What's next for Recall Check

- Onboarding to Alexa+ when access opens, on a host that stays awake.
- Login with Amazon, so linking needs no new password.
- Meat and poultry recalls (USDA) and medical devices.
- Telling the owner about a new recall without being asked, when add-ons can send notifications.

## Product feedback

See [PRODUCT-FEEDBACK.md](PRODUCT-FEEDBACK.md) for the five answers and [FRICTION-LOG.md](FRICTION-LOG.md) for the ten issues.

## Video

2 minutes 52 seconds. Narration and Alexa's voice are synthesised; the screen is a recording of the running app. Script and recorder notes are in [VIDEO.md](VIDEO.md).
