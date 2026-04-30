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
};

type ShipData = {
  id: string;
  row: number;
  col: number;
  size: number;
  orientation: 'horizontal' | 'vertical';
};

type ShotRecord = {
  shooterId: string;
  row: number;
  col: number;
  result: 'hit' | 'miss' | 'sunk';
  sunkShipCells?: Array<{ row: number; col: number }>;
};

type GamePhase = 'waiting' | 'playing' | 'finished';

type Room = {
  id: string;
  players: Player[];
  readyByPlayerId: Record<string, boolean>;
  boardByPlayerId: Record<string, ShipData[]>;
  shots: ShotRecord[];
  currentTurnPlayerId: string | null;
  gamePhase: GamePhase;
  winnerPlayerId: string | null;
  createdAt: number;
};

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
    shots: room.shots,
    ...(room.gamePhase === 'finished' ? { boardByPlayerId: room.boardByPlayerId } : {}),
  };
}

function getPublicRoomState(room: Room) {
  return {
    roomId: room.id,
    players: room.players.map((player) => ({
      ...player,
      ready: Boolean(room.readyByPlayerId[player.id]),
    })),
    isReady: room.players.length === 2,
    allPlayersReady: room.players.length === 2 && room.players.every((player) => Boolean(room.readyByPlayerId[player.id])),
    game: getPublicGameState(room),
  };
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
  socket.on('room:create', (payload: { playerName?: string }, callback?: (response: unknown) => void) => {
    const roomId = createReadableRoomId();

    const room: Room = {
      id: roomId,
      players: [
        {
          id: socket.id,
          name: sanitizePlayerName(payload?.playerName || 'Kapitan'),
          role: 'host',
        },
      ],
      readyByPlayerId: {
        [socket.id]: false,
      },
      boardByPlayerId: {},
      shots: [],
      currentTurnPlayerId: null,
      gamePhase: 'waiting',
      winnerPlayerId: null,
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
      if (!alreadyInRoom && room.players.length >= 2) {
        callback?.({ ok: false, error: 'Pokoj jest pelny.' });
        return;
      }

      if (!alreadyInRoom) {
        room.players.push({
          id: socket.id,
          name: sanitizePlayerName(payload?.playerName || 'Nawigator'),
          role: 'guest',
        });
        room.readyByPlayerId[socket.id] = false;
        room.boardByPlayerId[socket.id] = room.boardByPlayerId[socket.id] ?? [];
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

      room.readyByPlayerId[socket.id] = Boolean(payload?.ready);

      // Store board when becoming ready
      if (payload?.ready && Array.isArray(payload.ships) && payload.ships.length > 0) {
        room.boardByPlayerId[socket.id] = payload.ships;
      }

      // Start game if both ready and both have boards submitted
      const allReady = room.players.length === 2 && room.players.every((p) => room.readyByPlayerId[p.id]);
      const allHaveBoards = room.players.every(
        (p) => Array.isArray(room.boardByPlayerId[p.id]) && room.boardByPlayerId[p.id].length > 0,
      );

      if (allReady && allHaveBoards && room.gamePhase === 'waiting') {
        room.gamePhase = 'playing';
        room.currentTurnPlayerId = room.players.find((p) => p.role === 'host')?.id ?? room.players[0].id;
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
      if (!Number.isFinite(row) || !Number.isFinite(col) || row < 0 || col < 0) {
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
      const playersBefore = room.players.length;
      room.players = room.players.filter((player) => player.id !== socket.id);

      if (room.players.length !== playersBefore) {
        delete room.readyByPlayerId[socket.id];
        delete room.boardByPlayerId[socket.id];
        if (room.players.length === 0) {
          rooms.delete(room.id);
        } else {
          // Forfeit if game was in progress
          if (room.gamePhase === 'playing') {
            room.gamePhase = 'finished';
            room.winnerPlayerId = room.players[0].id;
            room.currentTurnPlayerId = null;
          }
          io.to(room.id).emit('room:state', getPublicRoomState(room));
        }
      }
    }
  });
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Socket server listening on http://localhost:${PORT}`);
});
