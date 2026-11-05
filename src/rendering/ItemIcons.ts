import { foods, tools } from "../inventory/ItemRegistry";
export function itemIcon(id: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const c = canvas.getContext("2d")!;
  const tool = tools[id];
  if (tool) {
    c.fillStyle = "#947345";
    for (let i = 3; i < 13; i++) c.fillRect(i, 15 - i, 2, 2);
    c.fillStyle =
      tool.tier === 4
        ? "#59d2cd"
        : id >= 211 && id <= 215
          ? "#e4c65d"
          : tool.tier === 3
            ? "#ccd0cb"
            : tool.tier === 2
              ? "#8d9b98"
              : "#c1a273";
    if (tool.kind === "sword") {
      for (let i = 3; i < 13; i++) c.fillRect(i, 13 - i, 3, 3);
      c.fillRect(3, 9, 6, 2);
    } else if (tool.kind === "shovel") {
      c.fillRect(8, 1, 5, 5);
    } else if (tool.kind === "axe") {
      c.fillRect(4, 1, 8, 6);
    } else if (tool.kind === "hoe") {
      c.fillRect(3, 2, 9, 2);
    } else if (tool.kind === "bow") {
      c.strokeStyle = "#b58b52";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(6, 1);
      c.lineTo(12, 7);
      c.lineTo(6, 14);
      c.stroke();
      c.strokeStyle = "#d4cdb8";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(6, 1);
      c.lineTo(6, 14);
      c.stroke();
    } else c.fillRect(3, 2, 10, 3);
  } else if (foods[id]) {
    c.fillStyle =
      id === 105
        ? "#a44f8a"
        : id === 120
          ? "#b95343"
          : id === 119
            ? "#c29a53"
            : [122, 124, 126].includes(id)
              ? "#9b6543"
              : "#d59280";
    c.fillRect(3, 5, 10, 8);
    c.fillRect(5, 3, 6, 11);
    c.fillStyle = "#f1d098";
    c.fillRect(5, 6, 2, 2);
    c.fillStyle = "#6d9348";
    if (id === 120 || id === 105) c.fillRect(7, 1, 3, 4);
  } else if (id === 117 || id === 118) {
    c.fillStyle = id === 117 ? "#91ac55" : "#d8be67";
    for (let i = 0; i < 4; i++) {
      c.fillRect(3 + i * 3, 4 + (i % 2), 2, 7);
      c.fillRect(4 + i * 3, 10, 1, 5);
    }
  } else {
    c.fillStyle =
      id === 110
        ? "#3c4449"
        : id === 111
          ? "#c7cfcd"
          : id === 112
            ? "#e2c15b"
            : id === 113
              ? "#5cd0ca"
              : id === 131
                ? "#a7b9bd"
                : "#c0ad81";
    if (id === 103 || id === 115) {
      for (let i = 2; i < 14; i++) c.fillRect(i, 15 - i, 1, 2);
    } else if (id === 131) {
      c.fillRect(3, 2, 10, 5);
      c.fillRect(5, 7, 6, 7);
    } else {
      c.fillRect(3, 5, 10, 7);
      c.fillRect(5, 3, 6, 10);
    }
  }
  return canvas.toDataURL();
}
