import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Inline storage for Edge Runtime — more persistent than Node.js serverless
interface DebateMessage {
  side: "for" | "against";
  content: string;
  round: number;
}

interface Room {
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

// Global Map persists across invocations in Edge Runtime isolates
const rooms = new Map<string, Room>();

function createRoom(topic: string): Room {
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

function getRoom(id: string): Room | undefined {
  return rooms.get(id.toUpperCase());
}

export async function POST(req: NextRequest) {
  const { action, roomId, ...data } = await req.json();

  if (action === "create") {
    const room = createRoom(data.topic);
    return NextResponse.json(room);
  }

  if (action === "get") {
    const room = getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json(room);
  }

  if (action === "message") {
    const room = getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    room.messages.push(data.message);
    room.currentRound = data.currentRound ?? room.currentRound;
    room.activeSide = data.activeSide ?? room.activeSide;
    return NextResponse.json({ ok: true });
  }

  if (action === "status") {
    const room = getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    room.status = data.status;
    room.activeSide = data.activeSide ?? null;
    return NextResponse.json({ ok: true });
  }

  if (action === "vote") {
    const room = getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    const voterId = data.voterId;
    if (room.voterIds.includes(voterId)) {
      return NextResponse.json({ error: "Already voted" }, { status: 400 });
    }
    room.voterIds.push(voterId);
    room.votes[data.side as "for" | "against"]++;
    return NextResponse.json({ votes: room.votes });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("id");
  if (!roomId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const room = getRoom(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json(room);
}
