# Null mobile save exporter

**Use the converter:** https://rbrt2842.github.io/null-mobile-save-exporter/

Choose an exported Pokémon Null save and copy the generated text into your
calculator. The page processes saves on your device; files are never uploaded.

- Null 1.2.6 (default) and 1.2.4, selected explicitly.
- Party and boxes 1–12; dead boxes excluded.
- Include held items checkbox, selectable text box, and Copy button.
- Showdown-style species, ability, level, nature, IVs, and moves.
- Hidden Power types, Rotom/Minior alternatives, and eligible 1.2.6 Mega entries.
- Unchecking items removes all item headers, including generated Mega entries.

Save in-game before exporting your `.sav`. Emulator save states are different
files. Version selection is required because the save does not reliably identify
its game version. Eggs are skipped with a notice; damaged records report an error.

Export formatting and alternate-form ideas are based on Baat’s Tracking Script
V1.2.6. Game lookup data was generated from checked local Null ROMs. The website
contains no ROMs or personal saves. Calculator support for every form and
clipboard behavior on each phone/browser still need device testing.

## Run locally

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory web
```

Open http://localhost:8765. No package installation or build is needed.

## Checks

```sh
node tests/web_save.mjs
```

Tests cover all 24 encrypted record permutations, nature overrides, items,
forms, PC sector boundaries, dead boxes, checksums, save fallback, counter
rollover, and page controls with a mock DOM. They do not replace real device tests.

## GitHub Pages

The Deploy save converter workflow tests the converter and publishes only the
five website assets. Pages uses GitHub Actions as its publishing source.
Changes to `web/` on `main` deploy automatically; the workflow can also be
started manually from the Actions tab.
