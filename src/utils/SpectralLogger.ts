import type System from "@core_i/System";
import { SpectralVisualizer } from "./SpectralVisualizer";

const visualizer = new SpectralVisualizer();

/**
 * Helper to split a sequence into chunks that fit within the terminal width.
 */
const splitSequence = (
  ids: Uint32Array,
  tokens: string[],
  maxWidth: number
) => {
  const chunks: { ids: number[]; tokens: string[] }[] = [];
  let currentIds: number[] = [];
  let currentTokens: string[] = [];
  let currentWidth = 0;

  for (let i = 0; i < ids.length; i++) {
    const tokenWidth = tokens[i].length + 1; // +1 for space
    if (currentWidth + tokenWidth > maxWidth && currentTokens.length > 0) {
      chunks.push({ ids: currentIds, tokens: currentTokens });
      currentIds = [];
      currentTokens = [];
      currentWidth = 0;
    }
    currentIds.push(ids[i]);
    currentTokens.push(tokens[i]);
    currentWidth += tokenWidth;
  }

  if (currentTokens.length > 0) {
    chunks.push({ ids: currentIds, tokens: currentTokens });
  }

  return chunks;
};

const getTerminalWidth = () => (process.stdout.columns || 80) - 12;

/**
 * Transforms standard console logs into styled spectral outputs.
 * This utility recognizes common patterns in the logic engine and applies
 * physics-based color shifts (mass, entropy, density) to the output.
 */
export const logger = {
  /**
   * Standard log with pattern-based spectral styling.
   */
  log: (msg: string, ...args: unknown[]) => {
    if (typeof msg !== "string") {
      console.log(msg, ...args);
      return;
    }

    // Pattern recognition for common system tags and markers
    const styled = msg
      .replace(
        /\[Wikipedia\]/g,
        visualizer.render({ type: "informal" }, "[Wikipedia]")
      )
      .replace(
        /\[Geodesic\]/g,
        visualizer.render({ type: "formal" }, "[Geodesic]")
      )
      .replace(
        /\[LiveInference\]:/g,
        visualizer.render({ type: "formal" }, "[LiveInference]:")
      )
      .replace(
        /\[TestInference\]:/g,
        visualizer.render({ type: "formal" }, "[TestInference]:")
      )
      .replace(/\[Inference Surprisal: (.*?) bits\]/g, (_, bits) => {
        const entropy = parseFloat(bits);
        // Map entropy to "heat" glow
        return visualizer.render(
          { type: "informal", entropy },
          `[Inference Surprisal: ${bits} bits]`
        );
      })
      .replace(/Acknowledged: "(.*?)"/g, (_, text) => {
        return `Acknowledged: "${visualizer.render({ type: "informal" }, text)}"`;
      });

    console.log(styled, ...args);
  },

  /**
   * Logs a logical sequence with its full physical representation from the System.
   * Supports an optional 'resultIds' to show transformation (e.g., "query : answer").
   */
  logic: (
    label: string,
    system: System,
    ids: Uint32Array,
    atomizer: Atomic.Engine,
    resultIds?: Uint32Array
  ) => {
    const maxWidth = getTerminalWidth();

    const render = (targetIds: Uint32Array) => {
      const tokens: string[] = [];
      for (let i = 0; i < targetIds.length; i++) {
        tokens.push(
          atomizer.decodeSequence(new Uint32Array([targetIds[i]]), system)
        );
      }
      return {
        tokens,
        styled: visualizer.renderSequence(system, targetIds, tokens),
      };
    };

    const input = render(ids);
    const labelStyled = visualizer.render({ type: "formal" }, `[${label}]`);

    if (!resultIds) {
      const chunks = splitSequence(ids, input.tokens, maxWidth);
      chunks.forEach((chunk, idx) => {
        const styled = visualizer.renderSequence(
          system,
          new Uint32Array(chunk.ids),
          chunk.tokens
        );
        const prefix =
          idx === 0 ? `  ${labelStyled} ` : " ".repeat(label.length + 5);
        console.log(`${prefix}${styled}`);
      });
      return;
    }

    const result = render(resultIds);
    // Simple one-liner check
    const totalLen =
      label.length +
      input.tokens.join(" ").length +
      result.tokens.join(" ").length +
      10;

    if (totalLen <= maxWidth + 10) {
      console.log(`  ${labelStyled} ${input.styled} : ${result.styled}`);
    } else {
      // Wrapped multi-line format
      console.log(`  ${labelStyled} ${input.styled}`);
      console.log(`  ${" ".repeat(label.length + 3)}: ${result.styled}`);
    }
  },

  /**
   * Logs an ASCII waveform followed by the styled logical sequence.
   */
  wave: (
    label: string,
    system: System,
    ids: Uint32Array,
    atomizer: Atomic.Engine
  ) => {
    const tokens: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      tokens.push(atomizer.decodeSequence(new Uint32Array([ids[i]]), system));
    }

    const maxWidth = getTerminalWidth();
    const chunks = splitSequence(ids, tokens, maxWidth);

    console.log(
      `\n  ${visualizer.render({ type: "formal" }, `[WAVE: ${label}]`)}`
    );

    chunks.forEach(chunk => {
      const chunkIds = new Uint32Array(chunk.ids);
      const waveForm = visualizer.renderWaveForm(
        system,
        chunkIds,
        chunk.tokens,
        2
      );
      const styledSequence = visualizer.renderSequence(
        system,
        chunkIds,
        chunk.tokens
      );

      console.log(
        waveForm
          .split("\n")
          .map(line => "    " + line)
          .join("\n")
      );
      console.log("    " + styledSequence + "\n");
    });
  },

  /**
   * Styles error messages with "conflict" (Magenta) spectral colors.
   */
  error: (msg: string, ...args: unknown[]) => {
    const label = visualizer.render({ type: "conflict" }, "[CONFLICT ERROR]");
    console.error(`${label} ${msg}`, ...args);
  },

  /**
   * Styles warning messages with "void" (Gray) spectral colors.
   */
  warn: (msg: string, ...args: unknown[]) => {
    const label = visualizer.render({ type: "void" }, "[VOID WARNING]");
    console.warn(`${label} ${msg}`, ...args);
  },

  /**
   * Logs a spectral step marker for sequence execution.
   */
  step: (msg: string) => {
    const icon = visualizer.render({ type: "formal" }, "→");
    console.log(`\n  ${icon} ${visualizer.render({ type: "informal" }, msg)}`);
  },

  /**
   * Logs a spectral header for major system transitions.
   */
  header: (title: string) => {
    const text = title.toUpperCase();
    const line = "━".repeat(text.length + 8);
    const top = visualizer.render({ type: "formal" }, `┏${line}┓`);
    const mid = visualizer.render({ type: "formal" }, `┃   ${text}   ┃`);
    const bot = visualizer.render({ type: "formal" }, `┗${line}┛`);

    console.log(`\n${top}\n${mid}\n${bot}\n`);
  },
};

export default logger;
