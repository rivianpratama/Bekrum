import type { Maze } from "../maze/generateMaze";
import { worldToCell } from "../maze/generateMaze";
import type { GameSnapshot } from "../shared/types";

interface SoloDebugMapProps {
  maze: Maze;
  snapshot: GameSnapshot;
  localPlayerId: string;
}

export function SoloDebugMap({ maze, snapshot, localPlayerId }: SoloDebugMapProps) {
  const { width, height } = maze.descriptor;
  const local = snapshot.players.find((player) => player.id === localPlayerId);
  const enemyCell = worldToCell(maze, snapshot.enemy.position);
  const playerCell = local ? worldToCell(maze, local.position) : null;
  const cellSize = 8;

  return (
    <aside className="solo-map" aria-label="Solo debug map">
      <div className="solo-map__header">
        <strong>DEBUG MAP</strong>
        <span>YOU / ENTITY</span>
      </div>
      <svg
        viewBox={`0 0 ${width * cellSize} ${height * cellSize}`}
        role="img"
        aria-label="Maze map showing player and enemy positions"
      >
        <rect width="100%" height="100%" className="solo-map__background" />
        {Array.from(maze.cells, (cell, index) => {
          const x = index % width;
          const z = Math.floor(index / width);
          return (
            <rect
              key={index}
              x={x * cellSize}
              y={z * cellSize}
              width={cellSize}
              height={cellSize}
              className={cell ? "solo-map__floor" : "solo-map__wall"}
            />
          );
        })}
        <circle
          cx={(enemyCell.x + 0.5) * cellSize}
          cy={(enemyCell.z + 0.5) * cellSize}
          r={3.2}
          className="solo-map__enemy"
        />
        {playerCell && local ? (
          <g
            transform={`translate(${(playerCell.x + 0.5) * cellSize} ${(playerCell.z + 0.5) * cellSize}) rotate(${(-local.yaw * 180) / Math.PI})`}
            className="solo-map__player"
          >
            <path d="M 0 -5 L 4 4 L 0 2 L -4 4 Z" />
          </g>
        ) : null}
      </svg>
      <div className="solo-map__legend">
        <span><i className="is-player" /> YOU</span>
        <span><i className="is-enemy" /> ENTITY</span>
      </div>
    </aside>
  );
}
