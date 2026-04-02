import fs from "fs";
import path from "path";
import System from "@core_i/System";
import Mapper from "@core_i/Mapper";
import { GridAtomizer } from "@atomics/GridAtomizer";
import { BaseExplorer } from "./BaseExplorer";
import { ARCEnvironment, type ARCState } from "@environments/ARCEnvironment";
import { type FrameResponse } from "@tests/kaggle/fetchARC3";

/**
 * INFO: ARC-AGI-3 AR25 Action limits
 * lvl_1 - maxSteps: 24; humanBaseline: 17
 * lvl_2 - maxSteps: 29; humanBaseline: 22
 * lvl_3 - maxSteps: 110; humanBaseline: 103
 * lvl_4 - maxSteps: 36; humanBaseline: 29
 * lvl_5 - maxSteps: 36; humanBaseline: 29
 * lvl_6 - maxSteps: 166; humanBaseline: 159
 * lvl_7 - maxSteps: 159; humanBaseline: 152
 * lvl_8 - maxSteps: 73; humanBaseline: 66
 */

/**
 * ARCExplorer: A specialized explorer for the ARC-AGI-3 environment.
 * Extends BaseExplorer to provide multi-level control loop logic for grid tasks.
 */
export class ARCExplorer extends BaseExplorer<
  ARCState,
  number,
  FrameResponse | null
