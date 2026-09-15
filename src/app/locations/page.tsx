"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { locationCode, type LocationRoom } from "@/lib/locations";

const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-800";
const panel = "space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700";
const button = "rounded-lg bg-teal-700 px-4 py-3 text-white disabled:opacity-40 dark:bg-teal-300 dark:text-slate-950";

export default function LocationsPage() {
  const [rooms, setRooms] = useState<LocationRoom[]>([]);
  const [roomId, setRoomId] = useState("");
  const [cabinetId, setCabinetId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [cabinetNumber, setCabinetNumber] = useState("1");
  const [shelfNumber, setShelfNumber] = useState("1");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const room = rooms.find((r) => String(r.id) === roomId);
  const cabinet = room?.cabinets.find((c) => String(c.id) === cabinetId);

  async function load() {
    const res = await fetch("/api/locations", { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load locations. Reload to try again.");
    setRooms(await res.json());
  }
  useEffect(() => { load().catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);

  async function save(type: "room" | "cabinet" | "shelf") {
    setBusy(true); setError(""); setMessage("");
    try {
      const res = await fetch("/api/locations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(type === "room" ? { type, name, code } : {
          type, parentId: type === "cabinet" ? roomId : cabinetId,
          number: type === "cabinet" ? cabinetNumber : shelfNumber,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save location.");
      await load();
      if (type === "room") { setRoomId(String(data.id)); setCabinetId(""); setName(""); setCode(""); }
      if (type === "cabinet") setCabinetId(String(data.id));
      setMessage(`${type === "room" ? "Room" : type === "cabinet" ? "Cabinet" : "Shelf"} added.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save location."); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-5 pb-16">
      <header><Link href="/" className="text-sm text-slate-500">‹ Books</Link><h1 className="mt-3 text-2xl font-semibold">Manage locations</h1>
        <p className="mt-2 text-sm text-slate-500">Create a room, add its cabinets, then add shelves. Each shelf gets a code you can select on a book.</p></header>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {message && <p role="status" className="text-emerald-600">{message}</p>}
      {loading ? <p>Loading locations…</p> : <fieldset disabled={busy} className="space-y-5">
        <form className={panel} onSubmit={(e) => { e.preventDefault(); void save("room"); }}>
          <h2 className="font-semibold">1. Add room</h2>
          <label className="block">Room name<input required maxLength={80} className={input} placeholder="Study" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="block">Room code<input required pattern="[A-Za-z]{2,8}" maxLength={8} className={input} placeholder="ST" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
          <p className="text-xs text-slate-500">Choose a unique abbreviation using 2–8 letters.</p><button className={button}>Add room</button>
        </form>
        <section className={panel}>
          <h2 className="font-semibold">2. Select room and add cabinets</h2>
          <label className="block">Room<select className={input} value={roomId} onChange={(e) => { setRoomId(e.target.value); setCabinetId(""); }}><option value="">Select room</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}</select></label>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save("cabinet"); }}>
            <label className="block">Cabinet number<input required type="number" min="1" max="999" step="1" className={input} value={cabinetNumber} onChange={(e) => setCabinetNumber(e.target.value)} /></label>
            <button disabled={!room} className={button}>Add cabinet</button>
          </form>
        </section>
        <section className={panel}>
          <h2 className="font-semibold">3. Select cabinet and add shelves</h2>
          <label className="block">Cabinet<select disabled={!room} className={input} value={cabinetId} onChange={(e) => setCabinetId(e.target.value)}><option value="">Select cabinet</option>{room?.cabinets.map((c) => <option key={c.id} value={c.id}>{room.code}-C{String(c.number).padStart(2, "0")}</option>)}</select></label>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save("shelf"); }}>
            <label className="block">Shelf number<input required type="number" min="1" max="999" step="1" className={input} value={shelfNumber} onChange={(e) => setShelfNumber(e.target.value)} /></label>
            {room && cabinet && Number(shelfNumber) > 0 && <p className="text-sm">Location code: <strong>{locationCode(room.code, cabinet.number, Number(shelfNumber))}</strong></p>}
            <button disabled={!cabinet} className={button}>Add shelf</button>
          </form>
        </section>
      </fieldset>}
      <section className={panel}><h2 className="font-semibold">Your locations</h2>
        {!loading && !rooms.length && <p className="text-sm text-slate-500">No rooms yet. Add your first room above.</p>}
        {rooms.map((r) => <details key={r.id} open className="border-t border-slate-200 pt-3 dark:border-slate-700"><summary className="cursor-pointer font-medium">{r.name} ({r.code})</summary>
          {!r.cabinets.length && <p className="p-3 text-sm text-slate-500">No cabinets yet.</p>}
          {r.cabinets.map((c) => <div key={c.id} className="ml-4 mt-3"><h3 className="text-sm font-medium">Cabinet {String(c.number).padStart(2, "0")}</h3>
            {!c.shelves.length && <p className="text-sm text-slate-500">No shelves yet.</p>}
            <ul className="mt-1 space-y-1">{c.shelves.map((s) => <li key={s.id} className="text-sm"><code>{locationCode(r.code, c.number, s.number)}</code> — Shelf {s.number}</li>)}</ul>
          </div>)}
        </details>)}
      </section>
    </main>
  );
}
