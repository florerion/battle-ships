# Logopedyczne Statki

A two-player Battleships game with speech-therapy-style coordinates, built for playful Polish pronunciation practice.

## Running locally

```bash
# backend
cd backend && npm install && npm run dev

# frontend (second terminal)
cd frontend && npm install && npm run dev
```

Frontend runs at `http://localhost:5173`, backend at `http://localhost:3001`.

## Game settings from UI (no JSON edits needed)

You can configure core game parameters directly in the app before joining a room:

- Open **Game settings** from the lobby.
- Change board size.
- Use ready presets: `easy`, `medium`, `hard`, `ultra`.
- Fine-tune fleet composition: ship sizes and counts, add/remove ship types.
- Re-roll coordinate words for the current draft.

Important behavior:

- Settings are applied when creating a room and shared with the other player in that room.
- Capacity validation is automatic. If a fleet is too large for the selected board, the app clips it to a playable configuration and shows a warning.
- Per-type limits are enforced in the form, so impossible counts cannot be entered.

This means you can run many game variants without touching `frontend/src/config/board.json`.

## Configuration file (`frontend/src/config/board.json`)

The JSON file still defines defaults and the global word/icon pool used by the settings UI.

### Default board size

```json
"boardSize": 8
```

### Coordinate word pool

```json
"words": [
  { "id": "unique-id", "label": "word to pronounce", "icon": "IconName" }
]
```

- **`id`**: unique identifier.
- **`label`**: the text shown in the coordinate chip and spoken via speech synthesis (`pl-PL`).
- **`icon`**: icon name from [lucide-react](https://lucide.dev/icons/) in PascalCase (for example `CloudRain`, `Cherry`, `Ship`).

Board size is dynamically limited by the size of this shared `words` pool.

### Default fleet

```json
"ships": [
  { "size": 4, "count": 1 },
  { "size": 3, "count": 2 },
  { "size": 2, "count": 3 },
  { "size": 1, "count": 4 }
]
```

- **`size`**: ship length in cells.
- **`count`**: number of ships of that size.

## Finding icon names

Go to [lucide.dev/icons](https://lucide.dev/icons/), choose an icon, and copy its PascalCase name.
