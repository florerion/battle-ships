import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 3001);
const CLIENT_URL = process.env.CLIENT_URL || '*';
const ROOM_PREFIX = process.env.ROOM_PREFIX || 'logostatki';

type Player = {
  id: string;
  name: string;
  role: 'host' | 'guest';
  connected: boolean;
  lastSeenAt: number;
};

type ShipData = {
  id: string;
  row: number;
  col: number;
  size: number;
  orientation: 'horizontal' | 'vertical';
};

type CoordinateWord = {
  id: string;
  label: string;
  icon: string;
};

type ShipGroup = {
  size: number;
  count: number;
};

type GameSettings = {
  boardSize: number;
  rows: CoordinateWord[];
  columns: CoordinateWord[];
  ships: ShipGroup[];
};

type ShotRecord = {
  shooterId: string;
  row: number;
  col: number;
  result: 'hit' | 'miss' | 'sunk';
  sunkShipCells?: Array<{ row: number; col: number }>;
};

type GamePhase = 'waiting' | 'playing' | 'finished';
type FinishReason = 'allShipsSunk' | 'surrender' | 'disconnect' | null;

type Room = {
  id: string;
  settings: GameSettings;
  players: Player[];
  readyByPlayerId: Record<string, boolean>;
  boardByPlayerId: Record<string, ShipData[]>;
  disconnectTimersByPlayerId: Record<string, NodeJS.Timeout | null>;
  shots: ShotRecord[];
  currentTurnPlayerId: string | null;
  gamePhase: GamePhase;
  winnerPlayerId: string | null;
  finishReason: FinishReason;
  surrenderedPlayerId: string | null;
  createdAt: number;
};

const DISCONNECT_GRACE_MS = 20_000;
const MIN_BOARD_SIZE = 6;
const FLEET_SLOT_RESERVE = 4;
const FLEET_FEASIBILITY_CHECKS = 3;

function fleetBudget(boardSize: number): number {
  const rawBudget = (boardSize + 1) * Math.floor((boardSize + 1) / 2);
  return Math.max(0, rawBudget - FLEET_SLOT_RESERVE);
}

function fleetCost(ships: ShipGroup[]): number {
  return ships.reduce((sum, s) => sum + (s.size + 1) * s.count, 0);
}

type SimShip = {
  id: string;
  row: number | null;
  col: number | null;
  size: number;
  orientation: 'horizontal' | 'vertical';
};

function isSimPlaced(ship: SimShip): ship is SimShip & { row: number; col: number } {
  return ship.row !== null && ship.col !== null;
}

function buildOccupiedMapForSim(ships: SimShip[]): Map<string, string> {
  const occupied = new Map<string, string>();
  for (const ship of ships) {
    if (!isSimPlaced(ship)) {
      continue;
    }
    for (let i = 0; i < ship.size; i += 1) {
      const row = ship.row + (ship.orientation === 'vertical' ? i : 0);
      const col = ship.col + (ship.orientation === 'horizontal' ? i : 0);
      occupied.set(`${row}-${col}`, ship.id);
    }
  }
  return occupied;
}

function canPlaceSimShip(
  ship: SimShip,
  startRow: number,
  startCol: number,
  occupied: Map<string, string>,
  boardSize: number,
): boolean {
  const targetCells: Array<{ row: number; col: number }> = [];

  for (let i = 0; i < ship.size; i += 1) {
    const row = startRow + (ship.orientation === 'vertical' ? i : 0);
    const col = startCol + (ship.orientation === 'horizontal' ? i : 0);

    if (row >= boardSize || col >= boardSize) {
      return false;
    }

    const key = `${row}-${col}`;
    if (occupied.has(key) && occupied.get(key) !== ship.id) {
      return false;
    }

    targetCells.push({ row, col });
  }

  for (const cell of targetCells) {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const nearRow = cell.row + dr;
        const nearCol = cell.col + dc;
        if (nearRow < 0 || nearCol < 0 || nearRow >= boardSize || nearCol >= boardSize) {
          continue;
        }

        const nearKey = `${nearRow}-${nearCol}`;
        const owner = occupied.get(nearKey);
        if (owner && owner !== ship.id) {
          return false;
        }
      }
    }
  }

  return true;
}

