import {
  openScorecard,
  resetGame,
  executeAction,
  type FrameResponse,
} from "@tests/kaggle/fetchARC3";

/**
 * Type-specific state for ARC-AGI-3 (3D grid frame).
 */
export type ARCState = number[][][];

/**
 * ARCEnvironment: Implements the generalized Environment interface for the ARC-AGI-3 API.
 */
export class ARCEnvironment
  implements Explore.Environment<ARCState, number, FrameResponse | null>
{
  private gameId: string;
  private cardId: string | null = null;
  private lastGuid: string | null = null;

  constructor(gameId: string) {
    this.gameId = gameId;
  }

  /**
   * Resets the game and returns the initial frame.
   */
  public async reset(): Promise<FrameResponse> {
    if (!this.cardId) {
      const card = await openScorecard({ tags: ["modpat-multilevel"] });
      this.cardId = card.card_id;
    }

    const response = await resetGame({
      game_id: this.gameId,
      card_id: this.cardId,
    });

    this.lastGuid = response.guid;
    return response;
  }

  /**
   * Returns the current grid frame.
   */
  public observe(result: FrameResponse): ARCState {
    return result.frame;
  }

  /**
   * Executes a specific command (1-7) in the ARC environment.
   * Handles 500 errors gracefully, particularly for ACTION_6.
   */
  public async execute(action: number): Promise<FrameResponse | null> {
    if (!this.lastGuid) {
      throw new Error("Cannot execute action: Game not reset or GUID missing.");
    }

    try {
      const response = await executeAction(action, this.gameId, this.lastGuid);
      this.lastGuid = response.guid;
      return response;
    } catch (e: any) {
      if (
        e.message.includes("500") ||
        e.message.includes("Internal Server Error")
      ) {
        // If it's a 500, we treat the action as unsupported/invalid for this game state
        return null;
      }
      throw e;
    }
  }

  /**
   * Checks for a win or completion state.
   */
  public isComplete(result: FrameResponse): boolean {
    return result.state === "WIN";
  }

  /**
   * Checks if the action is currently allowed.
   */
  public isValidAction(action: number, result: FrameResponse): boolean {
    return result.available_actions.includes(action);
  }

  /**
   * Uses the standard "Undo" action (7) if supported by the game.
   */
  public async undo(_result: FrameResponse): Promise<FrameResponse | null> {
    return this.execute(7);
  }

  /**
   * Provides current GUID for lower-level API access if needed.
   */
  public getGuid(): string | null {
    return this.lastGuid;
  }
}
