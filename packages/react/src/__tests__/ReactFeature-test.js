/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @emails react-core
 */

'use strict';

let React;
let ReactNoop;
let act;
let waitForAll;
let assertConsoleErrorDev;

describe('ReactFeature', () => {
  beforeEach(() => {
    jest.resetModules();
    React = require('react');
    ReactNoop = require('react-noop-renderer');

    const InternalTestUtils = require('internal-test-utils');
    act = InternalTestUtils.act;
    waitForAll = InternalTestUtils.waitForAll;
    assertConsoleErrorDev = InternalTestUtils.assertConsoleErrorDev;
  });

  // @gate enableFeature
  it('should export Feature symbol from React', () => {
    expect(React.Feature).toBeDefined();
    expect(typeof React.Feature).toBe('symbol');
  });

  // @gate enableFeature
  it('should export featureFunction as a function', () => {
    expect(typeof React.featureFunction).toBe('function');
  });

  // @gate enableFeature
  it('should export useFeature hook as a function', () => {
    expect(typeof React.useFeature).toBe('function');
  });

  // @gate enableFeature
  it('should create a FeatureState with default active mode', () => {
    const state = React.featureFunction({});
    expect(state.mode).toBe('active');
    expect(state.$$typeof).toBe(React.Feature);
  });

  // @gate enableFeature
  it('should create a FeatureState with explicit active mode', () => {
    const state = React.featureFunction({mode: 'active'});
    expect(state.mode).toBe('active');
    expect(state.$$typeof).toBe(React.Feature);
  });

  // @gate enableFeature
  it('should create a FeatureState with inactive mode', () => {
    const state = React.featureFunction({mode: 'inactive'});
    expect(state.mode).toBe('inactive');
    expect(state.$$typeof).toBe(React.Feature);
  });

  // @gate enableFeature
  it('should default mode to active when mode is null', () => {
    const state = React.featureFunction({mode: null});
    expect(state.mode).toBe('active');
    expect(state.$$typeof).toBe(React.Feature);
  });

  // @gate enableFeature
  it('should default mode to active when mode is undefined', () => {
    const state = React.featureFunction({mode: undefined});
    expect(state.mode).toBe('active');
    expect(state.$$typeof).toBe(React.Feature);
  });

  // @gate enableFeature
  it('should warn in DEV when an invalid mode is provided', () => {
    React.featureFunction({mode: 'invalid'});
    assertConsoleErrorDev([
      'Invalid mode "invalid" provided to featureFunction. ' +
        'Expected "active" or "inactive".',
    ]);
  });

  // @gate enableFeature
  it('should warn in DEV when name prop is not a string', () => {
    React.featureFunction({name: 123});
    assertConsoleErrorDev([
      'The name prop provided to featureFunction must be a string, ' +
        'received number.',
    ]);
  });

  // @gate enableFeature
  it('should not warn when a valid string name is provided', () => {
    const state = React.featureFunction({name: 'myFeature'});
    expect(state.mode).toBe('active');
    expect(state.$$typeof).toBe(React.Feature);
  });

  // @gate enableFeature
  it('should work with createElement alongside featureFunction', async () => {
    function App() {
      const state = React.featureFunction({mode: 'inactive', name: 'test'});
      return React.createElement('div', null, state.mode);
    }

    ReactNoop.render(React.createElement(App));
    await waitForAll([]);
  });

  // @gate enableFeature
  it('should work alongside useState in a component', async () => {
    function App() {
      const [count] = React.useState(0);
      const state = React.featureFunction({mode: 'active'});
      return React.createElement('div', null, state.mode + ':' + count);
    }

    await act(() => {
      ReactNoop.render(React.createElement(App));
    });
  });

  // @gate enableFeature
  it('should re-render when mode prop changes from active to inactive', async () => {
    let setMode;
    function App() {
      const [mode, _setMode] = React.useState('active');
      setMode = _setMode;
      const state = React.featureFunction({mode});
      return React.createElement('div', null, state.mode);
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(React.createElement(App));
    });
    expect(root).toMatchRenderedOutput(
      React.createElement('div', null, 'active'),
    );

    await act(() => {
      setMode('inactive');
    });
    expect(root).toMatchRenderedOutput(
      React.createElement('div', null, 'inactive'),
    );
  });

  // @gate enableFeature
  it('should render nested children correctly under a Feature boundary', async () => {
    function App() {
      return React.createElement(
        React.Feature,
        {mode: 'active'},
        React.createElement('div', null,
          React.createElement('span', null, 'child1'),
          React.createElement('span', null, 'child2'),
        ),
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(React.createElement(App));
    });
    expect(root).toMatchRenderedOutput(
      React.createElement('div', null,
        React.createElement('span', null, 'child1'),
        React.createElement('span', null, 'child2'),
      ),
    );
  });

  // @gate enableFeature
  it('should unmount cleanly without errors', async () => {
    function App({show}) {
      if (!show) {
        return null;
      }
      return React.createElement(
        React.Feature,
        {mode: 'active'},
        React.createElement('div', null, 'content'),
      );
    }

    const root = ReactNoop.createRoot();
    await act(() => {
      root.render(React.createElement(App, {show: true}));
    });
    expect(root).toMatchRenderedOutput(
      React.createElement('div', null, 'content'),
    );

    // Unmount the Feature component — should not throw
    await act(() => {
      root.render(React.createElement(App, {show: false}));
    });
    expect(root).toMatchRenderedOutput(null);
  });

  // @gate !enableFeature
  it('should not export feature APIs when the flag is disabled', () => {
    expect(React.Feature).toBe(undefined);
    expect(React.featureFunction).toBe(undefined);
    expect(React.useFeature).toBe(undefined);
  });
});
