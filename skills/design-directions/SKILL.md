---
name: design-directions
description: Plan several clearly different UI directions for an existing product before building them, grounded in how real products, including competitors' help docs, solve the same job. Use when someone asks for options, directions, alternatives, explorations, or "a few ideas" for a screen, flow, or component, or before adding new directions to a design canvas. Not for small changes to one chosen version.
---

# Design directions

Agents tend to make options that are siblings: the same layout with a different color, or the same idea at three densities. This skill makes each direction a different bet that a person can compare and choose from.

The person's own instructions come first. When the person, the project, or another skill they use says how to make directions (how many, which axes, which references, which method), follow that, and use this skill only for what it leaves open.

## 1. Know the phase

| The person is | Do |
|---|---|
| Asking for new directions | All the steps below. |
| Asking for variations of one direction | Skip research. Vary one axis of that direction at a time. |
| Choosing between directions | Compare them: what each one is good at, what it gives up, and which one you would pick and why. |
| Refining the one they chose | Change that one. Make no new directions. |

When the person asks again for "more" or "other ideas", change the axis you explore. Do not make small changes to the last round.

## 2. Fix what stays the same

An existing product has fixed parts: its design system, components, tokens, brand, platform, data, and the goal of the screen. Keep them. Directions differ in structure:

- **Hierarchy**: what comes first, what is secondary, what is hidden until needed.
- **Layout model**: list, table, board, split view, single focus, cards, timeline.
- **Interaction model**: inline editing, a side panel, a step-by-step flow, bulk actions, search first, AI first.
- **Density**: how much shows at once, and how much is behind progressive disclosure.
- **Flow**: the number and order of steps, and where the task starts.

A different color, theme, light or dark mode, corner radius, spacing, or copy is not a direction. Count visual axes only when the person asks for visual exploration, and then change the structure with them.

## 3. Look at how others solve it (new directions only)

Before you draft, find out how three to five real products handle the same job. Start with direct competitors, then add products from other fields that do the same job well.

- Use the person's references first, when they give some.
- Enterprise SaaS websites often show little of the product. Read their help center, documentation, support articles, release notes, and public demo videos. These describe the real screens, settings, and steps.
- Prefer real product screens (help-doc screenshots, Mobbin, product videos) over concept shots on Dribbble or Behance, which often show work that no one uses.
- Never put confidential details of the person's product, customers, or data into a search query. Search for the general job, such as "contract approval workflow".
- Look at a real screen of each product where you can, such as a help-doc screenshot or a demo video. Then stop when you can say in one line how each product handles the job. This is a short check, not a report.
- Without web access, say so, and use what you know, marked as from memory.

For each direction, note what it borrows from which product, or which product it deliberately differs from and why.

## 4. Draft the directions

- If the request rests on an assumption worth checking, or misses data that would change the directions, say so in one line before the directions. For example: "handle first" can mean the nearest deadline or the highest risk. Do not wait for an answer; state the reading you used.
- Make three by default. The person sets the count.
- Your first idea is usually the current design or the most common pattern. Keep one direction close to the current product or the most common answer, as the baseline. Every other direction must leave it on at least one structural axis.
- Give each direction one bet, and name it after the bet: `Inbox · grouped by matter`, not `Inbox · option 2`.
- For each direction, know four things: what it bets on, who it serves best, what it gives up or how it could fail, and where the idea came from.
- Describe mechanisms, not moods. Translate vague words such as clean, modern, premium, simple, or intuitive into decisions a person can see: what moves, what is removed, what is grouped. Do this for vague feedback too, and say how you read it.
- When a direction lets the product or AI decide for the person, for example a ranking, an auto-sort, or a bulk approval, say what could go wrong and what control the person keeps.
- At least one direction should be bold. A bold direction must still be usable and buildable with the product's components. Never trade a working task for novelty.

## 5. Check the spread

Before you build, check each pair of directions. Do this silently; do not print it.

- Two directions must differ on at least two of the axes in step 2.
- If two directions could swap names and no one would notice, or they look like the same team made them on the same day, rework the weaker one.
- If a direction exists only to be different and you cannot say who it is for, replace it.

## 6. Confirm when building is costly

When the directions need new components, several screens, or more than three items, first list them in the Report format below, with your sources. Ask the person to go ahead. Skip this for variations, small requests, or when the person said to just build.

## 7. Converge

- When the person chooses one ("go with B", "this one"), stop making directions and refine that one.
- When they like parts of several, make one combined version. Say which part comes from which direction, and show it beside the one or two closest originals.
- Set aside the directions nobody chose. Do not delete them unless the person asks.

## Report

Before building (step 6) or after it, give one short entry for each direction: its name, its bet, what it gives up, and its reference. End with links to the sources you used. When the choice is clear, or the person asks, recommend one and say why.