function makeSimShipPool(shipGroups: ShipGroup[]): SimShip[] {
  const pool: SimShip[] = [];
  let index = 1;
  for (const group of shipGroups) {
    for (let i = 0; i < group.count; i += 1) {
      pool.push({
        id: `sim-${index}`,
        size: group.size,
        orientation: 'horizontal',
        row: null,
        col: null,
      });
      index += 1;
    }
  }
  return pool;
}

function tryAutoPlaceFleet(shipGroups: ShipGroup[], boardSize: number): boolean {
  const shipPool = makeSimShipPool(shipGroups);
  for (let retry = 0; retry < 30; retry += 1) {
    const newShips: SimShip[] = shipPool.map((s) => ({ ...s, row: null, col: null, orientation: 'horizontal' }));
    let failed = false;

    for (let i = 0; i < newShips.length; i += 1) {
      let placed = false;

      for (let attempt = 0; attempt < 400; attempt += 1) {
        const orientation: 'horizontal' | 'vertical' = Math.random() < 0.5 ? 'horizontal' : 'vertical';
        const maxRow = orientation === 'vertical' ? boardSize - newShips[i].size : boardSize - 1;
        const maxCol = orientation === 'horizontal' ? boardSize - newShips[i].size : boardSize - 1;
        if (maxRow < 0 || maxCol < 0) {
          continue;
        }

        const row = Math.floor(Math.random() * (maxRow + 1));
        const col = Math.floor(Math.random() * (maxCol + 1));
        const candidate: SimShip = { ...newShips[i], orientation, row, col };
        const occupied = buildOccupiedMapForSim(newShips);
        if (canPlaceSimShip(candidate, row, col, occupied, boardSize)) {
          newShips[i] = candidate;
          placed = true;
          break;
        }
      }

      if (!placed) {
        failed = true;
        break;
      }
    }

    if (!failed) {
      return true;
    }
  }

  return false;
}

function canLikelyAutoPlaceFleet(shipGroups: ShipGroup[], boardSize: number): boolean {
  for (let i = 0; i < FLEET_FEASIBILITY_CHECKS; i += 1) {
    if (tryAutoPlaceFleet(shipGroups, boardSize)) {
      return true;
    }
  }
  return false;
}


const rowWords = [
  'czapeczka',
  'szczepienie',
  'sztuczka',
  'zeglarz',
  'zuczek',
  'deszcz',
  'plazowicz',
  'przyczepa',
];

const colWords = [
  'zaroweczka',
  'rzeczka',
  'szczypiorek',
  'pieprzniczka',
  'pszczolka',
  'pozyczka',
  'czaszka',
  'paszcza',
];

const defaultRows: CoordinateWord[] = [
  { id: 'czapeczka', label: 'czapeczka', icon: 'HardHat' },
  { id: 'szczepienie', label: 'szczepienie', icon: 'Syringe' },
  { id: 'sztuczka', label: 'sztuczka', icon: 'WandSparkles' },
  { id: 'zeglarz', label: 'zeglarz', icon: 'Ship' },
  { id: 'zuczek', label: 'zuczek', icon: 'Bug' },
  { id: 'deszcz', label: 'deszcz', icon: 'CloudRain' },
  { id: 'plazowicz', label: 'plazowicz', icon: 'Sun' },
  { id: 'przyczepa', label: 'przyczepa', icon: 'Caravan' },
];

const defaultColumns: CoordinateWord[] = [
  { id: 'zaroweczka', label: 'zaroweczka', icon: 'Lightbulb' },
  { id: 'rzeczka', label: 'rzeczka', icon: 'Waves' },
  { id: 'szczypiorek', label: 'szczypiorek', icon: 'Leaf' },
  { id: 'pieprzniczka', label: 'pieprzniczka', icon: 'Cherry' },
  { id: 'pszczolka', label: 'pszczolka', icon: 'Flower2' },
  { id: 'pozyczka', label: 'pozyczka', icon: 'Coins' },
  { id: 'czaszka', label: 'czaszka', icon: 'Skull' },
  { id: 'paszcza', label: 'paszcza', icon: 'Smile' },
];

