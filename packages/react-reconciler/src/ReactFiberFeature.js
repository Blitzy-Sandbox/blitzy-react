/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FeatureProps} from 'shared/ReactTypes';
import type {FiberRoot} from './ReactInternalTypes';

import {enableFeature} from 'shared/ReactFeatureFlags';

/**
 * State type for the Feature component, stored as fiber.stateNode.
 * Tracks the committed state of the feature boundary including
 * its active/inactive mode and auto-generated name for DevTools.
 */
export type FeatureFiberState = {
  // The auto-generated name for this feature boundary when an explicit
  // name is not provided via props. Used for debugging and DevTools.
  autoName: null | string,
  // Whether the feature boundary is currently active.
  // Derived from the mode prop and tracked across renders to detect transitions.
  isActive: boolean,
};

// Counter for generating unique auto-names for feature boundaries
// that do not have an explicit name prop specified.
let globalFeatureIdCounter: number = 0;

/**
 * Resolves the display name for a Feature boundary.
 * If the props specify an explicit name, that is used directly.
 * Otherwise, an auto-generated unique name is assigned and cached
 * in the state to ensure stable identity across re-renders.
 *
 * Follows the pattern of getViewTransitionName in
 * ReactFiberViewTransitionComponent.js.
 */
export function getFeatureName(
  props: FeatureProps,
  state: FeatureFiberState,
  root: FiberRoot,
): string {
  if (!enableFeature) {
    return '';
  }
  // Use explicit name if provided.
  if (props.name != null) {
    return props.name;
  }
  // Return cached auto-name if already generated.
  if (state.autoName !== null) {
    return state.autoName;
  }
  // Generate a new unique auto-name using the root's identifier prefix
  // and a monotonically increasing counter for uniqueness.
  const identifierPrefix = root.identifierPrefix;
  const globalFeatureId = globalFeatureIdCounter++;
  const name =
    '_' + identifierPrefix + 'f_' + globalFeatureId.toString(32) + '_';
  state.autoName = name;
  return name;
}
