import type System from "../../integral/System";
import { BaseAtomizer } from "./BaseAtomizer";
import { ComplexArray, FFT } from "../FFT";

/**
 * GridAtomizer translates 2D (or 3D) ARC-AGI grid states into physical 
 * 4D precepts in the ModPAT manifold.
 */
export class GridAtomizer extends BaseAtomizer {
    
    /**
     * Finds shapes in the grid using Connected Component Labeling (CCL).
     * Disconnected regions of the same color are treated as distinct shapes.
     * Returns bounding box, size, top-left coordinate, and color.
     * @param frame The 3D grid array [layer][row][col]
     * @returns An array of shape details
     */
    public findShapes(frame: number[][][]): Array<{ id: number, color: number, x: number, y: number, minX: number, minY: number, maxX: number, maxY: number, count: number, width: number, height: number }> {
        const shapes: Array<{ id: number, color: number, x: number, y: number, minX: number, minY: number, maxX: number, maxY: number, count: number, width: number, height: number }> = [];
        if (!frame || frame.length === 0) return shapes;

        const grid = frame[0];
        const rows = grid.length;
        const cols = grid[0].length;
        const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));

        let shapeId = 0;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const color = grid[r][c];
                if (color === 0 || color === 9 || visited[r][c]) continue; // Ignore background and already visited

                // Start BFS/DFS for a new shape
                const shape = { id: shapeId++, color, x: c, y: r, minX: c, minY: r, maxX: c, maxY: r, count: 0, width: 0, height: 0 };
                const queue = [[r, c]];
                visited[r][c] = true;

                while (queue.length > 0) {
                    const [currR, currC] = queue.shift()!;
                    shape.minX = Math.min(shape.minX, currC);
                    shape.minY = Math.min(shape.minY, currR);
                    shape.maxX = Math.max(shape.maxX, currC);
                    shape.maxY = Math.max(shape.maxY, currR);
                    shape.count++;

                    // 4-way connectivity
                    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                    for (const [dr, dc] of dirs) {
                        const nr = currR + dr;
                        const nc = currC + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && grid[nr][nc] === color) {
                            visited[nr][nc] = true;
                            queue.push([nr, nc]);
                        }
                    }
                }

                // Finalize dimensions and top-left origin
                shape.width = shape.maxX - shape.minX + 1;
                shape.height = shape.maxY - shape.minY + 1;
                shape.x = shape.minX; // Use absolute top-left integer coordinate
                shape.y = shape.minY; // Use absolute top-left integer coordinate
                shapes.push(shape);
            }
        }

        return shapes;
    }

    /**
     * Atomizes a specific shape into the manifold.
     * @param shape The shape data from findShapes
     * @param depth The current exploration depth
     * @param system The logical manifold
     * @returns The newly allocated quantum ID
     */
    public atomizeShape(shape: { color: number, x: number, y: number, width: number, height: number, count: number }, depth: number, system: System): number {
        // Use color and size as Kind (Y) and structural properties
        const initialMass = 100.0 + shape.count * 10.0;
        const initialScope = this.getSymbolScope(`shape_${shape.color}_${shape.width}x${shape.height}`, false);
        
        const id = system.createLocation(initialMass, initialScope);
        
        // Position in the 4D manifold
        // Map grid coordinates to [0, 10] range
        system.posX[id] = (shape.x / 64.0) * 10.0;
        system.posY[id] = (shape.y / 64.0) * 10.0;
        system.posZ[id] = (shape.color / 10.0) * 10.0; // Color as Energy/Depth
        system.posW[id] = depth; 
        
        system.depth[id] = system.posZ[id];
        system.time[id] = depth;

        system.update(id);

        return id;
    }

    /**
     * Atomizes a game state frame into the manifold.
     * @param frame The grid data
     * @param state The game state (e.g. "PLAY", "WIN")
     * @param levels Number of levels completed
     * @param depth The exploration depth (Age)
     * @param system The logical manifold
     * @returns The newly allocated quantum ID
     */
    public atomizeState(frame: number[][][], state: string, levels: number, depth: number, system: System): number {
        // Calculate structural hash for Matter (X) and Kind (Y) using Spectral Analysis
        let matterX = 0;
        let kindY = 0;
        
        if (frame && frame.length > 0 && frame[0].length > 0) {
            const grid = frame[0];
            const rows = grid.length;
            const cols = grid[0].length;
            const flatSize = rows * cols;
            
            // 1. Flatten and transform into complex domain
            const complexSignal = new ComplexArray(flatSize);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    (complexSignal.real as Float32Array)[r * cols + c] = grid[r][c];
                }
            }

            // 2. Perform FFT to analyze logical "frequencies" (patterns)
            const spectrum = complexSignal.FFT();
            const magnitudes = spectrum.magnitude() as Float32Array;

            // 3. Extract Matter (X) and Kind (Y) from spectral energy distribution
            // Low frequencies = Kind (broad structure), High frequencies = Matter (fine detail)
            const mid = Math.floor(flatSize / 2);
            let lowEnergy = 0;
            let highEnergy = 0;

            for (let i = 0; i < flatSize; i++) {
                if (i < mid) lowEnergy += magnitudes[i];
                else highEnergy += magnitudes[i];
            }

            // Normalize to [0, 10] range
            matterX = (highEnergy / flatSize) % 10.0;
            kindY = (lowEnergy / flatSize) % 10.0;
        }
        
        // Determine physical properties based on game state
        // Level progress acts as a mass multiplier to pull the geodesic
        let initialMass = 10.0 + levels * 100.0;
        let initialScope = 5.0;

        if (state === "WIN") {
            // The Win condition acts as a massive attractor
            initialMass = 10000.0; 
            initialScope = 1.0; // High density = Mass / Scope
        }

        const id = system.createLocation(initialMass, initialScope);
        
        // Position in the 4D manifold
        system.posX[id] = matterX;
        system.posY[id] = kindY;
        // Energy (Z) represents progress toward the win condition
        system.posZ[id] = levels * 10.0 + (state === "WIN" ? 100.0 : 0); 
        // Age (W) corresponds to action depth
        system.posW[id] = depth; 
        
        // Depth represents the "Potential Field" value
        system.depth[id] = system.posZ[id];
        system.time[id] = depth;

        system.update(id);

        return id;
    }

    /**
     * Atomizes a coordinate vector into a manifold precept.
     * Used for complex actions like ACTION6 which require an (x, y) target.
     */
    public atomizeCoordinate(x: number, y: number, depth: number, system: System): number {
        const initialMass = 50.0;
        const initialScope = 2.0;
        const id = system.createLocation(initialMass, initialScope);
        
        // Scale to [0, 10] range assuming a max grid size of 64x64
        system.posX[id] = (x / 64.0) * 10.0;
        system.posY[id] = (y / 64.0) * 10.0;
        system.posZ[id] = 5.0; // Minimal structural energy
        system.posW[id] = depth; 
        
        system.depth[id] = system.posZ[id];
        system.time[id] = system.posW[id];

        system.update(id);
        return id;
    }

    /**
     * Atomizes an action transition into the manifold.
     * Maps "if a then b" or "if a && b then c" into operators.
     */
    public atomizeAction(actionName: string, fromIds: number[], toId: number, system: System): number {
        const scope = this.getSymbolScope(actionName, true);
        
        const isComplex = fromIds.length > 1;
        // Complex actions have higher mass, pulling the path more strongly
        const initialMass = isComplex ? 5000.0 : 500.0;
        
        const id = system.createLocation(initialMass, scope);
        
        // Find the "center of mass" for all prerequisite sources
        let avgFromX = 0, avgFromY = 0, avgFromZ = 0, avgFromW = 0, avgFromD = 0, avgFromT = 0;
        for (const fromId of fromIds) {
            avgFromX += system.posX[fromId];
            avgFromY += system.posY[fromId];
            avgFromZ += system.posZ[fromId];
            avgFromW += system.posW[fromId];
            avgFromD += system.depth[fromId];
            avgFromT += system.time[fromId];
        }
        
        if (fromIds.length > 0) {
            avgFromX /= fromIds.length;
            avgFromY /= fromIds.length;
            avgFromZ /= fromIds.length;
            avgFromW /= fromIds.length;
            avgFromD /= fromIds.length;
            avgFromT /= fromIds.length;
        }

        // Place the action operator exactly between the source prerequisites and target state
        system.posX[id] = (avgFromX + system.posX[toId]) / 2;
        system.posY[id] = (avgFromY + system.posY[toId]) / 2;
        system.posZ[id] = (avgFromZ + system.posZ[toId]) / 2;
        system.posW[id] = (avgFromW + system.posW[toId]) / 2;
        
        system.depth[id] = (avgFromD + system.depth[toId]) / 2;
        system.time[id] = (avgFromT + system.time[toId]) / 2;

        system.update(id);
        
        return id;
    }
}
