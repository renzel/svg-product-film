# svg-product-film

An agent skill that turns your app's SVG design exports into a product film with sound. Every frame is drawn from its time stamp in a headless browser and encoded with ffmpeg, and the score and interface sounds are made in code from the same timeline. Change the design, export again, run one command, and the film follows.

It's written for any agent that loads skills. So far it has been tried in Claude Code.

## Install

```bash
npx skills add trondrensel/svg-product-film
```

The [Skills CLI](https://github.com/vercel-labs/skills) asks which agents to install it for. Add `-g` to install it for all your projects, not just this one.

## What you need

- **SVG exports with live text and named layers.** In Figma, set each frame's SVG export to "Outline text" off and "Include "id" attribute" on.
- **Node 22 or later, ffmpeg and Google Chrome.** No npm packages: the skill drives Chrome over the DevTools Protocol itself.
- **macOS, for now.** It has only been tried on macOS. Elsewhere, set `CHROME_PATH` to your Chrome or Chromium, and find your fonts by hand.

## Use

Open your agent in a folder with your exports and ask for a product film, for example:

> Make a product film with sound from the SVG exports in this folder. My product is [name], [what it does, in a few words].

It checks the files first, and tells you before it starts if the text is outlined or the layers have no names.

## Status

Early. Made on 20 Oct 2026 from one test run, and not yet refined.

## License

[MIT](LICENSE)
