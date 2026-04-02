namespace Explore {
  /**
   * Environment interface: A generalized abstraction for interacting with an external system.
   * It provides the means to observe the current state, perform actions, and determine
   * if a goal state has been reached.
   */
  interface Environment<TState, TAction, TResult> {
    /**
     * Resets the environment to its initial state.
     * @returns The initial result of the reset operation.
     */
    reset(): Promise<TResult>;

    /**
     * Extracts the observable state from the current environment result.
     * @param result The result returned by an action or reset.
     * @returns The state representation.
     */
    observe(result: TResult): TState;

    /**
     * Executes a specific action within the environment.
     * @param action The action identifier or payload.
     * @returns The outcome of the action, or null if the action was invalid or failed.
     */
    execute(action: TAction): Promise<TResult | null>;

    /**
     * Checks if the goal state has been achieved based on the last result.
     * @param result The result to evaluate.
     * @returns True if the win/completion condition is met.
     */
    isComplete(result: TResult): boolean;

    /**
     * Determines if the given action is currently valid.
     * @param action The action to check.
     * @param result The current result/state.
     * @returns True if the action can be performed.
     */
    isValidAction(action: TAction, result: TResult): boolean;

    /**
     * Undoes the last action performed in the environment, if supported.
     * @param result The current state before undoing.
     * @returns The previous result.
     */
    undo?(result: TResult): Promise<TResult>;
  }
}
