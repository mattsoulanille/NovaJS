# Stock data quirks

Oddities in EV Nova's own data files (`Nova Files`, no plug-ins) that NovaJS
reproduces on purpose. The policy is to stay faithful to the original game:
NovaJS reads the data as written and does not patch it, even where it looks like
a mistake by the original authors. Plug-ins can still override any of these
resources the usual way.

Before reporting a "wrong ship / wrong government" bug, check this list and parse
the stock files alone (no `Plug-ins`) to see whether the data itself says so.

## Small Houseless (düde 207) can fly a Polaris Striker

- **Seen as:** a Houseless (Auroran) ship flying a cloaking Polaris Striker
  ("Striker;Cloaking+fast jump", subtitle Nil'kimas). For example, one of the four
  ships in "Destroy Pirate Menace;Auroran 012a" (mïsn 667), which spawns from this
  düde.
- **Data:** düde 207, "Small Houseless", lists ship type **329** at weight 5 in
  slot 10, out of a total weight of 105. That gives each spawned ship about a
  1-in-21 chance of being a Striker.
- **Likely cause:** the other Houseless düdes (205, 206) have ship **239**, an
  Auroran Abomination, in slot 10, followed by 240 and 241, as 207 has. 329 looks
  like a transposed 239. The original game shows the same Striker.
- **Ruling:** keep it (maintainer, 2026-11-22).