> {
  public atomizer: GridAtomizer;
  private apiBaseDir: string;
  private logFile: string;
  private vectorMap: Record<
    number,
    Record<string, { dx: number; dy: number; nextSig?: string }>
  > = {};
  private calibratedSignatures: Record<number, Set<string>> = {};

  private getShapeSignature(shape: {
    color: number;
    width: number;
    height: number;
    count: number;
  }): string {
    return `${shape.color}_${shape.width}x${shape.height}_${shape.count}`;
  }

  constructor(
    system: System,
    mapper: Mapper,
    apiBaseDir: string,
    gameId: string,
    runId: number
  ) {
    const env = new ARCEnvironment(gameId);
    const atomizer = new GridAtomizer();
    super(system, mapper, env, atomizer);
    this.atomizer = atomizer;
    this.apiBaseDir = apiBaseDir;

    const logsDir = path.join(this.apiBaseDir, "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    this.logFile = path.join(logsDir, `run_${runId}_${gameId}.log`);
    fs.writeFileSync(
      this.logFile,
      `=== ModPAT ARC-AGI-3 Explorer Log (Run ${runId}, Game ${gameId}) ===\n`
    );
  }

  /**
   * Overrides the BaseExplorer log to also write to the session-specific log file.
   */
  protected log(message: string) {
    console.log(message);
    fs.appendFileSync(this.logFile, message + "\n");
  }

  private dumpGrid(frame: number[][][], prefix: string) {
    if (!frame || frame.length === 0 || frame[0].length === 0) return;
    const gridFile = path.join(
      path.dirname(this.logFile),
      `${prefix}_grid.txt`
    );
    let out = "";
    for (let r = 0; r < frame[0].length; r++) {
      out +=
        frame[0][r]
          .map((c: number) => c.toString().padStart(2, " "))
          .join(" ") + "\n";
    }
    fs.writeFileSync(gridFile, out);
    this.log(`[Grid] Dumped frame to ${gridFile}`);
  }

  /**
   * Implements the ARC-specific atomization logic for the 4D manifold.
   */
  protected atomizeState(state: ARCState, depth: number): number {
    // In ARC, levels completed is a key metric for Z-axis progress.
    // However, ARCState only contains the frame. The Environment result has levels_completed.
    // For now, we assume standard atomization via the GridAtomizer.
    return this.atomizer.atomizeState(state, "PLAY", 0, depth, this.system);
  }

  /**
   * Implements the ARC-specific action atomization.
   */
  protected atomizeAction(
    action: number,
    fromIds: number[],
    toId: number
  ): number {
    return this.atomizer.atomizeAction(
      `action_${action}`,
      fromIds,
      toId,
      this.system
    );
  }

  /**
   * Calibration phase: Learns the (dx, dy) vectors for ALL shapes per action.
   * This identifies which shapes are "playable" (move or change in response to input).
   */
  protected async calibrate(currentResponse: FrameResponse): Promise<void> {
    this.log(`\n=== Physical Calibration Phase (Exhaustive) ===`);

    // 1. RECOGNIZE ALL SHAPES
    const initialShapes = this.atomizer.findShapes(currentResponse.frame);
    this.log(`[Explore] Identified ${initialShapes.length} potential shapes.`);

    // 2. TEST EVERY AVAILABLE ACTION
    const availableActions = currentResponse.available_actions.filter(
      (v, _) => v < 6
    );

    for (const act of availableActions) {
      if (!this.vectorMap[act]) this.vectorMap[act] = {};
      if (!this.calibratedSignatures[act])
        this.calibratedSignatures[act] = new Set<string>();

      let needsCalibration = false;
      for (const shape of initialShapes) {
        const sig = this.getShapeSignature(shape);
        if (!this.calibratedSignatures[act].has(sig)) {
          needsCalibration = true;
          break;
        }
      }

      if (!needsCalibration) {
        this.log(
          `[Calibrate] Skipping ACTION_${act}, all current shapes already calibrated.`
        );
        continue;
      }

      this.log(`[Calibrate] Testing ACTION_${act}...`);
      const testRes = await this.env.execute(act);

      if (!testRes) {
        this.log(
          `  -> ACTION_${act} returned error (likely 500). Mapping as unsupported (null).`
        );
        this.vectorMap[act] = null as any;
        continue;
      }

      const testShapes = this.atomizer.findShapes(testRes.frame);
      const usedTestTargetIds = new Set<number>();
      for (const shape of initialShapes) {
        const sig = this.getShapeSignature(shape);
        this.calibratedSignatures[act].add(sig);

        let testMatch: any = null;
        let minDist = Infinity;
        let spatialMatch: any = null;
        let minSpatialDist = Infinity;

        // Try to find the same shape in the new frame based on dimensions and count (color might change)
        for (const tShape of testShapes) {
          if (!usedTestTargetIds.has(tShape.id)) {
            const dist =
              Math.abs(tShape.x - shape.x) + Math.abs(tShape.y - shape.y);

            if (
              tShape.width === shape.width &&
              tShape.height === shape.height &&
              tShape.count === shape.count
            ) {
              if (dist < minDist) {
                minDist = dist;
                testMatch = tShape;
              }
            }

            if (dist < minSpatialDist) {
              minSpatialDist = dist;
              spatialMatch = tShape;
            }
          }
        }

        if (!testMatch && spatialMatch && minSpatialDist < 1.0) {
          testMatch = spatialMatch;
          this.log(
            `  -> ACTION_${act} transformed Shape ${shape.id} structure/color (mapped spatially).`
          );
        }

        if (testMatch) {
          usedTestTargetIds.add(testMatch.id);
          const dx = testMatch.x - shape.x;
          const dy = testMatch.y - shape.y;
          const nextSig = this.getShapeSignature(testMatch);
          this.vectorMap[act][sig] = { dx, dy, nextSig };

          if (testMatch.color !== shape.color) {
            this.log(
              `  -> ACTION_${act} transformed Shape ${shape.id} color: ${shape.color} -> ${testMatch.color}`
            );
          }
          if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
            this.log(
              `  -> ACTION_${act} moves Shape ${shape.id} (Color ${testMatch.color}) by (dx: ${dx.toFixed(2)}, dy: ${dy.toFixed(2)})`
            );
          }
        } else {
          // Shape was destroyed, merged, or changed color
          this.vectorMap[act][sig] = { dx: 0, dy: 0 };
          this.log(
            `  -> ACTION_${act} transformed or destroyed Shape ${shape.id} (Color ${shape.color}).`
          );
        }
      }

      // Undo the test action to return to the initial state for the next test
      await this.env.execute(7);
    }
  }

  private calculateGridGeodesic(
    initialPairs: any[],
    availableActions: number[],
    maxDepth: number = 15
  ): number[] {
    interface SearchNode {
      positions: { x: number; y: number; sig: string }[];
      path: number[];
      cost: number;
      heuristic: number;
    }

    const startPositions = initialPairs.map(p => ({
      x: Math.round(p.target.x),
      y: Math.round(p.target.y),
      sig: this.getShapeSignature(p.target),
    }));

    const getHeuristic = (positions: { x: number; y: number; sig: string }[]) => {
      let h = 0;
      for (let i = 0; i < positions.length; i++) {
        h += Math.sqrt(
          (positions[i].x - initialPairs[i].fixedGoalX) ** 2 +
            (positions[i].y - initialPairs[i].fixedGoalY) ** 2
        );
      }
      return h;
    };

    const startNode: SearchNode = {
      positions: startPositions,
      path: [],
      cost: 0,
      heuristic: getHeuristic(startPositions),
    };

    const openSet: SearchNode[] = [startNode];
    const closedSet = new Set<string>();

    const getStateKey = (positions: { x: number; y: number; sig: string }[]) => {
      return positions.map(p => `${p.x},${p.y},${p.sig}`).join("|");
    };

    closedSet.add(getStateKey(startPositions));

    let bestNode: SearchNode = startNode;

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.cost + a.heuristic - (b.cost + b.heuristic));
      const current = openSet.shift()!;

      if (current.heuristic < bestNode.heuristic) {
        bestNode = current;
      }

      if (current.heuristic === 0) {
        return current.path;
      }

      if (current.path.length >= maxDepth) {
        continue;
      }

      for (const act of availableActions) {
        const vecMap = this.vectorMap[act];
        if (!vecMap) continue;

        let actionDoesSomething = false;
        const nextPositions = current.positions.map(pos => {
          const vec = vecMap[pos.sig];
          const dx = vec ? vec.dx : 0;
          const dy = vec ? vec.dy : 0;
          const nextSig = vec && vec.nextSig ? vec.nextSig : pos.sig;

          if (Math.round(dx) !== 0 || Math.round(dy) !== 0 || nextSig !== pos.sig) {
            actionDoesSomething = true;
          }

          return {
            x: pos.x + Math.round(dx),
            y: pos.y + Math.round(dy),
            sig: nextSig,
          };
        });

        if (!actionDoesSomething) continue;

        const stateKey = getStateKey(nextPositions);
        if (!closedSet.has(stateKey)) {
          closedSet.add(stateKey);
          openSet.push({
            positions: nextPositions,
            path: [...current.path, act],
            cost: current.cost + 1,
            heuristic: getHeuristic(nextPositions),
          });
        }
      }
    }

    return bestNode.path;
  }

  /**
   * The core ARC solve loop, inherited and implemented from BaseExplorer.
   */
  public async solve(): Promise<{
    route: Uint32Array;
    actions: number[];
  } | null> {
    const startProc = process.hrtime.bigint();
    this.log(`\n=== ARC-AGI-3 Multi-Level Control Loop ===`);

    let currentResponse: FrameResponse | null = await this.env.reset();
    if (!currentResponse) {
      return null;
    }
    this.dumpGrid(currentResponse.frame, "STEP_0_RESET");

    const actionsTaken: number[] = [];
    const routeIds: number[] = [];
    let currentStateId = this.atomizeState(
      currentResponse.frame,
      currentResponse.levels_completed
    );
    routeIds.push(currentStateId);

    while (
      currentResponse &&
      currentResponse.state !== "WIN" &&
      currentResponse.state !== "GAME_OVER"
    ) {
      this.log(
        `\n=== Starting Level ${currentResponse.levels_completed + 1} ===`
      );
      const initialLevelsCompleted = currentResponse.levels_completed;

      // 1. RECOGNIZE SHAPES
      let shapes = this.atomizer.findShapes(currentResponse.frame);
      let goalColor = -1;
      shapes.forEach(shape => {
        if (shape.color > goalColor) goalColor = shape.color;
      });

      if (goalColor === -1) {
        this.log("[Error] No shapes found in grid.");
        break;
      }

      const goals = shapes.filter(s => s.color === goalColor);
      if (goals.length === 0) {
        this.log("[Error] No goals found.");
        break;
      }

      // 2. IDENTIFY TARGET SHAPES
      const goalTargetPairs: any[] = [];
      const usedTargetIds = new Set<number>();

      for (const g of goals) {
        let bestTarget = null;
        for (const s of shapes) {
          if (
            s.color !== goalColor &&
            !usedTargetIds.has(s.id) &&
            s.width === g.width &&
            s.height === g.height &&
            s.count === g.count &&
            s.width > 1 &&
            s.height > 1
          ) {
            bestTarget = s;
            usedTargetIds.add(s.id);
            break;
          }
        }
        if (bestTarget) {
          goalTargetPairs.push({
            goal: g,
            target: bestTarget,
            origTargetId: bestTarget.id,
            fixedGoalX: g.x,
            fixedGoalY: g.y,
          });
        }
      }

      if (goalTargetPairs.length === 0) {
        this.log("[Error] Target shapes matching Goal dimensions not found!");
        break;
      }

      this.log(
        `[Explore] Identified ${goalTargetPairs.length} Goal-Target pairs.`
      );

      // 3. CALIBRATE PHYSICS
      await this.calibrate(currentResponse);

      // 4. CLOSED-LOOP EXECUTION
      this.log(`\n=== Active Execution Phase ===`);
      let stepCount = 0;
      const maxSteps = 100;

      while (
        currentResponse.state !== "GAME_OVER" &&
        currentResponse.state !== "WIN" &&
        currentResponse.levels_completed === initialLevelsCompleted &&
        stepCount < maxSteps
      ) {
        stepCount++;
        shapes = this.atomizer.findShapes(currentResponse.frame);
        const currentPairs: any[] = [];
        const usedShapeIds = new Set<number>();

        for (const pair of goalTargetPairs) {
          const origTarget = pair.target;
          let bestTargetCandidate: any = null;
          let minTargetDist = Infinity;
          let spatialMatchCandidate: any = null;
          let minSpatialDist = Infinity;

          // Projection for fallback
          let dx = 0,
            dy = 0;
          if (actionsTaken.length > 0) {
            const lastAction = actionsTaken[actionsTaken.length - 1];
            const sig = this.getShapeSignature(origTarget);
            const vec = this.vectorMap[lastAction]?.[sig];
            if (vec) {
              dx = vec.dx;
              dy = vec.dy;
            }
          }
          const projectedX = origTarget.x + dx;
          const projectedY = origTarget.y + dy;

          shapes.forEach(shape => {
            if (!usedShapeIds.has(shape.id)) {
              // Strict match
              if (
                shape.color === origTarget.color &&
                shape.width === origTarget.width &&
                shape.height === origTarget.height &&
                shape.count === origTarget.count
              ) {
                const d = Math.sqrt(
                  (shape.x - origTarget.x) ** 2 + (shape.y - origTarget.y) ** 2
                );
                if (d < minTargetDist) {
                  minTargetDist = d;
                  bestTargetCandidate = shape;
                }
              }

              // Spatial match (same XY but different Z/properties)
              const spatialDist = Math.sqrt(
                (shape.x - projectedX) ** 2 + (shape.y - projectedY) ** 2
              );
              if (spatialDist < minSpatialDist) {
                minSpatialDist = spatialDist;
                spatialMatchCandidate = shape;
              }
            }
          });

          if (bestTargetCandidate) {
            usedShapeIds.add(bestTargetCandidate.id);
            currentPairs.push({
              target: bestTargetCandidate,
              origTargetId: pair.origTargetId,
              fixedGoalX: pair.fixedGoalX,
              fixedGoalY: pair.fixedGoalY,
            });
            pair.target = bestTargetCandidate;
            this.atomizer.atomizeShape(
              bestTargetCandidate,
              currentResponse.levels_completed,
              this.system
            );
          } else if (spatialMatchCandidate && minSpatialDist < 1.0) {
            // Spatial fallback: Same XY coordinates, different Z (color) or properties
            usedShapeIds.add(spatialMatchCandidate.id);
            currentPairs.push({
              target: spatialMatchCandidate,
              origTargetId: pair.origTargetId,
              fixedGoalX: pair.fixedGoalX,
              fixedGoalY: pair.fixedGoalY,
            });
            pair.target = spatialMatchCandidate;
            this.log(
              `[Warning] Target ${pair.origTargetId} properties changed. Mapped spatially to Shape ${spatialMatchCandidate.id} (same XY, different Z/Color).`
            );
            this.atomizer.atomizeShape(
              spatialMatchCandidate,
              currentResponse.levels_completed,
              this.system
            );
          } else {
            // Dead reckoning fallback
            const projectedTarget = {
              ...origTarget,
              x: projectedX,
              y: projectedY,
            };
            currentPairs.push({
              target: projectedTarget,
              origTargetId: pair.origTargetId,
              fixedGoalX: pair.fixedGoalX,
              fixedGoalY: pair.fixedGoalY,
            });
            pair.target = projectedTarget;
            this.log(
              `[Warning] Lost track of Target ${pair.origTargetId}. Using dead reckoning and mapping to System.`
            );
            this.atomizer.atomizeShape(
              projectedTarget,
              currentResponse.levels_completed,
              this.system
            );
          }
        }

        let totalDist = 0;
        for (const p of currentPairs) {
          totalDist += Math.sqrt(
            (p.target.x - p.fixedGoalX) ** 2 + (p.target.y - p.fixedGoalY) ** 2
          );
        }

        this.log(
          `\n--- Step ${stepCount} | Total Distance to Goals: ${totalDist.toFixed(2)} ---`
        );

        const geodesicPath = this.calculateGridGeodesic(
          currentPairs,
          currentResponse.available_actions.filter((v, _) => v < 6),
          15
        );

        if (geodesicPath.length > 0) {
          const bestAct = geodesicPath[0];
          this.log(
            `[Mapper] Calculated Grid Geodesic: [${geodesicPath.join(", ")}]`
          );
          this.log(
            `[Execute] Dispatching next step in geodesic: ACTION_${bestAct}...`
          );

          const res = await this.env.execute(bestAct);
          if (!res) {
            this.log(
              `[Error] ACTION_${bestAct} failed (null result). Mapping as invalid.`
            );
            this.vectorMap[bestAct] = null as any;
            continue;
          }
          currentResponse = res;
          actionsTaken.push(bestAct);
          this.dumpGrid(
            currentResponse.frame,
            `EXEC_L${initialLevelsCompleted}_S${stepCount}_ACT_${bestAct}`
          );

          const nextStateId = this.atomizeState(
            currentResponse.frame,
            currentResponse.levels_completed
          );
          const actionId = this.atomizeAction(
            bestAct,
            [currentStateId],
            nextStateId
          );
          routeIds.push(actionId, nextStateId);
          currentStateId = nextStateId;

          if (
            this.env.isComplete(currentResponse) ||
            currentResponse.levels_completed > initialLevelsCompleted
          ) {
            this.log(`\n[Level Complete] Sequence successful for this phase.`);
            break;
          } else if (currentResponse.state === "GAME_OVER") {
            this.log(`\n[Failure] GAME_OVER received at step ${stepCount}.`);
            break;
          }
        } else {
          this.log(
            `[Warning] Geodesic stalled (no path found). Attempting state-shifting actions...`
          );

          // Try ACTION_5 or any action that previously transformed a shape
          const stateShifters = [5, 6, 7];
          let shiftSuccess = false;

          for (const shiftAct of stateShifters) {
            if (!this.env.isValidAction(shiftAct, currentResponse)) continue;

            this.log(`[Execute] Dispatching State-Shift ACTION_${shiftAct}...`);
            const res = await this.env.execute(shiftAct);
            if (res) {
              currentResponse = res;
              actionsTaken.push(shiftAct);
              shiftSuccess = true;

              const nextStateId = this.atomizeState(
                currentResponse.frame,
                currentResponse.levels_completed
              );
              const actionId = this.atomizeAction(
                shiftAct,
                [currentStateId],
                nextStateId
              );
              routeIds.push(actionId, nextStateId);
              currentStateId = nextStateId;

              // Recalibrate after shift because vectors likely changed
              await this.calibrate(currentResponse);
              break;
            }
          }

          if (!shiftSuccess) {
            this.log(
              `[Error] Projection stalled and no state-shifts available.`
            );
            break;
          }
          continue; // Re-evaluate after shift and recalibration
        }
      }

      if (
        currentResponse.state === "GAME_OVER" ||
        stepCount >= maxSteps ||
        (!this.env.isComplete(currentResponse) &&
          currentResponse.levels_completed === initialLevelsCompleted)
      ) {
        break;
      }

      if (
        !this.env.isComplete(currentResponse) &&
        currentResponse.levels_completed > initialLevelsCompleted
      ) {
        this.log(
          `\n[Transition] Fetching next level frame via dummy action...`
        );
        currentResponse = await this.env.execute(1);
        if (currentResponse) {
          const nextStateId = this.atomizeState(
            currentResponse.frame,
            currentResponse.levels_completed
          );
          const actionId = this.atomizeAction(1, [currentStateId], nextStateId);
          routeIds.push(actionId, nextStateId);
          currentStateId = nextStateId;
        }
      }
    }

    if (currentResponse && currentResponse.state === "WIN") {
      this.log(`\n[Victory] WIN state confirmed! All levels completed!`);
    }

    this.log(`\n[Win] Final Action Sequence: [${actionsTaken.join(", ")}]`);
    const endProc = process.hrtime.bigint();
    this.log(
      `[Performance] Pipeline Completed in ${Number(endProc - startProc) / 1_000_000}ms`
    );

    return { route: new Uint32Array(routeIds), actions: actionsTaken };
  }
}
