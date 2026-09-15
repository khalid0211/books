export type LocationRoom = {
  id: number;
  name: string;
  code: string;
  cabinets: { id: number; number: number; shelves: { id: number; number: number }[] }[];
};

export function locationCode(room: string, cabinet: number, shelf: number) {
  return `${room}-C${String(cabinet).padStart(2, "0")}-S${String(shelf).padStart(2, "0")}`;
}

export function flattenLocations(rooms: LocationRoom[]) {
  return rooms.flatMap((room) => room.cabinets.flatMap((cabinet) => cabinet.shelves.map((shelf) => ({
    code: locationCode(room.code, cabinet.number, shelf.number),
    label: `${room.name} · Cabinet ${cabinet.number} · Shelf ${shelf.number}`,
  }))));
}