const defaultShips: ShipGroup[] = [
  { size: 4, count: 1 },
  { size: 3, count: 2 },
  { size: 2, count: 3 },
  { size: 1, count: 4 },
];

const DEFAULT_SETTINGS: GameSettings = {
  boardSize: 8,
  rows: defaultRows,
  columns: defaultColumns,
  ships: defaultShips,
};

const rooms = new Map<string, Room>();

function randomFrom(words: string[]): string {
  return words[Math.floor(Math.random() * words.length)];
}

function createReadableRoomId(): string {
  const stamp = Math.floor(Date.now() / 1000).toString(36);
  return `${ROOM_PREFIX}-${randomFrom(rowWords)}-${randomFrom(colWords)}-${stamp}`;
}

function sanitizePlayerName(name?: string): string {
  const trimmed = (name || 'Gracz').trim();
  if (!trimmed) {
    return 'Gracz';
  }
  return trimmed.slice(0, 24);
}

function sanitizeCoordinateWords(list: unknown): CoordinateWord[] {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const id = String((item as { id?: unknown }).id ?? `word-${index + 1}`).trim();
      const label = String((item as { label?: unknown }).label ?? id).trim();
      const icon = String((item as { icon?: unknown }).icon ?? 'Square').trim();
      if (!id || !label) {
        return null;
      }
      return { id, label, icon };
    })
    .filter((item): item is CoordinateWord => item !== null);
}

