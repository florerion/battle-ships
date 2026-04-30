# Logopedyczne Statki

A two-player Battleships game with speech-therapy coordinates — designed for children practising the pronunciation of difficult sounds in Polish.

## Running locally

```bash
# backend
cd backend && npm install && npm run dev

# frontend (second terminal)
cd frontend && npm install && npm run dev
```

Frontend runs at `http://localhost:5173`, backend at `http://localhost:3001`.

## Board configuration (`frontend/src/config/board.json`)

The entire board — its size, coordinate labels and icons — is driven by a single JSON file. You can customise it without touching any code.

### Board size

```json
"boardSize": 8
```

Change to `6`, `10`, etc. The number of entries in `rows` and `columns` must match `boardSize`.

### Rows and columns

Each row and column is an object with three fields:

```json
{ "id": "unique-id", "label": "word to pronounce", "icon": "IconName" }
```

- **`label`** — the word displayed on the chip and read aloud by the speech synthesiser (pl-PL).
- **`icon`** — the exact icon name from [lucide-react](https://lucide.dev/icons/) in PascalCase, e.g. `Waves`, `Skull`, `Flower2`.  
  If the icon does not exist the cell falls back to `Square`.

### Fleet

```json
"ships": [
  { "size": 4, "count": 1 },
  { "size": 3, "count": 2 },
  { "size": 2, "count": 3 },
  { "size": 1, "count": 4 }
]
```

- **`size`** — ship length in cells.
- **`count`** — how many ships of this size each player gets.

## Finding icon names

Go to [lucide.dev/icons](https://lucide.dev/icons/), find the icon you want and copy its PascalCase name (e.g. `CloudRain`, `Cherry`, `Drumstick`).


## Uruchomienie lokalne

```bash
# backend
cd backend && npm install && npm run dev

# frontend (w drugim terminalu)
cd frontend && npm install && npm run dev
```

Frontend działa na `http://localhost:5173`, backend na `http://localhost:3001`.

## Konfiguracja planszy (`frontend/src/config/board.json`)

Cały wygląd planszy — rozmiar, nazwy pól i ikony — jest sterowany przez jeden plik JSON. Możesz go edytować bez znajomości kodu.

### Rozmiar planszy

```json
"boardSize": 8
```

Zmień na `6`, `10` itd. Liczba wierszy i kolumn musi odpowiadać liczbie pozycji w tablicach `rows` i `columns`.

### Wiersze i kolumny

Każdy wiersz i kolumna to obiekt z trzema polami:

```json
{ "id": "unikalne-id", "label": "słowo do wymówienia", "icon": "NazwaIkony" }
```

- **`label`** — słowo wyświetlane i odczytywane przez syntezę mowy (pl-PL).
- **`icon`** — nazwa ikony z biblioteki [lucide-react](https://lucide.dev/icons/). Musi być dokładna (wielkość liter ma znaczenie), np. `Waves`, `Skull`, `Flower2`.  
  Jeśli ikona nie istnieje, automatycznie zostanie użyta `Square`.

### Flota statków

```json
"ships": [
  { "size": 4, "count": 1 },
  { "size": 3, "count": 2 },
  { "size": 2, "count": 3 },
  { "size": 1, "count": 4 }
]
```

- **`size`** — długość statku w polach.
- **`count`** — ile sztuk takiego statku ma każdy gracz.

## Jak znaleźć nazwę ikony

Wejdź na [lucide.dev/icons](https://lucide.dev/icons/), znajdź ikonę i skopiuj jej nazwę w formacie PascalCase (np. `CloudRain`, `Drumstick`, `Cherry`).
