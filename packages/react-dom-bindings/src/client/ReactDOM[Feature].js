/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {enableFeature} from 'shared/ReactFeatureFlags';
import {checkAttributeStringCoercion} from 'shared/CheckStringCoercion';

export function setFeature(domElement: Element, tag: string, value: any) {
  // Guard against being called when the feature is not enabled. Callers
  // (ReactFiberConfigDOM, ReactDOMComponent) are expected to gate on the flag
  // but we include a defensive check to prevent unintended DOM mutations.
  if (!enableFeature) {
    return;
  }
  // Apply the feature-specific value to the target DOM element. Object values
  // are serialized as a data attribute so that downstream event handlers and
  // observers can read the structured metadata back.
  if (value != null && typeof value === 'object') {
    const serialized = JSON.stringify((value: any));
    domElement.setAttribute('data-feature', serialized);
  } else if (value != null) {
    if (__DEV__) {
      checkAttributeStringCoercion(value, 'data-feature');
    }
    domElement.setAttribute('data-feature', '' + value);
  } else {
    // Null or undefined values remove the attribute to keep the DOM clean.
    domElement.removeAttribute('data-feature');
  }
}
