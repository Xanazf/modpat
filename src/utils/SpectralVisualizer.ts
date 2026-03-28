import type System from "@core_i/System";

/**
 * Maps Logical vs Semantic output to the RGB space.
 */

export interface SpectralNode {
  type: "formal" | "informal" | "conflict" | "void";
  mass?: number;
  entropy?: number;
  density?: number;
}

export class SpectralVisualizer {
  // Mapping module domains to RGB bias
  private colors = {
    logic: [0, 255, 255], // Cyan
    semantic: [0, 255, 100], // Emerald
    conflict: [255, 0, 255], // Magenta
    void: [128, 128, 128], // Gray
    heat: [255, 100, 0], // Orange
  };

  public render(node: SpectralNode, str?: string): string {
    let baseColor = this.colors.semantic;
    if (node.type === "formal") baseColor = this.colors.logic;
    if (node.type === "conflict") baseColor = this.colors.conflict;
    if (node.type === "void") baseColor = this.colors.void;

    let [r, g, b] = baseColor;

    // Apply "Heat" Glow based on entropy (Surprisal)
    // High entropy = more shift towards heat colors
    if (node.entropy !== undefined && node.entropy > 2) {
      const heatFactor = Math.min(1.0, (node.entropy - 2) / 8); // Normalized 2..10 bits
      r = Math.min(
        255,
        r * (1 - heatFactor) + this.colors.heat[0] * heatFactor
      );
      g = Math.min(
        255,
        g * (1 - heatFactor) + this.colors.heat[1] * heatFactor
      );
      b = Math.min(
        255,
        b * (1 - heatFactor) + this.colors.heat[2] * heatFactor
      );
    }

    // Apply "Density" Brightness
    // density = mass / scope. High density = high brightness
    if (node.density !== undefined) {
      // Logarithmic scaling for brightness to prevent washout
      const brightness = Math.min(
        1.5,
        Math.max(0.5, 0.5 + Math.log10(Math.abs(node.density) + 1) / 10)
      );
      r = Math.min(255, r * brightness);
      g = Math.min(255, g * brightness);
      b = Math.min(255, b * brightness);
    }

    const colorCode = `\x1b[38;2;${Math.floor(r)};${Math.floor(g)};${Math.floor(b)}m`;
    const resetCode = "\x1b[0m";

    if (str) {
      return `${colorCode}${str}${resetCode}`;
    }

    return `${colorCode}${this.getChar(node)}${resetCode}`;
  }

  /**
   * Renders a specific atom from the system state with its associated text.
   */
  public renderAtom(system: System, id: number, text: string): string {
    const mass = system.mass[id];
    const entropy = system.entropy[id];
    const density = system.density[id];
    const isOperator = Math.abs(mass) >= system.c ** 2;
    const isSink = mass < 0;

    const node: SpectralNode = {
      type: isSink ? "conflict" : isOperator ? "formal" : "informal",
      mass,
      entropy,
      density,
    };

    return this.render(node, text);
  }

  /**
   * Renders a whole sequence of atoms from the system state.
   */
  public renderSequence(
    system: System,
    ids: Uint32Array,
    tokens: string[]
  ): string {
    return tokens
      .map((token, i) => {
        return this.renderAtom(system, ids[i], token);
      })
      .join(" ");
  }

  /**
   * Renders an ASCII waveform of the sequence based on the system's "Vibration" (time) property.
   * Smoother bars and density indicators included.
   */
  public renderWaveForm(
    system: System,
    ids: Uint32Array,
    tokens: string[],
    height: number = 2
  ): string {
    if (ids.length === 0) return "";

    const amplitudes = new Float64Array(ids.length);
    let maxAmp = 0;
    for (let i = 0; i < ids.length; i++) {
      // Vibration (time) is the primary property
      amplitudes[i] = system.time[ids[i]];
      if (amplitudes[i] > maxAmp) maxAmp = amplitudes[i];
    }

    if (maxAmp === 0) maxAmp = 1;

    // Use a rich block character set for smoother vertical transitions
    const blocks = [" ", " ", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    // Massive (Logic) tokens use solid blocks, while semantic tokens use shaded patterns for visual texture
    const shadedBlocks = [" ", " ", "░", "▒", "▓", "█", "█", "█", "█"];
    const rows: string[] = [];

    for (let r = height - 1; r >= 0; r--) {
      let row = "";
      for (let i = 0; i < ids.length; i++) {
        const tokenWidth = tokens[i].length;
        const normalized = amplitudes[i] / maxAmp;
        const level = normalized * height;

        const mass = system.mass[ids[i]];
        const isOperator = Math.abs(mass) >= system.c ** 2;
        const blockSet = isOperator ? blocks : shadedBlocks;

        let char = " ";
        if (level >= r + 1) {
          char = blockSet[blockSet.length - 1];
        } else if (level > r) {
          const subLevel = Math.floor((level - r) * (blockSet.length - 1));
          char = blockSet[Math.min(blockSet.length - 1, subLevel)];
        }

        const styledBar = this.renderAtom(
          system,
          ids[i],
          char.repeat(tokenWidth)
        );
        row += styledBar + " ";
      }
      rows.push(row);
    }

    return rows.join("\n");
  }

  private getChar(node: SpectralNode): string {
    if (node.type === "conflict") return "[PASS] ×"; // Destructive Interference
    if (node.type === "void") return "[PASS] ○"; // Unknown / Void state
    if (node.type === "informal") return "[PASS] █"; // Operand
    if (node.type === "formal") return "[PASS] ◈"; // Operator
    return "░"; // Fluid State
  }
}
