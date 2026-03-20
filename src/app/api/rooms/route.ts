import { NextRequest, NextResponse } from "next/server";
import { createRoom, getRoom } from "@/lib/rooms";

// POST - create room | GET - fetch room by ?id=
export async function POST(req: NextRequest) {
  const { action, roomId, ...data } = await req.json();

  // CREATE ROOM
  if (action === "create") {
    const room = createRoom(data.topic);
    return NextResponse.json(room);
  }

  // GET ROOM STATE
  if (action === "get") {
    const room = getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    return NextResponse.json(room);
  }

  // ADD MESSAGE
  if (action === "message") {
    const room = getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    room.messages.push(data.message);
    room.currentRound = data.currentRound ?? room.currentRound;
    room.activeSide = data.activeSide ?? room.activeSide;
    return NextResponse.json({ ok: true });
  }

  // UPDATE STATUS
  if (action === "status") {
    const room = getRoom(roomId);
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    room.status = data.status;
    room.activeSide = data.activeSide ?? null;
    return NextResponse.json({ ok: true });
  }

  // VOTE
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

// GET route for polling
export async function GET(req: NextRequest) {
  const roomId = req.nextUrl.searchParams.get("id");
  if (!roomId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const room = getRoom(roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json(room);
}