function dedupeCoordinateWordsById(list: CoordinateWord[]): CoordinateWord[] {
  const seen = new Set<string>();
  const unique: CoordinateWord[] = [];
  for (const item of list) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function sanitizeShipGroups(groups: unknown, boardSize: number): ShipGroup[] {
  if (!Array.isArray(groups)) {
    return [];
  }

  // Basic sanitization and filtering
  const validated: ShipGroup[] = groups
    .map((group) => ({
      size: Number((group as { size?: unknown })?.size),
      count: Number((group as { count?: unknown })?.count),
    }))
    .filter(
      (group) =>
        Number.isInteger(group.size) &&
        Number.isInteger(group.count) &&
        group.size > 0 &&
        group.count > 0 &&
        group.size <= boardSize,
    );

  if (validated.length === 0) return [];

  // Fleet-aware clipping: reduce largest ships first until total fits the budget
  const budget = fleetBudget(boardSize);
  const clipped = validated.map((s) => ({ ...s }));
  if (fleetCost(clipped) > budget) {
    let excess = fleetCost(clipped) - budget;
    const order = clipped.map((_, i) => i).sort((a, b) => clipped[b].size - clipped[a].size);
    for (const idx of order) {
      if (excess <= 0) break;
      const costPerShip = clipped[idx].size + 1;
      const canReduce = clipped[idx].count - 1;
      const reduceBy = Math.min(canReduce, Math.ceil(excess / costPerShip));
      if (reduceBy > 0) {
        clipped[idx].count -= reduceBy;
        excess -= reduceBy * costPerShip;
      }
    }
  }

  // Cicha walidacja wykonalności przez losowe układanie.
  // Jeżeli losowo nie da się rozmieścić floty, odejmujemy po 1 od największych statków.
  let guard = 200;
  while (guard > 0 && !canLikelyAutoPlaceFleet(clipped, boardSize)) {
    const reducibleIndex = clipped
      .map((group, index) => ({ ...group, index }))
      .filter((group) => group.count > 1)
      .sort((a, b) => (b.size - a.size) || (b.count - a.count))[0]?.index;

    if (reducibleIndex === undefined) {
      break;
    }

    clipped[reducibleIndex] = {
      ...clipped[reducibleIndex],
      count: clipped[reducibleIndex].count - 1,
    };
    guard -= 1;
  }

  return clipped.filter((group) => group.count > 0);
}

function sanitizeSettings(input: unknown): GameSettings {
  const source = input && typeof input === 'object' ? (input as Partial<GameSettings>) : {};
  const sourceRows = dedupeCoordinateWordsById(sanitizeCoordinateWords(source.rows));
  const sourceColumns = dedupeCoordinateWordsById(sanitizeCoordinateWords(source.columns));

  let fallbackRowsRaw = sourceRows.length > 0 ? sourceRows : DEFAULT_SETTINGS.rows;
  let fallbackColumnsRaw = sourceColumns.length > 0 ? sourceColumns : DEFAULT_SETTINGS.columns;
  let fallbackRows = dedupeCoordinateWordsById(fallbackRowsRaw);
  let rowIds = new Set(fallbackRows.map((item) => item.id));
  let fallbackColumns = dedupeCoordinateWordsById(fallbackColumnsRaw).filter((item) => !rowIds.has(item.id));
  let maxBoardSize = Math.min(fallbackRows.length, fallbackColumns.length);

  if (maxBoardSize < MIN_BOARD_SIZE) {
    fallbackRowsRaw = DEFAULT_SETTINGS.rows;
    fallbackColumnsRaw = DEFAULT_SETTINGS.columns;
    fallbackRows = dedupeCoordinateWordsById(fallbackRowsRaw);
    rowIds = new Set(fallbackRows.map((item) => item.id));
    fallbackColumns = dedupeCoordinateWordsById(fallbackColumnsRaw).filter((item) => !rowIds.has(item.id));
    maxBoardSize = Math.min(fallbackRows.length, fallbackColumns.length);
  }

  const requestedBoardSize = Number(source.boardSize);
  const boardSize = Number.isInteger(requestedBoardSize)
    ? Math.max(MIN_BOARD_SIZE, Math.min(maxBoardSize, requestedBoardSize))
    : DEFAULT_SETTINGS.boardSize;

  const ships = sanitizeShipGroups(source.ships, boardSize);

  return {
    boardSize,
    rows: fallbackRows.slice(0, boardSize),
    columns: fallbackColumns.slice(0, boardSize),
    ships: ships.length > 0 ? ships : DEFAULT_SETTINGS.ships,
  };
}

function validateSubmittedShips(ships: unknown, settings: GameSettings): ships is ShipData[] {
  if (!Array.isArray(ships) || ships.length === 0) {
    return false;
  }

  const expectedBySize = new Map<number, number>();
  settings.ships.forEach((group) => {
    expectedBySize.set(group.size, (expectedBySize.get(group.size) ?? 0) + group.count);
  });

  const actualBySize = new Map<number, number>();
  const occupied = new Map<string, string>();

  for (let shipIndex = 0; shipIndex < ships.length; shipIndex += 1) {
    const ship = ships[shipIndex] as Partial<ShipData>;
    const size = Number(ship.size);
    const row = Number(ship.row);
    const col = Number(ship.col);
    const orientation = ship.orientation;
    if (!Number.isInteger(size) || !Number.isInteger(row) || !Number.isInteger(col)) {
      return false;
    }
    if (orientation !== 'horizontal' && orientation !== 'vertical') {
      return false;
    }
    if (!expectedBySize.has(size)) {
      return false;
    }

    actualBySize.set(size, (actualBySize.get(size) ?? 0) + 1);
    const cells = getShipCells({ id: String(ship.id ?? `ship-${shipIndex + 1}`), size, row, col, orientation });

    for (const cell of cells) {
      if (cell.row < 0 || cell.col < 0 || cell.row >= settings.boardSize || cell.col >= settings.boardSize) {
        return false;
      }
      const key = `${cell.row}-${cell.col}`;
      if (occupied.has(key)) {
        return false;
      }
    }

    const shipKey = `ship-${shipIndex + 1}`;
    for (const cell of cells) {
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const nearRow = cell.row + dr;
          const nearCol = cell.col + dc;
          if (nearRow < 0 || nearCol < 0 || nearRow >= settings.boardSize || nearCol >= settings.boardSize) {
            continue;
          }
          const nearKey = `${nearRow}-${nearCol}`;
          const owner = occupied.get(nearKey);
          if (owner && owner !== shipKey) {
            return false;
          }
        }
      }
    }

    cells.forEach((cell) => {
      occupied.set(`${cell.row}-${cell.col}`, shipKey);
    });
  }

  if (ships.length !== settings.ships.reduce((sum, group) => sum + group.count, 0)) {
    return false;
  }

  for (const [size, expectedCount] of expectedBySize.entries()) {
    if ((actualBySize.get(size) ?? 0) !== expectedCount) {
      return false;
    }
  }

  return true;
}

