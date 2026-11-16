---
name: design-directions
description: Plan several clearly different UI directions for an existing product before building them. It frames the problem, chooses the tradeoffs that matter (new user or expert, AI or person, speed or control, market, target users), places each direction on one of them, and grounds each in how real products, including competitors' help docs, solve the same job. Use when someone asks for a new round of directions, options, or alternatives for a whole screen or flow, such as "a few directions for the upgrade page" or "other ways to do onboarding". Not for another version of an existing item, a change to one version ("try X", "make it bolder", "simpler"), alternatives for a single component, copy, or visual polish: those are ordinary canvas changes. A round takes several minutes, research included.
---

# Design directions

Agents tend to make options that are siblings: the same layout with a different color, or the same idea at three densities. People who do not design every day, such as product managers and engineers, also tend to stop at the first idea. This skill shows the range: it names the tradeoffs a designer would weigh for this screen, and makes each direction a different answer to one of them. The person sees what is possible, and chooses with reasons.

The person's own instructions come first. When the person, the project, or another skill they use says how to make directions (how many, which tradeoffs, which references, which method), follow that, and use this skill only for what it leaves open.

## 1. Know the phase

A round of directions takes several minutes, most of it research and sketching, so run it only when the person asks for one.

| The person is | Do |
|---|---|
| Asking for new directions for a whole screen or flow | All the steps below. |
| Asking something that could mean one better version or a round of directions, such as "how could we improve the upgrade page" | Do not run the round. Make one improved version, with the canvas's usual rules, and offer a round in one line, such as "I can also lay out a round of directions for this page, with research; it takes several minutes." Do not wait for an answer before you make the version. |
| Asking for another version, a change to one, or alternatives for a single component | Do not use this skill. These are ordinary canvas changes. |
| Asking for variations of one direction | Skip steps 2, 3, and 5. Keep its spectrum and position. Vary one structural axis at a time. |
| Choosing between directions | Compare them on the criteria from step 2: what each one is good at, what it gives up, and which one you would pick and why. |
| Refining the one they chose | Change that one. Make no new directions. |

When the person asks again for "more" or "other ideas", use a spectrum you have not used yet, such as one you listed as not used in step 3. Do not make small changes to the last round. Reuse the problem, the criteria, and the research from the last round (step 5); do not frame or search again what is already there.

## 2. Frame the problem

Before any idea, know what the screen is for. Get it from the request, the code, the product's docs, and the canvas notes.

- Who uses this screen, and for what job.
- What a good result is: one to three things a person could check, such as "finds the contract that expires first without scrolling" or "a new user sends the first request without help". These are the criteria for comparing the directions.
- If the request rests on an assumption worth checking, or misses a fact that would change the directions (who the users are, which markets the product sells in), say so in one line, state the reading you used, and continue. Do not wait for an answer. For example: "handle first" can mean the nearest deadline or the highest risk.

## 3. Choose the spectra

A spectrum is a tradeoff with a good answer at each end. Each direction takes a position on one spectrum. The spectrum gives a direction its reason; the structural axes in step 4 give it its form.

Common spectra. Find others in the product:

- **New user ↔ expert**: learn it in a minute, or fast every day.
- **The product or AI does it ↔ the person does it**: defaults, suggestions, and automatic actions, or manual control. The far end often removes UI or a whole step.
- **Speed ↔ control**: one action, or a review before anything is sent.
- **One task ↔ overview**: focus on the item at hand, or see many at once.
- **Market and culture**, such as Japan ↔ US: density, formality, approval steps, and what makes people trust the screen.
- **Roles**: the different people who use the same screen, such as the admin who pays and the member who hits a limit and asks the admin.
- **Situation**: how people arrive, such as pushed by a limit ↔ comparing on purpose, or on a phone in a hurry ↔ at a desk with time.
- **Target users**: the different people the product serves. In a legal product, for example: lawyers (deep review, risk judgment, final sign-off), business users (requests and intake, working with legal, and "what do I do next?"), and legal ops (playbooks, templates, permissions, reporting). Most screens serve one or two of them; use only the ones who really use this screen.

Rules:

- At least one spectrum in each round is about people: who uses the screen, or in what situation. Take it from the roles in the product (the code usually has them), from how people arrive at the screen, or from personas and markets the product's docs describe. If none applies, say why.
- Use only spectra that are real for this product and this screen, and say why in a few words. Take markets and target users from the product's docs, its locales, or the person. Never make up a user group.
- Use one to three spectra in a round. More spectra show more of the range; fewer make each comparison sharper.
- The current product sits at some point on each spectrum. Name that point. It is the shared reference that makes directions on different spectra comparable: each direction says what changes when the product moves toward one end.
- List the spectra you considered and did not use, with a reason in a few words. The person can ask for one of them next.
- On some spectra, such as a market, the answer can be "both": one version for each market, or a setting. Say so when it applies.

## 4. Fix what stays the same

An existing product has fixed parts: its design system, components, tokens, brand, platform, data, and the goal of the screen. Keep them. Directions differ in structure, on these axes:

- **Hierarchy**: what comes first, what is secondary, what is hidden until needed.
- **Layout model**: list, table, board, split view, single focus, cards, timeline.
- **Interaction model**: inline editing, a side panel, a step-by-step flow, bulk actions, search first, AI first.
- **Density**: how much shows at once, and how much is behind progressive disclosure.
- **Flow**: the number and order of steps, and where the task starts.

A different color, theme, light or dark mode, corner radius, spacing, or copy is not a direction. Count visual axes only when the person asks for visual exploration, and then change the structure with them.

## 5. Look at how others solve it (new directions only)

