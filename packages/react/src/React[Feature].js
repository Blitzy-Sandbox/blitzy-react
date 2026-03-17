/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {FeatureProps} from 'shared/ReactTypes';
import {enableFeature} from 'shared/ReactFeatureFlags';
import {REACT_FEATURE_TYPE} from 'shared/ReactSymbols';

// Represents the resolved internal state of a Feature component instance.
// Tracks the normalized mode and the associated element type symbol so
// the reconciler can identify and process Feature fibers correctly.
export type FeatureState = {
  mode: 'active' | 'inactive',
  $$typeof: symbol,
};

// Creates a FeatureState from the provided FeatureProps. This is the public
// API entry point for the Feature component type. It normalises the optional
// mode prop (defaulting to 'active'), validates inputs in development, and
// returns a tagged state object consumed by the reconciler.
export function featureFunction(props: FeatureProps): FeatureState {
  if (!enableFeature) {
    // eslint-disable-next-line react-internal/prod-error-codes
    throw new Error(
      'featureFunction should not be exported when the enableFeature flag is off.',
    );
  }

  // Normalise mode: treat null, undefined, and missing values as 'active'.
  const mode: 'active' | 'inactive' =
    props.mode === 'inactive' ? 'inactive' : 'active';

  if (__DEV__) {
    if (
      props.mode !== undefined &&
      props.mode !== null &&
      props.mode !== 'active' &&
      props.mode !== 'inactive'
    ) {
      console.error(
        'Invalid mode "%s" provided to featureFunction. ' +
          'Expected "active" or "inactive".',
        props.mode,
      );
    }

    if (props.name !== undefined && typeof props.name !== 'string') {
      console.error(
        'The name prop provided to featureFunction must be a string, ' +
          'received %s.',
        typeof props.name,
      );
    }
  }

  return {
    mode,
    $$typeof: REACT_FEATURE_TYPE,
  };
}