function getShipCells(ship: ShipData): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let i = 0; i < ship.size; i++) {
    cells.push({
      row: ship.row + (ship.orientation === 'vertical' ? i : 0),
      col: ship.col + (ship.orientation === 'horizontal' ? i : 0),
    });
  }
  return cells;
}

function allOpponentShipsSunk(shooterId: string, opponentId: string, room: Room): boolean {
  const opponentBoard = room.boardByPlayerId[opponentId];
  if (!opponentBoard || opponentBoard.length === 0) return false;
  const shooterHits = room.shots.filter(
    (s) => s.shooterId === shooterId && (s.result === 'hit' || s.result === 'sunk'),
  );
  return opponentBoard.every((ship) =>
    getShipCells(ship).every((cell) =>
      shooterHits.some((s) => s.row === cell.row && s.col === cell.col),
    ),
  );
}

function getPublicGameState(room: Room) {
  return {
    phase: room.gamePhase,
    currentTurnPlayerId: room.currentTurnPlayerId,
    winnerPlayerId: room.winnerPlayerId,
    finishReason: room.finishReason,
    surrenderedPlayerId: room.surrenderedPlayerId,
    shots: room.shots,
    ...(room.gamePhase === 'finished' ? { boardByPlayerId: room.boardByPlayerId } : {}),
  };
}

function getPublicRoomState(room: Room) {
  const connectedPlayers = room.players.filter((player) => player.connected);
  return {
    roomId: room.id,
    settings: room.settings,
    players: room.players.map((player) => ({
      ...player,
      ready: Boolean(room.readyByPlayerId[player.id]),
    })),
    isReady: connectedPlayers.length === 2,
    allPlayersReady:
      connectedPlayers.length === 2 && connectedPlayers.every((player) => Boolean(room.readyByPlayerId[player.id])),
    game: getPublicGameState(room),
  };
}

function clearDisconnectTimer(room: Room, playerId: string) {
  const timer = room.disconnectTimersByPlayerId[playerId];
  if (!timer) return;
  clearTimeout(timer);
  room.disconnectTimersByPlayerId[playerId] = null;
}

const app = express();
app.use(
  cors({
    origin: CLIENT_URL === '*' ? true : CLIENT_URL,
    credentials: true,
  }),
);

app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    uptime: process.uptime(),
  });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL === '*' ? true : CLIENT_URL,
    credentials: true,
  },
});