Before you draft, find out how real products handle the same job. For each spectrum end you use, find one or two products that do that end well. Start with direct competitors, then add products from other fields.

- Use the person's references first, when they give some.
- Enterprise SaaS websites often show little of the product. Read their help center, documentation, support articles, release notes, and public demo videos. These describe the real screens, settings, and steps.
- Prefer real product screens (help-doc screenshots, product videos) over concept shots on Dribbble or Behance, which often show work that no one uses.
- Never put confidential details of the person's product, customers, or data into a search query. Search for the general job, such as "contract approval workflow".
- Stop when you can say in one line how each product handles the job. This is a short check, not a report.
- Without web access, say so, and use what you know, marked as from memory.
- Research once for each screen. Keep what you found, one line for each product with its source link, under "Sources" in the round's note (step 8), or in the chat without a canvas. Before you search, read that note: a later round on the same screen uses what is there, and you search only for a spectrum end the note does not cover, or when the person asks for new references.

## 6. Draft the directions

- Make five to seven by default, besides the baseline. The person sets the count.
- One direction stays close to the current product, as the baseline. On a design canvas, the item that shows the current product is the baseline: do not add a draft or card for it. If the canvas has no such item yet, add it first, built from the product's own component, so the directions have something to be compared with.
- Give every other direction one spectrum, one position on it, and one bet. Name it after the bet: `Inbox · grouped by matter`, not `Inbox · option 2`.
- Show each position in the structure: change at least one structural axis from the baseline. A direction that moves on a spectrum with no change in structure is a sibling.
- For each direction, know: its spectrum and position, what it bets on, who it serves best, what it gives up or how it could fail, how it does on each criterion from step 2, and where the idea came from (the product it borrows from, or deliberately differs from, and why).
- Go to the far end of at least one spectrum. A far-end direction must still be usable and buildable with the product's components. Never trade a working task for novelty.
- Describe mechanisms, not moods. Translate vague words such as clean, modern, premium, simple, or intuitive into decisions a person can see: what moves, what is removed, what is grouped. Do this for vague feedback too, and say how you read it.
- When a direction lets the product or AI decide for the person, for example a ranking, an auto-sort, or a bulk approval, say what could go wrong and what control the person keeps.

## 7. Check the set

Before you show the directions, check them. Do this silently; do not print it.

- Each direction helps with the job from step 2. Replace one that does not.
- Each spectrum you chose has at least one direction that moves clearly along it.
- Two directions on the same spectrum sit at clearly different positions and differ on at least two structural axes.
- If two directions could swap names and no one would notice, or they look like the same team made them on the same day, rework the weaker one.
- If every direction would do the same on every criterion, the set does not help anyone decide: move one further along its spectrum.

## 8. Show them as cards

- **On a design canvas**, put each direction on the canvas as a planned card, and do not list the directions in the chat (see "Planned directions" in the `design-canvas` skill). Cards are fast, so show the whole set before anything is built.
  - Draw one section around the whole round, titled with the screen, such as `Upgrade page · directions`. It holds the baseline where it stands, and below it one section for each spectrum, titled with the spectrum, such as `Speed ↔ certainty`, with its cards from one end to the other. Pick treats the outer section as one comparison: when the person picks a direction, the canvas sets all the others aside, each spectrum's section whole, and the baseline too.
  - Start each card's `bet` with its position, such as `Speed end: …`.
  - Sketch the one screen that shows the bet, and mark the part that differs from the baseline as the key change.
  - Add one canvas note beside the round's section: the job, the criteria, the spectra you used, and the ones you considered and did not use, with their reasons, then "Sources", one line for each product you looked at, with its link. People who open the shared file were not in the conversation, and a later round reads it instead of searching again. For a later round, add to this note; do not write a second one.
  - Give only your sources in the chat.
- **Without a canvas**, list the directions in the Report format below, grouped by spectrum, with your sources. When building them needs new components or several screens, ask before you build.

Build what the person asks for: one card from its **Build this** button, or every card left when they say to go ahead. Do not ask them to drop cards first, and do not build cards they did not ask for. A built card is a draft: the one screen that shows the bet, made with the product's real components and the same synthetic data, size, and theme as the baseline. Other screens, states, phone width, and languages wait until the person asks for them (see "Build only what the request needs" in the `design-canvas` skill).

## 9. Converge

The person decides how to finish. They can build any number of cards, take any draft further, pick one, or keep several. Nothing here is a step they must take.

- To take a draft further, the person asks for what it needs: the whole flow, states, phone width, or languages. Add only what they ask for, to that draft.

- On a design canvas, the person picks a version with Pick, and the canvas sets the others aside by itself. Do not move, trash, or delete those versions yourself. Write a decision note as "Decision notes" in the `design-canvas` skill says.
- When the person chooses in words ("go with B", "this one"), stop making directions and refine that one.
- When they like parts of several, make one combined version, with `from` set to the closest original. Say which part comes from which direction, and keep it beside the originals.
- Do not delete directions nobody chose unless the person asks.

## Report

On a design canvas, the cards and the note already hold the directions, so do not repeat them in the chat. Say in one or two lines where they are, that the person builds or drops each one from its card, and that a built draft can get more on request (the whole flow, states, phone width, languages). Then give your questions for the person, a recommendation when the choice is clear (in terms of the criteria), and links to the sources you used.

Without a canvas, start with the job and the criteria in one or two lines. Then, for each spectrum, its name and why it matters here, and for each direction on it: its name, position, bet, what it gives up, and its reference. List the spectra you did not use, with their reasons. End with links to the sources you used. When the choice is clear, or the person asks, recommend one and say why, in terms of the criteria.
