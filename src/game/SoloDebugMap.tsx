import { useEffect, useRef } from "react";
import type { Maze } from "../maze/generateMaze";
import { worldToCell } from "../maze/generateMaze";
import type { GameSnapshot } from "../shared/types";

interface SoloDebugMapProps {
  maze: Maze;
  snapshot: GameSnapshot;
  localPlayerId: string;
}

export function SoloDebugMap({ maze, snapshot, localPlayerId }: SoloDebugMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const size = canvas.width;
    const scaleX = size / maze.descriptor.width;
    const scaleZ = size / maze.descriptor.height;
    context.fillStyle = "#090a07";
    context.fillRect(0, 0, size, size);

    context.fillStyle = "#777044";
    for (let z = 0; z < maze.descriptor.height; z += 1) {
      for (let x = 0; x < maze.descriptor.width; x += 1) {
        if (!maze.cells[z * maze.descriptor.width + x]) continue;
        context.fillRect(x * scaleX, z * scaleZ, Math.ceil(scaleX), Math.ceil(scaleZ));
      }
    }

    context.strokeStyle = "#28281f";
    context.lineWidth = 1;
    for (const feature of maze.features) {
      context.fillStyle = feature.kind === "wall" ? "#171813" : "#343326";
      context.fillRect(
        (feature.x - feature.width / 2) * scaleX,
        (feature.z - feature.depth / 2) * scaleZ,
        Math.max(1, feature.width * scaleX),
        Math.max(1, feature.depth * scaleZ),
      );
    }

    const enemy = worldToCell(maze, snapshot.enemy.position);
    context.fillStyle = "#e34c2d";
    context.beginPath();
    context.arc((enemy.x + 0.5) * scaleX, (enemy.z + 0.5) * scaleZ, 3, 0, Math.PI * 2);
    context.fill();

    const local = snapshot.players.find((player) => player.id === localPlayerId);
    if (local) {
      const player = worldToCell(maze, local.position);
      context.save();
      context.translate((player.x + 0.5) * scaleX, (player.z + 0.5) * scaleZ);
      context.rotate(-local.yaw);
      context.fillStyle = "#e3d95d";
      context.beginPath();
      context.moveTo(0, -5);
      context.lineTo(4, 4);
      context.lineTo(0, 2);
      context.lineTo(-4, 4);
      context.closePath();
      context.fill();
      context.restore();
    }
  }, [localPlayerId, maze, snapshot]);

  return (
    <aside className="solo-map" aria-label="Solo debug map">
      <div className="solo-map__header">
        <strong>DEBUG MAP</strong>
        <span>FULL FLOOR</span>
      </div>
      <canvas ref={canvasRef} width={256} height={256} />
      <div className="solo-map__legend">
        <span><i className="is-player" /> YOU</span>
        <span><i className="is-enemy" /> ENTITY</span>
      </div>
    </aside>
  );
}
