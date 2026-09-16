import JsBarcode from "jsbarcode";
import { bookNumber } from "@/lib/books";

/** Draw the existing 2 × 1 inch, 300 dpi label for either print view. */
export function renderBookLabel(id: number, title: string, owner: string) {
  const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 300;
  const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 300); ctx.fillStyle = "black";
  ctx.textBaseline = "top";
  let shortened = false;
  function line(text: string, y: number, font: string, width = 320) {
    ctx!.font = font;
    let result = text;
    while (ctx!.measureText(result).width > width && result.length) result = Array.from(result).slice(0, -1).join("");
    if (result !== text) {
      shortened = true;
      while (ctx!.measureText(result + "…").width > width && result.length) result = Array.from(result).slice(0, -1).join("");
      result += "…";
    }
    ctx!.fillText(result, 24, y);
  }
  line(bookNumber(id), 16, "bold 36px Arial");
  ctx.font = "bold 27px Arial";
  const chars = Array.from(title.replace(/\s+/g, " ").trim());
  let first = "";
  while (chars.length && ctx.measureText(first + chars[0]).width <= 552) first += chars.shift();
  if (chars.length && first.lastIndexOf(" ") > 0) {
    const cut = first.lastIndexOf(" "); chars.unshift(...Array.from(first.slice(cut + 1))); first = first.slice(0, cut);
  }
  line(first, 59, "bold 27px Arial", 552);
  line(chars.join("").trim(), 90, "bold 27px Arial", 552);
  line(`Owner: ${owner}`, 124, "25px Arial", 552);
  const barcode = document.createElement("canvas");
  const options = { format: "CODE128", displayValue: false, height: 110, margin: 0, marginLeft: 10, marginRight: 10, width: 1 };
  JsBarcode(barcode, bookNumber(id), options);
  const moduleWidth = Math.floor(552 / barcode.width);
  if (moduleWidth < 1) throw new Error("Book ID is too long for the label.");
  JsBarcode(barcode, bookNumber(id), { ...options, width: moduleWidth, marginLeft: 10 * moduleWidth, marginRight: 10 * moduleWidth });
  ctx.drawImage(barcode, Math.floor((600 - barcode.width) / 2), 164);
  return { url: canvas.toDataURL("image/png"), shortened };
}