io.on('connection', (socket) => {
  socket.on('room:create', (payload: { playerName?: string; settings?: unknown }, callback?: (response: unknown) => void) => {
    const roomId = createReadableRoomId();
    const settings = sanitizeSettings(payload?.settings);

    const room: Room = {
      id: roomId,
      settings,
      players: [
        {
          id: socket.id,
          name: sanitizePlayerName(payload?.playerName || 'Kapitan'),
          role: 'host',
          connected: true,
          lastSeenAt: Date.now(),
        },
      ],
      readyByPlayerId: {
        [socket.id]: false,
      },
      boardByPlayerId: {},
      disconnectTimersByPlayerId: {
        [socket.id]: null,
      },
      shots: [],
      currentTurnPlayerId: null,
      gamePhase: 'waiting',
      winnerPlayerId: null,
      finishReason: null,
      surrenderedPlayerId: null,
      createdAt: Date.now(),
    };

    rooms.set(roomId, room);
    socket.join(roomId);

    callback?.({ ok: true, room: getPublicRoomState(room) });
  });

  socket.on(
    'room:join',
    (payload: { roomId?: string; playerName?: string }, callback?: (response: unknown) => void) => {
      const roomId = payload?.roomId?.trim();
      const sanitizedPlayerName = sanitizePlayerName(payload?.playerName || 'Nawigator');
      if (!roomId) {
        callback?.({ ok: false, error: 'Brak kodu pokoju.' });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        callback?.({ ok: false, error: 'Pokoj nie istnieje.' });
        return;
      }

      const alreadyInRoom = room.players.some((player) => player.id === socket.id);
      const reconnectCandidate = room.players.find(
        (player) => !player.connected && player.name === sanitizedPlayerName,
      );

      if (!alreadyInRoom && !reconnectCandidate && room.players.length >= 2) {
        callback?.({ ok: false, error: 'Pokoj jest pelny.' });
        return;
      }

      if (reconnectCandidate) {
        const previousPlayerId = reconnectCandidate.id;
        clearDisconnectTimer(room, previousPlayerId);

        reconnectCandidate.id = socket.id;
        reconnectCandidate.connected = true;
        reconnectCandidate.lastSeenAt = Date.now();

        room.readyByPlayerId[socket.id] = room.readyByPlayerId[previousPlayerId] ?? false;
        room.boardByPlayerId[socket.id] = room.boardByPlayerId[previousPlayerId] ?? [];
        room.disconnectTimersByPlayerId[socket.id] = null;

        delete room.readyByPlayerId[previousPlayerId];
        delete room.boardByPlayerId[previousPlayerId];
        delete room.disconnectTimersByPlayerId[previousPlayerId];

        if (room.currentTurnPlayerId === previousPlayerId) {
          room.currentTurnPlayerId = socket.id;
        }
        if (room.winnerPlayerId === previousPlayerId) {
          room.winnerPlayerId = socket.id;
        }
        if (room.surrenderedPlayerId === previousPlayerId) {
          room.surrenderedPlayerId = socket.id;
        }

        room.shots = room.shots.map((shot) =>
          shot.shooterId === previousPlayerId
            ? {
                ...shot,
                shooterId: socket.id,
              }
            : shot,
        );
      } else if (!alreadyInRoom) {
        room.players.push({
          id: socket.id,
          name: sanitizedPlayerName,
          role: 'guest',
          connected: true,
          lastSeenAt: Date.now(),
        });
        room.readyByPlayerId[socket.id] = false;
        room.boardByPlayerId[socket.id] = room.boardByPlayerId[socket.id] ?? [];
        room.disconnectTimersByPlayerId[socket.id] = null;
      } else {
        const currentPlayer = room.players.find((player) => player.id === socket.id);
        if (currentPlayer) {
          currentPlayer.connected = true;
          currentPlayer.lastSeenAt = Date.now();
          clearDisconnectTimer(room, socket.id);
        }
      }

      socket.join(roomId);

      const publicState = getPublicRoomState(room);
      io.to(roomId).emit('room:state', publicState);
      callback?.({ ok: true, room: publicState });
    },
  );

  socket.on('room:getState', (payload: { roomId?: string }, callback?: (response: unknown) => void) => {
    const roomId = payload?.roomId?.trim();
    if (!roomId) {
      callback?.({ ok: false, error: 'Brak kodu pokoju.' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      callback?.({ ok: false, error: 'Pokoj nie istnieje.' });
      return;
    }

    callback?.({ ok: true, room: getPublicRoomState(room) });
  });

  socket.on(
    'room:setReady',
    (payload: { roomId?: string; ready?: boolean; ships?: ShipData[] }, callback?: (response: unknown) => void) => {
      const roomId = payload?.roomId?.trim();
      if (!roomId) {
        callback?.({ ok: false, error: 'Brak kodu pokoju.' });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        callback?.({ ok: false, error: 'Pokoj nie istnieje.' });
        return;
      }

      const playerInRoom = room.players.some((player) => player.id === socket.id);
      if (!playerInRoom) {
        callback?.({ ok: false, error: 'Gracz nie nalezy do tego pokoju.' });
        return;
      }

      // Store board when becoming ready
      if (payload?.ready && Array.isArray(payload.ships) && payload.ships.length > 0) {
        if (!validateSubmittedShips(payload.ships, room.settings)) {
          callback?.({ ok: false, error: 'Nieprawidlowe ustawienie floty dla aktualnych ustawien gry.' });
          return;
        }
        room.boardByPlayerId[socket.id] = payload.ships;
      }

      room.readyByPlayerId[socket.id] = Boolean(payload?.ready);

      // Start game if both ready and both have boards submitted
      const connectedPlayers = room.players.filter((p) => p.connected);
      const allReady = connectedPlayers.length === 2 && connectedPlayers.every((p) => room.readyByPlayerId[p.id]);
      const allHaveBoards = connectedPlayers.every(
        (p) => Array.isArray(room.boardByPlayerId[p.id]) && room.boardByPlayerId[p.id].length > 0,
      );

      if (allReady && allHaveBoards && room.gamePhase === 'waiting') {
        room.gamePhase = 'playing';
        room.currentTurnPlayerId = room.players.find((p) => p.role === 'host')?.id ?? room.players[0].id;
        room.winnerPlayerId = null;
        room.finishReason = null;
        room.surrenderedPlayerId = null;
        const publicState = getPublicRoomState(room);
        io.to(roomId).emit('game:started', publicState);
        callback?.({ ok: true, room: publicState });
        return;
      }

      const publicState = getPublicRoomState(room);
      io.to(roomId).emit('room:state', publicState);
      callback?.({ ok: true, room: publicState });
    },
  );

  socket.on(
    'game:rematch',
    (payload: { roomId?: string }, callback?: (response: unknown) => void) => {
      const roomId = payload?.roomId?.trim();
      if (!roomId) { callback?.({ ok: false, error: 'Brak kodu pokoju.' }); return; }

      const room = rooms.get(roomId);
      if (!room) { callback?.({ ok: false, error: 'Pokoj nie istnieje.' }); return; }
      if (room.gamePhase !== 'finished') { callback?.({ ok: false, error: 'Gra nie jest zakonczona.' }); return; }

      const playerInRoom = room.players.some((p) => p.id === socket.id);
      if (!playerInRoom) { callback?.({ ok: false, error: 'Gracz nie nalezy do tego pokoju.' }); return; }

      // Reset game state, keep players
      room.readyByPlayerId = Object.fromEntries(room.players.map((p) => [p.id, false]));
      room.boardByPlayerId = {};
      room.shots = [];
      room.currentTurnPlayerId = null;
      room.gamePhase = 'waiting';
      room.winnerPlayerId = null;
      room.finishReason = null;
      room.surrenderedPlayerId = null;

      const publicState = getPublicRoomState(room);
      io.to(roomId).emit('room:state', publicState);
      callback?.({ ok: true, room: publicState });
    },
  );

  socket.on(
    'game:surrender',
    (payload: { roomId?: string }, callback?: (response: unknown) => void) => {
      const roomId = payload?.roomId?.trim();
      if (!roomId) { callback?.({ ok: false, error: 'Brak kodu pokoju.' }); return; }

      const room = rooms.get(roomId);
      if (!room) { callback?.({ ok: false, error: 'Pokoj nie istnieje.' }); return; }
      if (room.gamePhase !== 'playing') { callback?.({ ok: false, error: 'Gra nie jest w toku.' }); return; }

      const playerInRoom = room.players.some((p) => p.id === socket.id);
      if (!playerInRoom) { callback?.({ ok: false, error: 'Gracz nie nalezy do tego pokoju.' }); return; }

      const opponent = room.players.find((p) => p.id !== socket.id);
      if (!opponent) { callback?.({ ok: false, error: 'Brak przeciwnika.' }); return; }

      room.gamePhase = 'finished';
      room.winnerPlayerId = opponent.id;
      room.currentTurnPlayerId = null;
      room.finishReason = 'surrender';
      room.surrenderedPlayerId = socket.id;

      const publicState = getPublicRoomState(room);
      io.to(roomId).emit('game:state', publicState);
      callback?.({ ok: true, room: publicState });
    },
  );

  socket.on(
    'game:shoot',
    (payload: { roomId?: string; row?: number; col?: number }, callback?: (response: unknown) => void) => {
      const roomId = payload?.roomId?.trim();
      if (!roomId) { callback?.({ ok: false, error: 'Brak kodu pokoju.' }); return; }

      const room = rooms.get(roomId);
      if (!room) { callback?.({ ok: false, error: 'Pokoj nie istnieje.' }); return; }
      if (room.gamePhase !== 'playing') { callback?.({ ok: false, error: 'Gra nie jest w toku.' }); return; }
      if (room.currentTurnPlayerId !== socket.id) { callback?.({ ok: false, error: 'To nie twoja tura.' }); return; }

      const row = Number(payload?.row);
      const col = Number(payload?.col);
      if (
        !Number.isFinite(row) ||
        !Number.isFinite(col) ||
        row < 0 ||
        col < 0 ||
        row >= room.settings.boardSize ||
        col >= room.settings.boardSize
      ) {
        callback?.({ ok: false, error: 'Nieprawidlowe koordynaty.' }); return;
      }

      const opponent = room.players.find((p) => p.id !== socket.id);
      if (!opponent) { callback?.({ ok: false, error: 'Brak przeciwnika.' }); return; }

      const opponentBoard = room.boardByPlayerId[opponent.id];
      if (!opponentBoard || opponentBoard.length === 0) { callback?.({ ok: false, error: 'Brak planszy przeciwnika.' }); return; }

      const alreadyShot = room.shots.some((s) => s.shooterId === socket.id && s.row === row && s.col === col);
      if (alreadyShot) { callback?.({ ok: false, error: 'Tu juz strzelales.' }); return; }

      let result: ShotRecord['result'] = 'miss';
      let sunkShipCells: Array<{ row: number; col: number }> | undefined;

      for (const ship of opponentBoard) {
        const shipCells = getShipCells(ship);
        if (!shipCells.some((c) => c.row === row && c.col === col)) continue;

        const prevHitsOnThisShip = room.shots.filter(
          (s) =>
            s.shooterId === socket.id &&
            (s.result === 'hit' || s.result === 'sunk') &&
            shipCells.some((c) => c.row === s.row && c.col === s.col),
        );

        if (prevHitsOnThisShip.length + 1 >= shipCells.length) {
          result = 'sunk';
          sunkShipCells = shipCells;
        } else {
          result = 'hit';
        }
        break;
      }

      const shot: ShotRecord = { shooterId: socket.id, row, col, result, sunkShipCells };
      room.shots.push(shot);

      // Check win condition
      if (allOpponentShipsSunk(socket.id, opponent.id, room)) {
        room.gamePhase = 'finished';
        room.winnerPlayerId = socket.id;
        room.currentTurnPlayerId = null;
        room.finishReason = 'allShipsSunk';
        room.surrenderedPlayerId = null;
        const publicState = getPublicRoomState(room);
        io.to(roomId).emit('game:state', publicState);
        callback?.({ ok: true, room: publicState });
        return;
      }

      // Pass turn on miss; shooter keeps turn on hit/sunk
      if (result === 'miss') {
        room.currentTurnPlayerId = opponent.id;
      }

      const publicState = getPublicRoomState(room);
      io.to(roomId).emit('game:state', publicState);
      callback?.({ ok: true, room: publicState });
    },
  );

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const player = room.players.find((roomPlayer) => roomPlayer.id === socket.id);
      if (!player) {
        continue;
      }

      player.connected = false;
      player.lastSeenAt = Date.now();

      clearDisconnectTimer(room, socket.id);
      room.disconnectTimersByPlayerId[socket.id] = setTimeout(() => {
        const stillDisconnected = room.players.some(
          (roomPlayer) => roomPlayer.id === socket.id && !roomPlayer.connected,
        );
        if (!stillDisconnected) {
          return;
        }

        room.players = room.players.filter((roomPlayer) => roomPlayer.id !== socket.id);
        delete room.readyByPlayerId[socket.id];
        delete room.boardByPlayerId[socket.id];
        delete room.disconnectTimersByPlayerId[socket.id];

        if (room.players.length === 0) {
          rooms.delete(room.id);
          return;
        }

        // Forfeit if game was in progress and player did not reconnect in time
        if (room.gamePhase === 'playing') {
          room.gamePhase = 'finished';
          room.winnerPlayerId = room.players[0].id;
          room.currentTurnPlayerId = null;
          room.finishReason = 'disconnect';
          room.surrenderedPlayerId = socket.id;
        }

        io.to(room.id).emit('room:state', getPublicRoomState(room));
      }, DISCONNECT_GRACE_MS);

      io.to(room.id).emit('room:state', getPublicRoomState(room));
    }
  });

});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Socket server listening on http://localhost:${PORT}`);
});
