import type { PlatformAgentModelDependencyRef } from '@lobechat/types';

/**
 * A catalog state that blocks Save. Unlike `issues` (staleness, rendered next to the field it
 * belongs to), a blocker can originate from a field the host hides — Skills and Connectors live in
 * a collapsed group — so the host MUST render it where the Save button is.
 */
export interface DependencyBlocker {
  /** i18n key describing what is blocking Save. */
  message: string;
  /** Present when the underlying catalog exposes a retry. */
  retry?: () => Promise<unknown>;
}

export interface DependencyValidity {
  /** Save-blocking catalog loading/error states, including ones from hidden fields. */
  blockers: DependencyBlocker[];
  issues: string[];
  /**
   * The chosen model re-pinned to the CURRENTLY published provider revision, set only while the
   * draft's pin is behind one. The draft itself is left untouched — an unrelated provider
   * republish must never make an untouched assistant look edited — so a submit that does author a
   * version applies this to the snapshot it writes. `null`/absent means the pin is already current
   * (or there is nothing to re-pin).
   */
  modelRepin?: PlatformAgentModelDependencyRef | null;
  ready: boolean;
}
