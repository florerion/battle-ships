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

type Room = {
  id: string;
  players: Player[];
  readyByPlayerId: Record<string, boolean>;
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

function getPublicRoomState(room: Room) {
  return {
    roomId: room.id,
    players: room.players.map((player) => ({
      ...player,
      ready: Boolean(room.readyByPlayerId[player.id]),
    })),
    isReady: room.players.length === 2,
    allPlayersReady: room.players.length === 2 && room.players.every((player) => Boolean(room.readyByPlayerId[player.id])),
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
    (payload: { roomId?: string; ready?: boolean }, callback?: (response: unknown) => void) => {
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

      const publicState = getPublicRoomState(room);
      io.to(roomId).emit('room:state', publicState);
      callback?.({ ok: true, room: publicState });
    },
  );

  socket.on('disconnect', () => {
    for (const room of rooms.values()) {
      const playersBefore = room.players.length;
      room.players = room.players.filter((player) => player.id !== socket.id);

      if (room.players.length !== playersBefore) {
        delete room.readyByPlayerId[socket.id];
        if (room.players.length === 0) {
          rooms.delete(room.id);
        } else {
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
