export interface DebateMessage {
  side: "for" | "against";
  content: string;
  round: number;
}

export interface Room {
  id: string;
  topic: string;
  messages: DebateMessage[];
  status: "debating" | "voting" | "results";
  votes: { for: number; against: number };
  voterIds: string[];
  currentRound: number;
  activeSide: "for" | "against" | null;
  createdAt: number;
}

// Global in-memory store — persists across warm serverless invocations
const globalForRooms = globalThis as typeof globalThis & {
  rooms?: Map<string, Room>;
};

if (!globalForRooms.rooms) {
  globalForRooms.rooms = new Map<string, Room>();
}

export const rooms = globalForRooms.rooms;

export function createRoom(topic: string): Room {
  const id = Math.random().toString(36).substring(2, 8).toUpperCase();
  const room: Room = {
    id,
    topic,
    messages: [],
    status: "debating",
    votes: { for: 0, against: 0 },
    voterIds: [],
    currentRound: 1,
    activeSide: null,
    createdAt: Date.now(),
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id.toUpperCase());
}
