import System from "@core_i/System";
import Mapper from "@core_i/Mapper";
import { BaseAtomizer } from "@atomics/BaseAtomizer";
import logger from "@utils/SpectralLogger";

/**
 * BaseExplorer provides the core "Observe -> Predict -> Calibrate -> Execute"
 * control loop for navigating topological logical manifolds.
 * It is generic over the state representation (TState), the available actions (TAction),
 * and the raw environment result format (TResult).
 */
export abstract class BaseExplorer<TState, TAction, TResult> {
  protected system: System;
  protected mapper: Mapper;
  protected env: Explore.Environment<TState, TAction, TResult>;
  protected atomizer: BaseAtomizer;

  /**
   * Initializes the explorer with its dependencies.
   * @param system The ModPAT logical manifold.
   * @param mapper The geodesic routing engine.
   * @param env The external environment abstraction.
   * @param atomizer The physicalized data transformer.
   */
  constructor(
    system: System,
    mapper: Mapper,
    env: Explore.Environment<TState, TAction, TResult>,
    atomizer: BaseAtomizer
  ) {
    this.system = system;
    this.mapper = mapper;
    this.env = env;
    this.atomizer = atomizer;
  }

  /**
   * The primary high-level entry point to solve the environment's goal.
   * Executes the observation and action loop until completion or failure.
   */
  public abstract solve(): Promise<{
    route: Uint32Array;
    actions: TAction[];
  } | null>;

  /**
   * Physical Calibration: Learns how available actions influence the state
   * within the 4D manifold. This step is crucial for building the predictive
   * model used by the Mapper for pathfinding.
   */
  protected abstract calibrate(currentResult: TResult): Promise<void>;

  /**
   * Atomizes the current state and projects it into the manifold.
   * @param state The state to atomize.
   * @param depth The current action depth or temporal context.
   * @returns The newly allocated quantum ID in the System.
   */
  protected abstract atomizeState(state: TState, depth: number): number;

  /**
   * Atomizes an action and its corresponding transformation effect.
   * @param action The action to atomize.
   * @param fromIds The source state quantum IDs.
   * @param toId The target result quantum ID.
   * @returns The operator quantum ID representing the action.
   */
  protected abstract atomizeAction(
    action: TAction,
    fromIds: number[],
    toId: number
  ): number;

  /**
   * Standard logging function for consistent spectral output.
   * @param message The text to log.
   */
  protected log(message: string): void {
    logger.log(`[Explorer] ${message}`);
  }
}
